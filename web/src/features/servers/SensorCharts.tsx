import { useMemo, useState } from 'react';
import { Fan, Thermometer } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardHeader, EmptyState } from '../../components/ui';
import { faDigits, fmtNumber, fmtRangeLabel } from '../../lib/format';
import type { ServerSensorSeries, ServerSensorSeriesItem } from '../../lib/types';

export type SensorKind = 'temperature' | 'fan';

/**
 * رنگ‌ها به‌ترتیبی چیده شده‌اند که هر دو خط مجاور در نمودار (و در فهرست
 * انتخاب) کنتراست کافی داشته باشند؛ بیشتر از ۱۲ سنسور، رنگ‌ها تکرار می‌شوند.
 */
const PALETTE = [
  '#2563eb',
  '#dc2626',
  '#0d9488',
  '#d97706',
  '#7c3aed',
  '#db2777',
  '#65a30d',
  '#0891b2',
  '#ea580c',
  '#4338ca',
  '#059669',
  '#9f1239',
];

const TICK = { fontSize: 10, fill: 'var(--chart-tick)' };

const SELECTION_PREFIX = 'nw.server-sensors';

function storageKey(serverId: number, kind: SensorKind) {
  return `${SELECTION_PREFIX}.${serverId}.${kind}`;
}

/** سنسورهای پنهان‌شده در همین مرورگر نگه داشته می‌شوند تا انتخاب کاربر پایدار بماند. */
function readHidden(key: string): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function writeHidden(key: string, value: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ذخیره‌سازی مرورگر در دسترس نیست */
  }
}

function colorOf(index: number) {
  return PALETTE[index % PALETTE.length];
}

export default function SensorSeriesCard({
  serverId,
  kind,
  range,
  data,
  loading,
  error,
}: {
  serverId: number;
  kind: SensorKind;
  range: string;
  data: ServerSensorSeries | null;
  loading: boolean;
  error: string | null;
}) {
  const key = storageKey(serverId, kind);
  const [hidden, setHidden] = useState<string[]>(() => readHidden(key));

  const meta =
    kind === 'temperature'
      ? { title: 'روند دمای سنسورها', subtitle: 'همهٔ سنسورهای دما روی یک نمودار — °C', unit: '°C', digits: 1 }
      : { title: 'روند فن‌ها', subtitle: 'همهٔ فن‌ها روی یک نمودار — RPM', unit: 'RPM', digits: 0 };

  const sensors = useMemo(() => {
    const list = (data?.sensors ?? []).filter((sensor) => sensor.type === kind && sensor.points.length > 0);
    return list.slice().sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  }, [data, kind]);

  const indexByKey = useMemo(() => new Map(sensors.map((sensor, index) => [sensor.key, index])), [sensors]);
  const visible = useMemo(() => sensors.filter((sensor) => !hidden.includes(sensor.key)), [sensors, hidden]);
  const single = visible.length === 1 ? visible[0] : null;
  const available = data?.available?.[kind] ?? 0;

  // آستانه‌ها فقط وقتی رسم می‌شوند که یک سنسور انتخاب شده باشد و نزدیک محدودهٔ
  // داده باشند؛ خطی که ۲۰٪ بالاتر از بیشترین مقدار است، نمودار را بی‌دلیل
  // فشرده می‌کند و خطی که خیلی دور است ارزش خواندن ندارد.
  const peak = useMemo(() => Math.max(0, ...visible.flatMap((sensor) => sensor.points.map((point) => point.reading))), [visible]);
  const limitLines = useMemo(() => {
    if (!single) return [];
    const near = (value: number | null) => (value != null && value > 0 && value <= peak * 1.3 ? value : null);
    const caution = near(single.upperCaution);
    const critical = near(single.upperCritical);
    return [
      caution != null ? { value: caution, label: 'هشدار', color: '#d97706' } : null,
      critical != null ? { value: critical, label: 'بحرانی', color: '#dc2626' } : null,
    ].filter((line): line is { value: number; label: string; color: string } => line != null);
  }, [single, peak]);

  const rows = useMemo(() => {
    const map = new Map<number, Record<string, number | string>>();
    for (const sensor of visible) {
      const dataKey = `v${indexByKey.get(sensor.key) ?? 0}`;
      for (const point of sensor.points) {
        const row = map.get(point.t) ?? {};
        row[dataKey] = point.reading;
        map.set(point.t, row);
      }
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, values]) => ({ t, label: fmtRangeLabel(t, range), ...values }));
  }, [visible, indexByKey, range]);

  const toggle = (sensorKey: string) => {
    setHidden((current) => {
      const next = current.includes(sensorKey) ? current.filter((value) => value !== sensorKey) : [...current, sensorKey];
      writeHidden(key, next);
      return next;
    });
  };

  const showAll = () => {
    setHidden([]);
    writeHidden(key, []);
  };

  const emptyState = available
    ? {
        title: kind === 'temperature' ? 'تاریخچهٔ دما در این بازه ثبت نشده است' : 'تاریخچهٔ فن در این بازه ثبت نشده است',
        description: 'با هر بار خواندن BMC یک نمونه ثبت می‌شود؛ پس از چند نمونه، نمودار ساخته می‌شود.',
      }
    : {
        title: kind === 'temperature' ? 'سنسور دمایی ثبت نشده است' : 'سنسور فنی ثبت نشده است',
        description: 'برای خواندن دما و فن، اتصال BMC را فعال کنید یا سرور نمایشی بسازید.',
      };

  return (
    <Card>
      <CardHeader
        title={meta.title}
        subtitle={meta.subtitle}
        icon={kind === 'temperature' ? <Thermometer size={16} /> : <Fan size={16} />}
        action={
          <div className="flex items-center gap-2 text-[10.5px]">
            {hidden.length ? (
              <button type="button" className="text-accent hover:underline" onClick={showAll}>
                نمایش همه
              </button>
            ) : null}
            <span className="text-ink-400">
              {faDigits(visible.length)} از {faDigits(sensors.length)}
            </span>
          </div>
        }
      />

      {loading && !data ? (
        <div className="mt-3 grid h-[240px] place-items-center text-xs text-ink-400">در حال خواندن تاریخچهٔ سنسورها…</div>
      ) : error && !data ? (
        <p className="mt-3 grid h-[240px] place-items-center px-4 text-center text-xs text-danger">{error}</p>
      ) : !sensors.length ? (
        <div className="mt-3">
          <EmptyState
            title={emptyState.title}
            description={emptyState.description}
            icon={kind === 'temperature' ? <Thermometer size={22} /> : <Fan size={22} />}
          />
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="انتخاب سنسورهای نمایش‌داده‌شده">
            {sensors.map((sensor) => {
              const index = indexByKey.get(sensor.key) ?? 0;
              const on = !hidden.includes(sensor.key);
              const latest = sensor.points[sensor.points.length - 1]?.reading ?? null;
              return (
                <button
                  key={sensor.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(sensor.key)}
                  title={`${sensor.name}${sensor.unit ? ` — ${sensor.unit}` : ''}`}
                  className={`inline-flex items-center gap-1.5 rounded-pill border px-2 py-1 text-[10.5px] transition ${
                    on
                      ? 'border-ink-200 bg-surface text-ink-700 shadow-xs hover:border-brand-200'
                      : 'border-dashed border-ink-200 bg-ink-50/50 text-ink-400'
                  }`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: on ? colorOf(index) : 'rgb(var(--nw-ink-300))' }}
                    aria-hidden
                  />
                  <span className={on ? '' : 'line-through'}>{sensor.name}</span>
                  {latest != null ? (
                    <span className="num text-[10px] text-ink-400">{fmtNumber(latest, meta.digits)}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {visible.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={rows} margin={{ top: 8, right: 14, left: 0, bottom: 0 }} syncId={`server-sensors-${serverId}`}>
                <CartesianGrid strokeDasharray="3 6" stroke="var(--chart-grid)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={TICK}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={TICK}
                  tickLine={false}
                  axisLine={false}
                  width={kind === 'fan' ? 56 : 44}
                  domain={[0, 'auto']}
                  tickFormatter={(value) => faDigits(Math.round(Number(value)))}
                />
                {limitLines.map((line) => (
                  <ReferenceLine
                    key={`${line.label}-${line.value}`}
                    y={line.value}
                    stroke={line.color}
                    strokeDasharray="5 4"
                    strokeWidth={1}
                    ifOverflow="extendDomain"
                    label={{
                      value: line.label,
                      position: 'insideTopLeft',
                      fontSize: 9,
                      fill: line.color,
                    }}
                  />
                ))}
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const entries = payload
                      .map((item) => {
                        const sensorIndex = Number(String(item.dataKey).slice(1));
                        const sensor = Number.isInteger(sensorIndex) ? sensors[sensorIndex] ?? null : null;
                        const value = typeof item.value === 'number' ? item.value : null;
                        const color = typeof item.color === 'string' ? item.color : undefined;
                        return { sensor, value, color };
                      })
                      .filter((entry) => entry.sensor && entry.value != null)
                      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
                    if (!entries.length) return null;
                    return (
                      <div className="max-h-64 overflow-y-auto rounded-soft border border-ink-200 bg-surface/97 px-3 py-2 shadow-pop backdrop-blur">
                        <p className="mb-1 text-[11px] font-medium text-ink-500">{String(label ?? '')}</p>
                        <div className="flex flex-col gap-1">
                          {entries.map((entry, index) => {
                            const sensor = entry.sensor as ServerSensorSeriesItem;
                            return (
                              <div key={`${sensor.key}-${index}`} className="flex items-center justify-between gap-4 text-[11px]">
                                <span className="flex items-center gap-1.5 text-ink-500">
                                  <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} aria-hidden />
                                  {sensor.name}
                                </span>
                                <span className="num font-medium text-ink-800">
                                  {fmtNumber(entry.value, meta.digits)}
                                  <span className="ms-1 text-[9.5px] text-ink-400">{sensor.unit || meta.unit}</span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }}
                />
                {visible.map((sensor) => {
                  const index = indexByKey.get(sensor.key) ?? 0;
                  return (
                    <Line
                      key={sensor.key}
                      type="monotone"
                      dataKey={`v${index}`}
                      name={sensor.name}
                      stroke={colorOf(index)}
                      strokeWidth={1.8}
                      dot={false}
                      activeDot={{ r: 3.5, strokeWidth: 1.5, stroke: 'var(--chart-dot-ring)' }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-[180px] place-items-center rounded-soft border border-dashed border-ink-200 px-4 text-center text-xs text-ink-400">
              همهٔ سنسورها پنهان شده‌اند؛ برای دیدن نمودار «نمایش همه» را بزنید.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
