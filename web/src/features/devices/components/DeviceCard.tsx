import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, Edit3, ExternalLink, Eye, Layers, MapPin, Tag as TagIcon, Trash2, Wifi } from 'lucide-react';
import { Badge, StatusPill } from '../../../components/ui';
import { LatencySpark } from '../../../components/charts';
import { useLivePing } from '../../../components/LivePing';
import { useDeviceLive } from '../../../lib/store';
import { faDigits, fmtRelative, PRIORITY_META } from '../../../lib/format';
import type { Device } from '../../../lib/types';
import { openDeviceAddress } from '../model/table';

export function DeviceCard({
  device,
  spark,
  threshold,
  visibleTags,
  showPriority,
  showGeo,
  selected,
  selectable,
  canProbe,
  canWrite,
  onSelect,
  onPing,
  onEdit,
  onDelete,
  delay,
}: {
  device: Device;
  spark: { t: number; rtt: number | null; loss: number }[];
  threshold: number;
  /** اگر خالی باشد دو تگ اول نمایش داده می‌شود؛ در غیر این صورت فقط تگ‌های انتخابی */
  visibleTags: string[];
  /** نمایش/پنهان‌کردن نشان‌های اولویت و موقعیت از منوی «تگ روی کارت» */
  showPriority: boolean;
  showGeo: boolean;
  selected: boolean;
  selectable: boolean;
  canProbe: boolean;
  canWrite: boolean;
  onSelect: () => void;
  onPing: () => void;
  onEdit: () => void;
  onDelete: () => void;
  delay: number;
}) {
  const liveSample = useDeviceLive(device.id);
  const livePing = useLivePing();
  const status = liveSample?.status ?? device.status;
  const navigate = useNavigate();

  const points = useMemo(() => {
    const byTime = new Map<number, { t: number; rtt: number | null; loss: number }>();
    for (const point of spark) byTime.set(point.t, point);
    // نمونهٔ زنده حتی وقتی پاسخ نداده هم اضافه می‌شود تا قطعی جاری در نمودار دیده شود.
    if (liveSample) byTime.set(liveSample.ts, { t: liveSample.ts, rtt: liveSample.rtt, loss: liveSample.lossPct });
    return [...byTime.values()].sort((a, b) => a.t - b.t);
  }, [spark, liveSample]);

  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className={`card device-card group relative animate-fade-up p-3 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-pop ${
        selected ? 'ring-2 ring-brand-400/70' : ''
      } ${!device.enabled ? 'opacity-70' : ''}`}
    >
      <div className="device-card__head flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {selectable ? (
            <button
              type="button"
              onClick={onSelect}
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition ${
                selected
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : 'border-ink-300 bg-surface text-transparent hover:border-brand-300'
              }`}
              aria-label="انتخاب"
            >
              ✓
            </button>
          ) : null}
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate(`/devices/${device.id}`)}
              className="block truncate text-right text-[13.5px] font-semibold text-ink-800 hover:text-accent"
            >
              {device.name}
            </button>
            <p className="num mt-0.5 text-[11px] text-ink-400">{device.ip}</p>
            {device.statusReason && status !== 'online' ? (
              <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-warning" title={device.statusReason}>
                {device.statusReason}
              </p>
            ) : null}
          </div>
        </div>
        <span className="device-card__status shrink-0">
          <StatusPill status={status} size="sm" />
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {device.groupName ? (
          <span
            className="chip max-w-full border-ink-200 bg-ink-50 text-ink-600"
            style={{
              borderColor: `${device.groupColor}55`,
              background: `${device.groupColor}12`,
              color: device.groupColor ?? undefined,
            }}
          >
            <Layers size={11} className="shrink-0" />
            <span className="truncate">{device.groupName}</span>
          </span>
        ) : null}
        {showPriority ? (
          <Badge className={PRIORITY_META[device.priority]?.className}>{PRIORITY_META[device.priority]?.label}</Badge>
        ) : null}
        {!device.monitoringEnabled ? <Badge tone="ink">پایش غیرفعال</Badge> : null}
        {showGeo && device.latitude != null ? (
          <Badge tone="brand">
            <MapPin size={11} /> دارای موقعیت
          </Badge>
        ) : null}
        {(visibleTags.length
          ? (device.tags || []).filter((t) => visibleTags.includes(t.name))
          : (device.tags || []).slice(0, 2)
        ).map((t) => (
          <span
            key={t.id}
            className="chip"
            style={{ borderColor: `${t.color}44`, background: `${t.color}12`, color: t.color }}
          >
            <TagIcon size={10} />
            {t.name}
          </span>
        ))}
      </div>

      <div className="mt-2 rounded-soft bg-gradient-to-b from-ink-50/70 to-surface px-1.5 py-1">
        {points.length ? (
          <LatencySpark points={points} threshold={threshold} height={52} />
        ) : (
          <div className="flex h-[52px] items-center justify-center px-1 text-center text-[11px] leading-tight text-ink-400">
            داده‌ای در یک ساعت گذشته ثبت نشده
          </div>
        )}
        <div className="device-card__legend mt-0.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[9.5px] text-ink-400">
          <span className="device-card__chart-caption">
            تأخیر ۱ ساعت · آستانه <span className="num">{faDigits(threshold)} ms</span>
          </span>
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              سالم
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-sun-500" />
              بالا
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              قطع
            </span>
          </span>
        </div>
      </div>

      <div className="device-card__footer mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-2">
        <span className="device-card__time text-[10.5px] text-ink-400">
          آخرین بررسی: {fmtRelative(liveSample?.ts ?? device.lastCheckAt)}
        </span>
        <div className="device-card__actions flex flex-wrap items-center justify-end gap-1.5">
          {canProbe ? (
            <>
              <button
                type="button"
                className={`btn-xs ${livePing.has(device.id) ? 'btn-soft' : 'btn-ghost'}`}
                onClick={() => livePing.toggle({ id: device.id, name: device.name, ip: device.ip, status })}
                title="پنجرهٔ پینگ زنده (هر ثانیه)"
              >
                <Activity size={13} />
              </button>
              <button type="button" className="btn-ghost btn-xs" onClick={onPing} title="ارسال Ping لحظه‌ای">
                <Wifi size={13} />
              </button>
            </>
          ) : null}
          {canWrite ? (
            <>
              <button type="button" className="btn-ghost btn-xs" onClick={onEdit} title="ویرایش">
                <Edit3 size={13} />
              </button>
              <button type="button" className="btn-ghost btn-xs" onClick={onDelete} title="حذف">
                <Trash2 size={13} />
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="btn-ghost btn-xs"
            onClick={() => openDeviceAddress(device)}
            title={`بازکردن ${device.ip} در تب جدید`}
            aria-label={`بازکردن آدرس ${device.ip} در تب جدید`}
          >
            <ExternalLink size={13} />
          </button>
          <Link to={`/devices/${device.id}`} className="btn-soft btn-xs" title="جزئیات تجهیز">
            <Eye size={13} />
            <span className="device-card__details-label">جزئیات</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
