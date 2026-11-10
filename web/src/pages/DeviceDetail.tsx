import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CircleCheck,
  Clock,
  Edit3,
  Gauge,
  MapPin,
  Percent,
  RefreshCw,
  Server,
  ShieldAlert,
  Timer,
  Trash2,
  TrendingUp,
  Wifi,
  Wrench,
  Paperclip,
  Image as ImageIcon,
  Upload,
  FileDown,
  Eye,
  X,
  Copy,
  Check,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useAsync, useDeviceLive, useLiveState, useToast } from '../lib/store';
import { useAuth } from '../lib/auth';
import { DataFreshness } from '../components/Freshness';
import { faDigits, fmtDate, fmtDateTime, fmtDuration, fmtMs, fmtNumber, fmtPct, fmtRelative, PRIORITY_META, statusMeta } from '../lib/format';
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageLoader, StatusPill, Tabs } from '../components/ui';
import { ChartFill, DailyCalendarHeatmap, LatencyAreaChart, LossAreaChart, TrendLineChart } from '../components/charts';
import { buildDailyCalendar, summarizeSeries, type DailyMetric } from '../lib/chart-daily';
import { AvailabilityExplorer } from '../components/uptime-explorer';
import MaintenanceForm from '../features/MaintenanceForm';
import DeviceForm from '../features/DeviceForm';
import { useLivePing } from '../components/LivePing';
import { LayoutToolbar, WidgetShell, useDragRef, useWidgetLayout, type WidgetDef } from '../components/widgets';
import { DETAIL_WIDGETS } from '../lib/widgetdefs';
import type { Device, MaintenanceRecord, Outage, Series } from '../lib/types';

type ChartRange = '1h' | '6h' | '24h' | '7d' | '30d';

export default function DeviceDetail() {
  const { id } = useParams();
  const { settings, tzOffset, refreshMeta } = useApp();
  const { push } = useToast();
  const navigate = useNavigate();
  const live = useDeviceLive(id);
  const livePing = useLivePing();
  const liveState = useLiveState();
  const { can } = useAuth();
  const canWrite = can('devices:write');
  // نمایش رمز تجهیز علاوه بر ویرایش، مجوز اختصاصی credentials:reveal می‌خواهد.
  const canReveal = can('credentials:reveal');
  const canProbe = can('probe:run');
  const canMaintenance = can('maintenance:write');

  const [editOpen, setEditOpen] = useState(false);
  const [maintOpen, setMaintOpen] = useState(false);
  const [maintRecord, setMaintRecord] = useState<MaintenanceRecord | null>(null);
  const [maintDefaults, setMaintDefaults] = useState<{ cause?: string; startedAt?: number }>({});
  const [pinging, setPinging] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);

  const layoutHook = useWidgetLayout('device_detail_widgets', DETAIL_WIDGETS);
  const { layout, editMode } = layoutHook;
  const dragId = useDragRef();
  const [dragging, setDragging] = useState<string | null>(null);

  const { data: device, loading, error, refresh, updatedAt } = useAsync<Device>((signal) => api.device(id!, signal), [id], { interval: 20000 });
  const { data: health, refresh: refreshHealth } = useAsync((signal) => api.deviceHealth(id!, signal), [id], { interval: 60000 });
  const { data: outages, refresh: refreshOutages } = useAsync((signal) => api.outages(id!, 100, signal), [id], { interval: 30000 });
  const { data: maint, refresh: refreshMaint } = useAsync((signal) => api.deviceMaintenance(id!, signal), [id]);

  useEffect(() => {
    if (live?.ts) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.ts]);

  // رمز نمایش‌داده‌شده پس از مدت کوتاهی دوباره پوشیده می‌شود و با عوض‌شدن
  // تجهیز هم پاک می‌شود تا در صفحهٔ بعدی دیده نشود.
  useEffect(() => setRevealedPassword(''), [id]);
  useEffect(() => {
    if (!revealedPassword) return;
    const timer = window.setTimeout(() => setRevealedPassword(''), 20000);
    return () => window.clearTimeout(timer);
  }, [revealedPassword]);

  // پس از قطع/وصل مجدد SSE، جزئیات و تاریخچه دوباره خوانده می‌شود.
  const seenSync = React.useRef(liveState.syncToken);
  useEffect(() => {
    if (liveState.syncToken === seenSync.current) return;
    seenSync.current = liveState.syncToken;
    refresh();
    refreshHealth();
    refreshOutages();
  }, [liveState.syncToken, refresh, refreshHealth, refreshOutages]);

  const ping = async () => {
    setPinging(true);
    try {
      const res = await api.pingDevice(id!);
      const r = res.result;
      push(r.ok ? `پاسخ دریافت شد — ${fmtMs(r.rtt)} (حالت: ${r.mode})` : `پاسخی دریافت نشد — ${r.error ?? 'Timeout'}`, r.ok ? 'success' : 'error');
      refresh();
      refreshHealth();
    } catch (e) {
      push((e as Error).message, 'error');
    } finally {
      setPinging(false);
    }
  };

  const copyPassword = async () => {
    if (!device || !canReveal || passwordBusy) return;
    setPasswordBusy(true);
    try {
      const creds = await api.deviceCredentials(device.id);
      if (!creds.password) {
        push('برای این تجهیز رمزی ذخیره نشده است', 'info');
        return;
      }
      await copyText(creds.password);
      setRevealedPassword(creds.password);
      push('رمز عبور کپی شد', 'success');
    } catch (e) {
      push((e as Error).message, 'error');
    } finally {
      setPasswordBusy(false);
    }
  };

  const removeDevice = async () => {
    if (!device) return;
    if (!window.confirm(`تجهیز «${device.name}» و تمام تاریخچه آن حذف شود؟`)) return;
    try {
      await api.deleteDevice(device.id);
      push('تجهیز حذف شد', 'success');
      refreshMeta();
      navigate('/devices');
    } catch (e) {
      push((e as Error).message, 'error');
    }
  };

  if (loading && !device) return <PageLoader label="در حال دریافت اطلاعات تجهیز…" />;
  if (error && !device) return <ErrorState message={error} onRetry={refresh} />;
  if (!device) return null;

  const meta = statusMeta(device.status);
  const eff = device.effective;
  const currentOutageSec = device.currentOutageStartedAt ? Math.round((Date.now() - device.currentOutageStartedAt) / 1000) : 0;
  const defById = Object.fromEntries(DETAIL_WIDGETS.map((d) => [d.id, d])) as Record<string, WidgetDef>;

  const renderWidget = (wid: string): React.ReactNode => {
    switch (wid) {
      case 'general':
        return (
          <Card className="flex flex-1 flex-col">
            <CardHeader title="اطلاعات عمومی" subtitle="مشخصات پایه تجهیز" icon={<Server size={18} />} />
            <dl className="mt-4 flex min-h-0 flex-1 flex-col divide-y divide-ink-100 overflow-auto pe-1">
              <InfoRow label="نام دستگاه" value={device.name} />
              <InfoRow label="آدرس IP" value={<span className="num">{device.ip}</span>} />
              <InfoRow label="نوع تجهیز" value={device.deviceType} />
              <InfoRow label="گروه" value={device.groupName ?? '—'} />
              <InfoRow
                label="عضویت گروهی"
                value={
                  device.groups?.length ? (
                    <span className="flex flex-wrap justify-end gap-1">
                      {device.groups.map((g) => (
                        <span key={g.id} className="chip" style={{ borderColor: `${g.color}44`, background: `${g.color}12`, color: g.color }}>
                          {g.name}
                        </span>
                      ))}
                    </span>
                  ) : (
                    '—'
                  )
                }
              />
              <InfoRow label="تاریخ نصب" value={device.installedAt ? fmtDate(device.installedAt, tzOffset) : 'ثبت نشده'} />
              <InfoRow label="محل استقرار" value={device.location || '—'} sub={[device.building, device.rack].filter(Boolean).join(' · ')} />
              <InfoRow label="وضعیت فعلی" value={<StatusPill status={device.status} size="sm" />} />
              <InfoRow label="زمان آخرین بررسی" value={fmtDateTime(device.lastCheckAt, tzOffset)} />
              <InfoRow label="سازنده / مدل" value={[device.vendor, device.model].filter(Boolean).join(' ') || '—'} />
              <InfoRow label="شماره سریال" value={<span className="num">{device.serial || '—'}</span>} />
              <InfoRow label="آدرس MAC" value={<span className="num">{device.macAddress || '—'}</span>} />
              <InfoRow label="پلاک اموال" value={<span className="num">{device.assetTag || '—'}</span>} />
              <InfoRow
                label="نام کاربری"
                value={device.accessUsername ? <span className="num" dir="ltr">{device.accessUsername}</span> : '—'}
              />
              <InfoRow
                label="رمز عبور"
                value={
                  device.hasAccessPassword ? (
                    canReveal ? (
                      <button
                        type="button"
                        onClick={copyPassword}
                        disabled={passwordBusy}
                        className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-surface px-2 py-1 text-[11px] text-ink-600 transition hover:border-brand-300 hover:text-accent disabled:opacity-60"
                        title="کلیک برای کپی رمز عبور"
                      >
                        <span className="num" dir="ltr">{revealedPassword || '••••••••'}</span>
                        {revealedPassword ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                      </button>
                    ) : (
                      <span className="num">••••••••</span>
                    )
                  ) : (
                    'ثبت نشده'
                  )
                }
                sub={
                  device.hasAccessPassword
                    ? canReveal
                      ? 'برای کپی روی رمز کلیک کنید'
                      : 'برای مشاهدهٔ رمز به مجوز اختصاصی «نمایش رمز» نیاز است'
                    : undefined
                }
              />
              <InfoRow label="مسئول" value={device.owner || '—'} />
              <InfoRow label="موقعیت جغرافیایی" value={device.latitude != null ? <span className="num">{device.latitude.toFixed(5)}, {device.longitude?.toFixed(5)}</span> : 'ثبت نشده'} />
              <InfoRow label="یادداشت" value={device.notes || '—'} />
            </dl>
          </Card>
        );

      case 'monitoring':
        return (
          <Card className="flex flex-1 flex-col">
            <CardHeader
              title="اطلاعات مانیتورینگ"
              subtitle={`حالت موتور: ${settings?.engine_mode ?? '—'} · بازه مؤثر ${faDigits(eff?.pingInterval ?? 0)} ثانیه`}
              icon={<Gauge size={18} />}
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MetricBox label="وضعیت اتصال" value={meta.label} tone={meta.text} />
              <MetricBox label="زمان آخرین Ping" value={fmtDateTime(device.lastCheckAt, tzOffset)} small />
              <MetricBox label="زمان پاسخ" value={fmtMs(live?.rtt ?? device.lastRtt)} />
              <MetricBox label="کمترین تأخیر" value={fmtMs(device.minRtt)} />
              <MetricBox label="بیشترین تأخیر" value={fmtMs(device.maxRtt)} />
              <MetricBox label="میانگین تأخیر" value={fmtMs(device.avgRtt)} />
              <MetricBox label="افت بسته" value={fmtPct(device.lossPct, 2)} tone={device.lossPct > 5 ? 'text-warning' : undefined} />
              <MetricBox label="پاسخ‌های موفق" value={fmtNumber(device.successCount)} tone="text-success" />
              <MetricBox label="پاسخ‌های ناموفق" value={fmtNumber(device.failCount)} tone={device.failCount ? 'text-danger' : undefined} />
              <MetricBox label="شکست‌های متوالی" value={fmtNumber(device.consecutiveFailures)} tone={device.consecutiveFailures ? 'text-danger' : undefined} />
              <MetricBox label="دسترس‌پذیری" value={fmtPct(device.uptimePct, 2)} tone={(device.uptimePct ?? 100) < 98 ? 'text-warning' : 'text-success'} />
              <MetricBox label="زمان آخرین قطعی" value={fmtDateTime(device.lastOutageAt, tzOffset)} small />
              <MetricBox label="مدت قطعی فعلی" value={device.currentOutageStartedAt ? fmtDuration(currentOutageSec) : '—'} tone={device.currentOutageStartedAt ? 'text-danger' : undefined} />
              <MetricBox label="MTBF" value={health?.mtbfSec ? fmtDuration(health.mtbfSec) : '—'} small />
              <MetricBox label="MTTR" value={health?.mttrSec ? fmtDuration(health.mttrSec) : '—'} small />
              <MetricBox label="تعداد کل بررسی‌ها" value={fmtNumber(device.totalChecks)} />
            </div>

            <div className="mt-5 min-h-0 flex-1">
              <div className="flex flex-col">
                <div className="mb-1.5 flex items-center justify-between text-[11px]">
                  <span className="text-ink-500">
                    <Percent size={11} className="inline" /> آستانه‌های مؤثر
                  </span>
                </div>
                <div className="space-y-2 rounded-soft border border-ink-200 bg-surface/70 p-3 text-[11.5px]">
                  <Row label="آستانه تأخیر" value={`${faDigits(eff?.latencyThreshold ?? 0)} ms`} />
                  <Row label="آستانه افت بسته" value={`${faDigits(eff?.lossThreshold ?? 0)}٪`} />
                  <Row label="زمان انتظار پاسخ" value={`${faDigits(eff?.timeoutMs ?? 0)} ms`} />
                  <Row label="تعداد Packet" value={`${faDigits(eff?.packetCount ?? 0)}`} />
                  <Row label="تلاش مجدد" value={`${faDigits(eff?.retries ?? 0)}`} />
                </div>
              </div>
            </div>
          </Card>
        );

      case 'charts':
        return (
          <div className="flex flex-1 flex-col gap-4">
            <h3 className="section-title">
              <TrendingUp size={17} className="text-brand-500" />
              نمودارهای تاریخی
            </h3>
            {/* کاوشگر دسترس‌پذیری تمام‌عرض است؛ کارت‌های تأخیر و افت بسته زیر آن،
                هرکدام با آمار یک‌نگاه و نمای تقویمی در بازهٔ ۳۰ روزه. */}
            <AvailabilityExplorer
              deviceId={id!}
              currentStatus={device.status}
              threshold={eff?.latencyThreshold}
            />
            <div className="grid min-h-0 flex-1 auto-rows-[minmax(300px,1fr)] gap-5 xl:grid-cols-2">
              <SeriesCard
                metric="latency"
                ranges={['1h', '6h', '24h', '7d', '30d']}
                defaultRange={(settings?.chart_default_range as ChartRange) || '1h'}
                deviceId={id!}
                threshold={eff?.latencyThreshold}
                tzOffset={tzOffset}
                calendar={settings?.calendar === 'gregorian' ? 'gregorian' : 'jalali'}
              />
              <SeriesCard
                metric="loss"
                ranges={['1h', '24h', '7d', '30d']}
                defaultRange="24h"
                deviceId={id!}
                lossThreshold={eff?.lossThreshold}
                tzOffset={tzOffset}
                calendar={settings?.calendar === 'gregorian' ? 'gregorian' : 'jalali'}
              />
            </div>
          </div>
        );

      case 'daily':
        return (
          <Card className="flex flex-1 flex-col">
            <CardHeader title="روند دسترس‌پذیری روزانه" subtitle="۱۴ روز گذشته — بر اساس آمار تجمیعی روزانه" icon={<CalendarClock size={18} />} />
            {health?.daily?.length ? (
              <ChartFill className="mt-3 min-h-0 flex-1" minHeight={160}>
                {(h) => (
                  <TrendLineChart
                    points={health.daily.map((d) => ({
                      label: new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(
                        new Date(Date.parse(`${d.day}T12:00:00Z`) + tzOffset * 60000)
                      ),
                      uptime: d.uptime_pct,
                      avgRtt: d.avg_rtt,
                    }))}
                    series={[
                      { key: 'uptime', label: 'دسترس‌پذیری', color: '#16a34a' },
                      { key: 'avgRtt', label: 'میانگین تأخیر', color: '#2563eb' },
                    ]}
                    tzOffset={tzOffset}
                    height={h}
                  />
                )}
              </ChartFill>
            ) : (
              <p className="py-10 text-center text-xs text-ink-400">داده روزانه‌ای موجود نیست</p>
            )}
          </Card>
        );

      case 'outages':
        return (
          <Card className="flex flex-1 flex-col">
            <CardHeader
              title="تاریخچه اختلالات و قطعی‌ها"
              subtitle={`${faDigits(outages?.total ?? 0)} رویداد ثبت‌شده برای این تجهیز`}
              icon={<ShieldAlert size={18} />}
              action={
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost btn-xs" onClick={refreshOutages}>
                    <RefreshCw size={13} />
                    به‌روزرسانی
                  </button>
                  <button
                    type="button"
                    className="btn-soft btn-xs"
                    onClick={() => {
                      setMaintRecord(null);
                      setMaintDefaults({});
                      setMaintOpen(true);
                    }}
                  >
                    <Wrench size={13} />
                    ثبت سابقه
                  </button>
                </div>
              }
            />

            {outages?.open ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-soft border border-red-200 bg-red-50/70 p-3">
                <div className="flex items-center gap-2 text-[12px] text-danger">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-70 animate-pulse-ring" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                  </span>
                  قطعی در جریان است — شروع {fmtDateTime(outages.open.started_at, tzOffset)}
                </div>
                <span className="num text-[12px] font-semibold text-danger">مدت: {fmtDuration(outages.open.durationSec)}</span>
              </div>
            ) : null}

            <div className="mt-4 min-h-0 flex-1">
              {!outages?.items?.length ? (
                <EmptyState title="اختلالی ثبت نشده است" description="برای این تجهیز در بازه نگهداری داده‌ها هیچ قطعی ثبت نشده است." icon={<CircleCheck size={22} />} />
              ) : (
                <div className="table-wrap h-full max-h-full">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>زمان شروع</th>
                        <th>زمان پایان</th>
                        <th>مدت قطعی</th>
                        <th>علت اختلال</th>
                        <th>اقدام ثبت‌شده</th>
                        <th>وضعیت</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outages.items.map((o: Outage) => (
                        <tr key={o.id}>
                          <td className="num text-[12px]">{fmtDateTime(o.startedAt, tzOffset)}</td>
                          <td className="num text-[12px]">{o.open ? <span className="text-danger">در جریان</span> : fmtDateTime(o.endedAt, tzOffset)}</td>
                          <td className="num">{fmtDuration(o.durationSec)}</td>
                          <td>
                            <span className="chip border-ink-200 bg-ink-50 text-ink-600">{o.cause}</span>
                          </td>
                          <td className="text-[12px]">{o.maintenance ? o.maintenance.action : <span className="text-ink-400">ثبت نشده</span>}</td>
                          <td>{o.open ? <Badge tone="red">باز</Badge> : <Badge tone="emerald">بسته‌شده</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>
        );

      case 'maintenance':
        return (
          <Card className="flex flex-1 flex-col">
            <CardHeader
              title="سوابق تعمیرات و نگهداری"
              subtitle={`${faDigits(maint?.items?.length ?? 0)} سابقه ثبت‌شده برای این تجهیز`}
              icon={<Wrench size={18} />}
              action={
                <button
                  type="button"
                  className="btn-soft btn-xs"
                  onClick={() => {
                    setMaintRecord(null);
                    setMaintDefaults({});
                    setMaintOpen(true);
                  }}
                >
                  <Wrench size={13} />
                  سابقه جدید
                </button>
              }
            />
            <div className="mt-4 min-h-0 flex-1 overflow-auto pe-1">
              {!maint?.items?.length ? (
                <EmptyState title="سابقه تعمیراتی ثبت نشده" description="با ثبت علت خرابی و اقدام انجام‌شده، سوابق نگهداری این تجهیز را کامل کنید. قطعی‌های شناسایی‌شده توسط موتور به‌صورت خودکار سابقه نمی‌سازند." icon={<Wrench size={22} />} />
              ) : (
                <div className="space-y-3">
                  {maint.items.map((m) => (
                    <div key={m.id} className="rounded-soft border border-ink-200/70 bg-surface/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[12.5px] font-semibold text-ink-700">{m.title || m.action}</p>
                        <span className="flex items-center gap-2">
                          <Badge tone="brand">{m.cause}</Badge>
                          <Badge tone="sun">{m.action}</Badge>
                          {m.status === 'open' ? <Badge tone="red">در جریان</Badge> : <Badge tone="emerald">پایان‌یافته</Badge>}
                          <button
                            type="button"
                            className="btn-ghost btn-xs"
                            title="ویرایش این سابقه"
                            onClick={() => {
                              setMaintRecord(m);
                              setMaintDefaults({});
                              setMaintOpen(true);
                            }}
                          >
                            <Edit3 size={12} />
                            ویرایش
                          </button>
                        </span>
                      </div>
                      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-500">{m.description || '—'}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-ink-400">
                        <span>شروع: {fmtDateTime(m.startedAt, tzOffset)}</span>
                        <span>پایان: {m.endedAt ? fmtDateTime(m.endedAt, tzOffset) : '—'}</span>
                        <span>مدت: {fmtDuration(m.downtimeSec)}</span>
                        <span>تکنسین: {m.technician || '—'}</span>
                        {m.cost ? <span className="num">هزینه: {fmtNumber(m.cost)}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-5">
      {/* سربرگ فشرده: هویت و وضعیت تجهیز، اقدام‌ها و آمار در دو نوار کوتاه */}
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -left-16 -top-20 h-44 w-44 rounded-full bg-brand-400/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-10 -bottom-24 h-44 w-44 rounded-full bg-sun-300/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => navigate('/devices')}
              aria-label="بازگشت به فهرست تجهیزات"
              title="بازگشت"
            >
              <ArrowRight size={15} />
            </button>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow">
              <Server size={20} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="truncate text-base font-bold leading-6 text-ink-800">{device.name}</h2>
                <StatusPill status={device.status} />
                <Badge className={`${PRIORITY_META[device.priority]?.className ?? ''} !px-1.5 !py-0 text-[10px]`}>
                  اولویت {PRIORITY_META[device.priority]?.label}
                </Badge>
                {!device.enabled ? (
                  <Badge tone="ink" className="!px-1.5 !py-0 text-[10px]">
                    غیرفعال
                  </Badge>
                ) : null}
                {!device.monitoringEnabled ? (
                  <Badge tone="sun" className="!px-1.5 !py-0 text-[10px]">
                    پایش غیرفعال
                  </Badge>
                ) : null}
                {device.serviceStatus === 'unavailable' ? (
                  <Badge tone="sun" className="!px-1.5 !py-0 text-[10px]">
                    سرویس{device.servicePort ? ` پورت ${device.servicePort}` : ''} قطع
                  </Badge>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-500">
                <span className="num font-medium text-ink-600">{device.ip}</span>
                <span>{device.deviceType}</span>
                {device.groupName ? (
                  <span
                    className="chip !py-0 text-[10px]"
                    style={{
                      borderColor: `${device.groupColor}44`,
                      background: `${device.groupColor}12`,
                      color: device.groupColor ?? undefined,
                    }}
                  >
                    {device.groupName}
                  </span>
                ) : null}
                {device.location ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={11} />
                    {device.location}
                  </span>
                ) : null}
                {(device.tags || []).slice(0, 2).map((t) => (
                  <span
                    key={t.id}
                    className="chip !py-0 text-[10px]"
                    style={{ borderColor: `${t.color}44`, background: `${t.color}12`, color: t.color }}
                  >
                    {t.name}
                  </span>
                ))}
                {(device.tags || []).length > 2 ? (
                  <span
                    className="text-[10px] text-ink-400"
                    title={(device.tags || []).map((t) => t.name).join('، ')}
                  >
                    +{(device.tags || []).length - 2} برچسب
                  </span>
                ) : null}
              </div>
              {device.statusReason ? (
                <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-soft bg-sun-50 px-2 py-0.5 text-[10.5px] text-warning">
                  <AlertTriangle size={11} />
                  {device.statusReason}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <LayoutToolbar
              editMode={editMode}
              setEditMode={layoutHook.setEditMode}
              layout={layout}
              defs={DETAIL_WIDGETS}
              onAdd={(id) => layoutHook.setVisible(id, true)}
              onReset={layoutHook.reset}
            />
            {canProbe ? (
              <>
                <button type="button" className="btn-primary btn-xs" onClick={ping} disabled={pinging}>
                  <Wifi size={13} />
                  {pinging ? 'در حال ارسال…' : 'Ping لحظه‌ای'}
                </button>
                <button
                  type="button"
                  className={`btn-xs ${livePing.has(device.id) ? 'btn-soft' : 'btn-ghost'}`}
                  onClick={() =>
                    livePing.toggle({ id: device.id, name: device.name, ip: device.ip, status: device.status })
                  }
                  title="پنجرهٔ پینگ زنده"
                  aria-label="پنجرهٔ پینگ زنده"
                  aria-pressed={livePing.has(device.id)}
                >
                  <Gauge size={14} />
                </button>
              </>
            ) : null}
            {canWrite ? (
              <button
                type="button"
                className="btn-ghost btn-xs"
                onClick={() => setEditOpen(true)}
                title="ویرایش تجهیز"
                aria-label="ویرایش تجهیز"
              >
                <Edit3 size={14} />
              </button>
            ) : null}
            {canMaintenance ? (
              <button
                type="button"
                className="btn-ghost btn-xs"
                onClick={() => {
                  setMaintRecord(null);
                  setMaintDefaults({ cause: outages?.open ? 'مشکل شبکه' : undefined, startedAt: device.currentOutageStartedAt ?? Date.now() });
                  setMaintOpen(true);
                }}
                title="ثبت تعمیرات"
                aria-label="ثبت تعمیرات"
              >
                <Wrench size={14} />
              </button>
            ) : null}
            {device.latitude != null ? (
              <Link className="btn-ghost btn-xs" to={`/map?device=${device.id}`} title="نمایش روی نقشه" aria-label="نمایش روی نقشه">
                <MapPin size={14} />
              </Link>
            ) : null}
            {canWrite ? (
              <button
                type="button"
                className="btn-danger btn-xs"
                onClick={removeDevice}
                title="حذف تجهیز"
                aria-label="حذف تجهیز"
              >
                <Trash2 size={14} />
              </button>
            ) : null}
            <button type="button" className="btn-ghost btn-xs" onClick={refresh} title="تازه‌سازی" aria-label="تازه‌سازی">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <div className="relative mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-white/70 bg-surface/60 px-3 py-2 backdrop-blur sm:flex sm:items-center sm:divide-x sm:divide-ink-100/80">
          <MiniStat label="وضعیت فعلی" value={meta.label} tone={meta.text} icon={<Activity size={14} />} />
          <MiniStat
            label="آخرین بررسی"
            value={fmtRelative(device.lastCheckAt)}
            hint={fmtDateTime(device.lastCheckAt, tzOffset)}
            icon={<Clock size={14} />}
          />
          <MiniStat
            label="مدت قطعی فعلی"
            value={device.currentOutageStartedAt ? fmtDuration(currentOutageSec) : '—'}
            tone={device.currentOutageStartedAt ? 'text-danger' : 'text-success'}
            icon={<Timer size={14} />}
          />
          <MiniStat
            label="آخرین قطعی"
            value={fmtRelative(device.lastOutageAt)}
            hint={fmtDateTime(device.lastOutageAt, tzOffset)}
            icon={<ShieldAlert size={14} />}
          />
        </div>
      </Card>

      <DataFreshness updatedAt={updatedAt} intervalMs={20000} onRefresh={refresh} />

      {editMode ? (
        <div className="animate-fade-up rounded-card border border-brand-200 bg-brand-50/70 p-3 text-[12px] text-accent">
          حالت شخصی‌سازی فعال است: ویجت‌ها را بکشید و روی هم رها کنید تا ترتیبشان تغییر کند، اندازه را انتخاب کنید یا آن‌ها را مخفی سازید. برای ارتفاع دلخواه، لبهٔ پایین هر ویجت را به بالا یا پایین بکشید.
        </div>
      ) : null}

      {/* ویجت‌های قابل تنظیم */}
      <div className="grid gap-5 xl:grid-cols-6">
        {layout
          .filter((w) => w.visible)
          .map((w) => (
            <WidgetShell
              key={w.id}
              item={w}
              def={defById[w.id]}
              editMode={editMode}
              dragging={dragging === w.id}
              onDragStart={() => {
                dragId.current = w.id;
                setDragging(w.id);
              }}
              onDragEnd={() => {
                dragId.current = null;
                setDragging(null);
              }}
              onDropOn={() => {
                if (dragId.current) layoutHook.move(dragId.current, w.id);
                dragId.current = null;
                setDragging(null);
              }}
              onSize={(s) => layoutHook.setSize(w.id, s)}
              onHeight={(h) => layoutHook.setHeight(w.id, h)}
              onHide={() => layoutHook.setVisible(w.id, false)}
            >
              {renderWidget(w.id)}
            </WidgetShell>
          ))}
      </div>

      <DeviceAttachments deviceId={device.id} canWrite={canWrite} />

      <DeviceForm open={editOpen} device={device} onClose={() => setEditOpen(false)} onSaved={() => { refresh(); refreshMeta(); }} />
      <MaintenanceForm
        open={maintOpen}
        onClose={() => {
          setMaintOpen(false);
          setMaintRecord(null);
        }}
        record={maintRecord}
        deviceId={device.id}
        outageId={maintRecord ? null : outages?.open?.id ?? null}
        defaults={maintDefaults}
        onSaved={() => {
          // سابقهٔ تازه باید بلافاصله در فهرست همین صفحه دیده شود.
          refreshMaint();
          refreshOutages();
        }}
      />
    </div>
  );
}

/* --------------------------- پیوست‌ها و مستندات --------------------------- */

function formatBytes(bytes: number) {
  if (!bytes) return '۰';
  if (bytes < 1024) return `${faDigits(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${faDigits((bytes / 1024).toFixed(0))} کیلوبایت`;
  return `${faDigits((bytes / 1024 / 1024).toFixed(1))} مگابایت`;
}

function DeviceAttachments({ deviceId, canWrite }: { deviceId: number; canWrite: boolean }) {
  const { push } = useToast();
  const { data, loading, error, refresh } = useAsync((signal) => api.attachments(deviceId, signal), [deviceId]);
  const [preview, setPreview] = useState<import('../lib/types').DeviceAttachment | null>(null);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<{ done: number; total: number } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // پیش‌نمایش تصویر تمام‌صفحه است؛ Escape و کلیک بیرون آن را می‌بندد.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [preview]);

  const upload = async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (!list.length || busy) return;
    const max = data?.maxBytes ?? 50 * 1024 * 1024;
    const accepted = list.filter((f) => {
      if (f.size > max) {
        push(`«${f.name}» بزرگ‌تر از حد مجاز (${formatBytes(max)}) است`, 'error');
        return false;
      }
      return true;
    });
    if (!accepted.length) {
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setBusy(true);
    setQueue({ done: 0, total: accepted.length });
    let ok = 0;
    const errors: string[] = [];
    for (let i = 0; i < accepted.length; i++) {
      try {
        await api.uploadAttachment(deviceId, accepted[i]);
        ok += 1;
      } catch (e) {
        errors.push(`${accepted[i].name}: ${(e as Error).message}`);
      }
      setQueue({ done: i + 1, total: accepted.length });
    }
    setBusy(false);
    setQueue(null);
    if (ok) {
      push(ok === 1 ? 'پیوست افزوده شد' : `${faDigits(ok)} پیوست افزوده شد`, 'success');
      refresh();
    }
    for (const msg of errors.slice(0, 3)) push(msg, 'error');
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = async (att: import('../lib/types').DeviceAttachment) => {
    if (!window.confirm(`پیوست «${att.fileName}» حذف شود؟`)) return;
    try {
      await api.deleteAttachment(deviceId, att.id);
      push('پیوست حذف شد', 'success');
      refresh();
    } catch (e) {
      push((e as Error).message, 'error');
    }
  };

  const items = data?.items ?? [];
  return (
    <Card>
      <CardHeader
        title="مستندات و پیوست‌ها"
        subtitle={data ? `${faDigits(items.length)} فایل · حداکثر ${formatBytes(data.maxBytes)} برای هر فایل` : 'تصویر، PDF یا متن ساده'}
        icon={<Paperclip size={18} />}
        action={
          canWrite ? (
            <div>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain"
                onChange={(e) => upload(e.target.files)}
              />
              <button type="button" className="btn-soft btn-xs" onClick={() => inputRef.current?.click()} disabled={busy}>
                <Upload size={13} />
                {busy && queue ? `در حال بارگذاری ${faDigits(queue.done)}/${faDigits(queue.total)}…` : 'افزودن پیوست (چند فایل)'}
              </button>
            </div>
          ) : null
        }
      />
      {loading && !data ? (
        <div className="mt-4 skeleton h-16" />
      ) : error && !data ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : items.length === 0 ? (
        <EmptyState title="پیوستی ثبت نشده" description="برای مستندسازی نصب، عکس تجهیز یا فایل PDF راهنما را بارگذاری کنید." icon={<Paperclip size={20} />} />
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((att) => (
            <div key={att.id} className="overflow-hidden rounded-soft border border-ink-200 bg-surface/70">
              {att.kind === 'image' ? (
                <button type="button" className="block h-28 w-full overflow-hidden bg-ink-100" onClick={() => setPreview(att)} aria-label={`نمایش ${att.fileName}`}>
                  <img src={att.downloadUrl} alt={att.fileName} className="h-full w-full object-cover" loading="lazy" />
                </button>
              ) : null}
              <div className="p-2.5">
                <p className="flex items-center gap-1 truncate text-[11.5px] font-medium text-ink-700">
                  {att.kind === 'image' ? <ImageIcon size={12} /> : <Paperclip size={12} />}
                  {att.fileName}
                </p>
                <p className="mt-0.5 text-[10px] text-ink-400">
                  {formatBytes(att.sizeBytes)} · {att.uploadedBy || '—'} · {fmtRelative(att.createdAt)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {att.kind === 'image' ? (
                    <button type="button" className="btn-ghost btn-xs" onClick={() => setPreview(att)}>
                      <Eye size={12} /> نمایش
                    </button>
                  ) : null}
                  <a className="btn-ghost btn-xs" href={att.downloadUrl} target="_blank" rel="noreferrer">
                    <FileDown size={12} /> دانلود
                  </a>
                  {canWrite ? (
                    <button type="button" className="btn-ghost btn-xs ms-auto text-danger" onClick={() => remove(att)}>
                      <Trash2 size={12} />
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {/* پیش‌نمایش تصویر در کل صفحه — نه داخل کادر مستندات */}
      {preview
        ? createPortal(
            <div
              className="fixed inset-0 z-[1300] flex flex-col gap-3 bg-ink-950/95 p-3 backdrop-blur-sm sm:p-5"
              role="dialog"
              aria-modal="true"
              aria-label={preview.fileName}
              onClick={() => setPreview(null)}
            >
              <div className="flex shrink-0 items-center justify-between gap-3 text-white" onClick={(e) => e.stopPropagation()}>
                <p className="inline-flex min-w-0 items-center gap-2 truncate text-[13px] font-medium">
                  <ImageIcon size={14} className="shrink-0 opacity-70" />
                  <span className="truncate">{preview.fileName}</span>
                </p>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-white/25 bg-surface/10 px-3 py-1.5 text-[12px] text-white transition hover:border-red-300/60 hover:bg-red-500/80"
                  onClick={() => setPreview(null)}
                  aria-label="بستن پیش‌نمایش"
                >
                  <X size={16} />
                  بستن
                </button>
              </div>

              {/* کادر تصویر: قاب مشخص + دکمهٔ بستن گوشهٔ کادر */}
              <div className="flex min-h-0 flex-1 items-center justify-center" onClick={() => setPreview(null)}>
                <figure
                  className="relative flex max-h-full max-w-full flex-col overflow-hidden rounded-2xl border-2 border-white/25 bg-scrim/70 p-2 shadow-[0_25px_70px_-12px_rgba(0,0,0,0.9)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="absolute end-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full border border-white/40 bg-ink-950/80 text-white shadow-lg transition hover:border-red-300/70 hover:bg-red-500"
                    onClick={() => setPreview(null)}
                    aria-label="بستن تصویر"
                    title="بستن (Esc)"
                  >
                    <X size={16} />
                  </button>
                  <img
                    src={preview.downloadUrl}
                    alt={preview.fileName}
                    className="max-h-[calc(100vh-9rem)] max-w-full rounded-xl bg-ink-950/60 object-contain"
                  />
                  <figcaption className="mt-1.5 flex items-center justify-between gap-3 px-1 text-[10.5px] text-white/70">
                    <span className="truncate">{preview.fileName}</span>
                    <a className="inline-flex shrink-0 items-center gap-1 text-white/80 hover:text-white" href={preview.downloadUrl} target="_blank" rel="noreferrer">
                      <FileDown size={12} /> دانلود
                    </a>
                  </figcaption>
                </figure>
              </div>
            </div>,
            document.body
          )
        : null}
    </Card>
  );
}

/* ------------------------------ helpers ------------------------------ */
function MiniStat({ label, value, hint, icon, tone = 'text-ink-700' }: { label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 sm:px-4 sm:first:ps-0">
      {icon ? (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink-50 text-ink-400">{icon}</span>
      ) : null}
      <div className="min-w-0">
        <p className="truncate text-[9.5px] leading-4 text-ink-400">{label}</p>
        <p className={`truncate text-[12px] font-semibold leading-5 ${tone}`} title={hint}>
          {value}
        </p>
      </div>
    </div>
  );
}

/** کپی امن با بازگشت به execCommand در مرورگرهایی که Clipboard API ندارند. */
async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(area);
  if (!ok) throw new Error('کپی در این مرورگر ممکن نیست؛ رمز را دستی انتخاب کنید.');
}

function InfoRow({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex grow items-center justify-between gap-3 py-2.5">
      <dt className="shrink-0 text-[11.5px] text-ink-400">{label}</dt>
      <dd className="min-w-0 text-left text-[12.5px] font-medium text-ink-700">
        {value}
        {sub ? <span className="mt-0.5 block text-[10.5px] font-normal text-ink-400">{sub}</span> : null}
      </dd>
    </div>
  );
}

function MetricBox({ label, value, tone = 'text-ink-800', small }: { label: string; value: React.ReactNode; tone?: string; small?: boolean }) {
  return (
    <div className="rounded-soft border border-ink-200/70 bg-surface/70 px-3 py-2.5">
      <p className="text-[10.5px] text-ink-400">{label}</p>
      <p className={`mt-1 font-semibold ${small ? 'text-[11.5px]' : 'num text-[15px]'} ${tone}`}>{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-400">{label}</span>
      <span className="num font-medium text-ink-700">{value}</span>
    </div>
  );
}

function SeriesCard({
  metric,
  ranges,
  defaultRange,
  deviceId,
  threshold,
  lossThreshold,
  tzOffset,
  calendar,
}: {
  metric: DailyMetric;
  ranges: ChartRange[];
  defaultRange: ChartRange;
  deviceId: string;
  /** آستانهٔ تأخیر (ms) */
  threshold?: number | null;
  /** آستانهٔ افت بسته (٪) */
  lossThreshold?: number | null;
  tzOffset: number;
  calendar: 'jalali' | 'gregorian';
}) {
  const [range, setRange] = useState<ChartRange>(defaultRange);
  const { data, loading, error, refresh } = useAsync<Series>((signal) => api.series(deviceId, range, signal), [deviceId, range], {
    interval: range === '1h' || range === '6h' ? 60000 : 180000,
  });

  const points = data?.points ?? [];
  const isCalendar = range === '30d';
  const metricThreshold = metric === 'latency' ? threshold : lossThreshold;
  const daily = useMemo(
    () => (isCalendar && data ? buildDailyCalendar(points, { metric, tzOffset, calendar, from: data.from, to: data.to }) : []),
    [isCalendar, data, points, metric, tzOffset, calendar]
  );
  const stats = useMemo(() => summarizeSeries(points, metric, metricThreshold), [points, metric, metricThreshold]);

  const rangeLabels: Record<ChartRange, string> = {
    '1h': '۱ ساعت',
    '6h': '۶ ساعت',
    '24h': '۲۴ ساعت',
    '7d': '۷ روز',
    '30d': '۳۰ روز',
  };
  const title = metric === 'latency' ? 'نمودار Latency' : 'نمودار افت بسته';
  const subtitle = isCalendar
    ? 'هر خانه یک روز — میانگین همان روز'
    : metric === 'latency'
      ? 'تأخیر میانگین هر بازه، همراه آستانه'
      : 'درصد افت بسته در هر بازه، همراه آستانه';

  const chips =
    metric === 'latency'
      ? [
          { label: 'میانگین تأخیر', value: fmtMs(stats.avg), tone: 'text-ink-800' },
          { label: 'کمترین', value: fmtMs(stats.min), tone: 'text-success' },
          {
            label: 'بیشترین',
            value: fmtMs(stats.max),
            tone: metricThreshold != null && (stats.max ?? 0) > metricThreshold ? 'text-danger' : 'text-ink-800',
          },
          {
            label: 'دسترس‌پذیری',
            value: fmtPct(stats.availability, 2),
            tone: (stats.availability ?? 100) < 98 ? 'text-warning' : 'text-success',
          },
        ]
      : [
          { label: 'میانگین افت', value: fmtPct(stats.avg, 1), tone: 'text-ink-800' },
          {
            label: 'بیشترین افت',
            value: fmtPct(stats.max, 1),
            tone: (stats.max ?? 0) > 0 ? 'text-warning' : 'text-success',
          },
          {
            label: 'بازه‌های بالای آستانه',
            value: `${faDigits(stats.over)} از ${faDigits(stats.total)}`,
            tone: stats.over ? 'text-warning' : 'text-success',
          },
          {
            label: 'دسترس‌پذیری',
            value: fmtPct(stats.availability, 2),
            tone: (stats.availability ?? 100) < 98 ? 'text-warning' : 'text-success',
          },
        ];

  return (
    <Card className="flex flex-1 flex-col">
      <CardHeader
        title={title}
        subtitle={subtitle}
        icon={metric === 'latency' ? <Activity size={18} /> : <Percent size={18} />}
        action={
          <Tabs
            size="sm"
            value={range}
            onChange={setRange}
            tabs={ranges.map((r) => ({ value: r, label: rangeLabels[r] }))}
          />
        }
      />
      {loading && !data ? (
        <div className="skeleton mt-3 min-h-[200px] flex-1" />
      ) : error && !data ? (
        <div className="mt-3 min-h-0 flex-1">
          <ErrorState message={error} onRetry={refresh} />
        </div>
      ) : !points.length ? (
        <div className="mt-3 min-h-0 flex-1">
          <EmptyState
            title="داده‌ای برای این بازه ثبت نشده"
            description="بازه دیگری را انتخاب کنید یا منتظر ثبت نمونه‌های جدید توسط موتور مانیتورینگ بمانید."
            icon={<Gauge size={22} />}
          />
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {chips.map((chip) => (
              <div key={chip.label} className="rounded-soft border border-ink-200/70 bg-surface/70 px-2.5 py-1.5">
                <p className="truncate text-[10px] text-ink-400">{chip.label}</p>
                <p className={`num mt-0.5 truncate text-[12.5px] font-semibold ${chip.tone}`}>{chip.value}</p>
              </div>
            ))}
          </div>
          <ChartFill className="mt-3 min-h-0 flex-1" minHeight={isCalendar ? 190 : 170}>
            {(height) =>
              isCalendar ? (
                <DailyCalendarHeatmap
                  days={daily}
                  metric={metric}
                  threshold={metricThreshold}
                  tzOffset={tzOffset}
                  calendar={calendar}
                  height={height}
                />
              ) : metric === 'latency' ? (
                <LatencyAreaChart points={points} range={range} threshold={threshold} height={height} tzOffset={tzOffset} />
              ) : (
                <LossAreaChart points={points} range={range} threshold={lossThreshold} height={height} tzOffset={tzOffset} />
              )
            }
          </ChartFill>
          <p className="mt-2 border-t border-ink-100 pt-2 text-[10.5px] text-ink-400">
            {isCalendar
              ? 'رنگ هر روز فاصلهٔ میانگین آن روز از آستانه است؛ برای جزئیات روی روز کلیک کنید.'
              : 'برای مشاهدهٔ مقدار دقیق هر نقطه، نشانگر را روی نمودار ببرید.'}
          </p>
        </>
      )}
    </Card>
  );
}
