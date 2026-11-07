import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Bell,
  Box,
  Building2,
  CircleSlash,
  Clock,
  Gauge,
  Layers,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Tag as TagIcon,
  Timer,
  TrendingDown,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useAsync, useLiveState } from '../lib/store';
import {
  faDigits,
  fmtDuration,
  fmtMs,
  fmtNumber,
  fmtPct,
  fmtRelative,
  fmtTimezone,
  healthTone,
  SEVERITY_META,
  statusMeta,
} from '../lib/format';
import { Card, CardHeader, ErrorState, HealthRing, PageLoader, Progress, StatCard, StatusLegend, Tabs } from '../components/ui';
import {
  ChartFill,
  DailyBars,
  GroupStatusBar,
  LatencyAreaChart,
  OfflineTrendChart,
  StatusDonut,
  TopBarList,
  TrendLineChart,
} from '../components/charts';
import { LayoutToolbar, WidgetShell, useDragRef, useWidgetLayout, type WidgetDef } from '../components/widgets';
import { ApplicationHealthSection, NetworkHealthSection } from '../components/HealthOverview';
import { DataFreshness } from '../components/Freshness';
import { DASHBOARD_WIDGETS } from '../lib/widgetdefs';
import type { DashboardData, DeviceBreakdownRow } from '../lib/types';

export default function Dashboard() {
  const { settings, tzOffset, status, statusError, refreshStatus } = useApp();
  const live = useLiveState();
  const navigate = useNavigate();
  const lastRefresh = useRef(0);
  const lastSync = useRef(live.syncToken);

  const layoutHook = useWidgetLayout('dashboard_widgets', DASHBOARD_WIDGETS);
  const { layout, editMode } = layoutHook;
  const dragId = useDragRef();
  const [dragging, setDragging] = useState<string | null>(null);

  const { data, loading, error, refresh, updatedAt } = useAsync<DashboardData>((signal) => api.dashboard(signal), [], { interval: 25000 });

  useEffect(() => {
    if (!live.version) return;
    if (Date.now() - lastRefresh.current < 12000) return;
    lastRefresh.current = Date.now();
    refresh();
  }, [live.version, refresh]);

  // پس از اتصال مجدد، Snapshot کامل تازه گرفته می‌شود تا شکاف رویدادها با داده
  // قدیمی پر نشود (اتصال اولیه در mount گرفته شده است).
  useEffect(() => {
    if (live.syncToken === lastSync.current) return;
    lastSync.current = live.syncToken;
    lastRefresh.current = Date.now();
    refresh();
    void refreshStatus();
  }, [live.syncToken, refresh, refreshStatus]);

  if (loading && !data) return <PageLoader label="در حال آماده‌سازی داشبورد…" />;
  if (error && !data) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return null;

  const {
    kpis,
    health,
    statusDistribution,
    offlineTrend,
    outagesPerDay,
    topLatency,
    topDowntime,
    topLoss,
    openOutages,
    breakdowns,
    groupStatus,
    healthTrend,
    recentAlerts,
    degraded,
  } = data;
  const tone = healthTone(health.score);
  const availability = health.availability;
  const defById = Object.fromEntries(DASHBOARD_WIDGETS.map((d) => [d.id, d])) as Record<string, WidgetDef>;

  const healthTrendPoints = healthTrend.map((t) => ({
    label: new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(
      new Date(Date.parse(`${t.day}T12:00:00Z`) + tzOffset * 60000)
    ),
    health: t.health,
    availability: t.availability,
  }));

  const renderWidget = (wid: string): React.ReactNode => {
    switch (wid) {
      case 'kpis':
        return (
          <div className="grid flex-1 auto-rows-fr grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-6">
            <StatCard
              label="کل تجهیزات"
              value={fmtNumber(kpis.total)}
              hint={`${faDigits(kpis.up)} وصل · ${faDigits(kpis.down)} قطع · ${faDigits(kpis.inactive)} غیرفعال`}
              icon={<Server size={20} />}
              tone="brand"
              onClick={() => navigate('/devices')}
            />
            <StatCard
              label="وصل"
              value={fmtNumber(kpis.up)}
              hint={`${faDigits(kpis.online)} سالم · ${faDigits(kpis.warning)} دارای اختلال`}
              icon={<Wifi size={20} />}
              tone="emerald"
              onClick={() => navigate('/devices?status=online')}
            />
            <StatCard
              label="قطع"
              value={fmtNumber(kpis.down)}
              hint="نیازمند بررسی فوری"
              icon={<WifiOff size={20} />}
              tone="red"
              onClick={() => navigate('/devices?status=offline')}
            />
            <StatCard
              label="غیرفعال"
              value={fmtNumber(kpis.inactive)}
              hint={
                kpis.inactive > kpis.disabled
                  ? `${faDigits(kpis.disabled)} غیرفعال · ${faDigits(kpis.inactive - kpis.disabled)} در تعمیرات/نامشخص`
                  : 'خارج از چرخهٔ پایش'
              }
              icon={<CircleSlash size={20} />}
              tone="ink"
              onClick={() => navigate('/devices?enabled=0')}
            />
            <StatCard
              label="دارای اختلال (از وصل)"
              value={fmtNumber(kpis.warning)}
              hint="زیرمجموعهٔ تجهیزات وصل"
              icon={<AlertTriangle size={20} />}
              tone="sun"
              onClick={() => navigate('/devices?status=warning')}
            />
            <StatCard
              label="هشدارهای فعال"
              value={fmtNumber(health.alertsActive)}
              hint={`${faDigits(health.alertCounts?.critical ?? 0)} بحرانی · ${faDigits(kpis.monitoring)} تحت پایش`}
              icon={<Bell size={20} />}
              tone="violet"
              onClick={() => navigate('/alerts')}
            />
          </div>
        );

      case 'network-health':
        return <NetworkHealthSection data={data} tzOffset={tzOffset} />;

      case 'app-health':
        return <ApplicationHealthSection status={status} error={statusError} onRefresh={() => void refreshStatus()} />;

      case 'health':
        return (
          <Card className="flex flex-1 flex-col">
            <CardHeader title="شاخص سلامت شبکه" subtitle="ترکیب دسترس‌پذیری، تأخیر، افت بسته و هشدارها" icon={<ShieldCheck size={18} />} />
            <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-5 sm:flex-row sm:justify-center">
              <HealthRing score={health.score} color={tone.ring} caption={health.grade.label} fluid />
              <div className="w-full max-w-[240px] space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="text-ink-500">دسترس‌پذیری کل (۲۴ ساعت)</span>
                    <span className="num font-semibold text-ink-700">{fmtPct(availability, 2)}</span>
                  </div>
                  <Progress value={availability} color={availability >= 99 ? '#16a34a' : availability >= 95 ? '#f59e0b' : '#dc2626'} />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="text-ink-500">میانگین تأخیر</span>
                    <span className="num font-semibold text-ink-700">{fmtMs(health.avgRtt)}</span>
                  </div>
                  <Progress value={Math.min(100, (health.avgRtt ?? 0) / 2)} color="#2563eb" />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="text-ink-500">میانگین افت بسته</span>
                    <span className="num font-semibold text-ink-700">{fmtPct(health.lossAvg, 2)}</span>
                  </div>
                  <Progress value={Math.min(100, (health.lossAvg ?? 0) * 4)} color="#f59e0b" />
                </div>
                <div className="flex items-center justify-between rounded-soft bg-ink-50 px-3 py-2">
                  <span className="text-[11px] text-ink-500">وضعیت لحظه‌ای</span>
                  <span className={`text-[12px] font-semibold ${tone.text}`}>{health.grade.label}</span>
                </div>
              </div>
            </div>
          </Card>
        );

      case 'distribution':
        return (
          <Card className="flex flex-1 flex-col">
            <CardHeader title="وضعیت لحظه‌ای تجهیزات" subtitle="توزیع وضعیت در بین تجهیزات فعال" icon={<Activity size={18} />} />
            <ChartFill className="mt-3 min-h-0 flex-1" minHeight={170}>
              {(h) => <StatusDonut data={statusDistribution} total={kpis.active} height={h} />}
            </ChartFill>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {statusDistribution.map((s) => (
                <div key={s.key} className="flex items-center justify-between rounded-soft bg-ink-50/70 px-3 py-2">
                  <span className="flex items-center gap-1.5 text-[11px] text-ink-500">
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="num text-[12px] font-semibold text-ink-700">{fmtNumber(s.value)}</span>
                </div>
              ))}
            </div>
          </Card>
        );

      case 'degraded':
        return (
          <Card className="flex flex-1 flex-col">
            <CardHeader title="تجهیزات دارای افت کیفیت" subtitle="شناسایی خودکار اختلال و تأخیر غیرعادی" icon={<TrendingDown size={18} />} />
            <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-auto pe-1">
              {degraded.length === 0 ? (
                <p className="py-8 text-center text-xs text-ink-400">هیچ تجهیز دارای افت کیفیت یافت نشد</p>
              ) : (
                degraded.map((d) => (
                  <Link key={d.id} to={`/devices/${d.id}`} className="flex items-center justify-between gap-3 rounded-soft border border-ink-100 bg-surface/70 px-3 py-2 transition hover:border-brand-200 hover:bg-brand-50/40">
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-ink-700">{d.name}</span>
                      <span className="num block text-[10.5px] text-ink-400">{d.ip}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="num text-[11px] text-ink-500">{fmtMs(d.avgRtt)}</span>
                      <span className={`chip ${statusMeta(d.status).bg} ${statusMeta(d.status).text} ${statusMeta(d.status).border} px-2 py-0.5 text-[10px]`}>{fmtPct(d.uptime, 1)}</span>
                    </span>
                  </Link>
                ))
              )}
            </div>
          </Card>
        );

      case 'offline-trend':
        return (
          <Card className="flex flex-1 flex-col">
            <CardHeader title="تغییرات تعداد تجهیزات قطع‌شده" subtitle="۲۴ ساعت گذشته — بازه‌های ۱۵ دقیقه‌ای" icon={<WifiOff size={18} />} />
            <ChartFill className="mt-3 min-h-0 flex-1" minHeight={140}>
              {(h) => <OfflineTrendChart points={offlineTrend} tzOffset={tzOffset} height={h} />}
            </ChartFill>
          </Card>
        );

      case 'outages-per-day':
        return (
          <Card className="flex flex-1 flex-col">
            <CardHeader title="تعداد قطعی‌ها به تفکیک روز" subtitle="۱۴ روز گذشته" icon={<Zap size={18} />} />
            <ChartFill className="mt-3 min-h-0 flex-1" minHeight={140}>
              {(h) => <DailyBars points={outagesPerDay} tzOffset={tzOffset} height={h} />}
            </ChartFill>
          </Card>
        );

      case 'health-trend':
        return (
          <Card className="flex flex-1 flex-col">
            <CardHeader title="روند شاخص سلامت و دسترس‌پذیری" subtitle="۷ روز گذشته" icon={<ShieldCheck size={18} />} />
            {healthTrendPoints.length ? (
              <ChartFill className="mt-3 min-h-0 flex-1" minHeight={140}>
                {(h) => (
                  <TrendLineChart
                    points={healthTrendPoints}
                    series={[
                      { key: 'health', label: 'شاخص سلامت', color: '#2563eb' },
                      { key: 'availability', label: 'دسترس‌پذیری', color: '#16a34a' },
                    ]}
                    yDomain={[0, 100]}
                    suffix="٪"
                    height={h}
                  />
                )}
              </ChartFill>
            ) : (
              <p className="py-10 text-center text-xs text-ink-400">داده کافی برای نمایش روند وجود ندارد</p>
            )}
          </Card>
        );

      case 'group-status':
        return (
          <Card className="flex flex-1 flex-col">
            <CardHeader title="وضعیت گروه‌های تجهیزات" subtitle="برای فیلتر کردن روی هر گروه کلیک کنید" icon={<Server size={18} />} />
            <ChartFill className="mt-3 min-h-0 flex-1" minHeight={140}>
              {(h) => <GroupStatusBar groups={groupStatus} height={h} onSelect={(name) => navigate(`/devices?group=${encodeURIComponent(name)}`)} />}
            </ChartFill>
          </Card>
        );

      case 'top-latency':
        return (
          <RankedListCard
            title="۱۰ تجهیز با بیشترین تأخیر"
            subtitle="میانگین ۲۴ ساعت گذشته"
            icon={<Timer size={18} />}
            items={topLatency as unknown as Record<string, unknown>[]}
            valueKey="avgRtt"
            formatter={(v) => fmtMs(v)}
            color="#2563eb"
            onSelect={(item) => navigate(`/devices/${item.id}`)}
          />
        );

      case 'top-downtime':
        return (
          <RankedListCard
            title="۱۰ تجهیز با بیشترین قطعی"
            subtitle="مجموع مدت قطعی در ۷ روز گذشته"
            icon={<Clock size={18} />}
            items={topDowntime as unknown as Record<string, unknown>[]}
            valueKey="downtimeSec"
            formatter={(v) => fmtDuration(v)}
            color="#dc2626"
            onSelect={(item) => navigate(`/devices/${item.id}`)}
          />
        );

      case 'top-loss':
        return (
          <RankedListCard
            title="۱۰ تجهیز با بیشترین افت بسته"
            subtitle="درصد بسته‌های از دست رفته در آخرین نمونه‌ها"
            icon={<TrendingDown size={18} />}
            items={topLoss as unknown as Record<string, unknown>[]}
            valueKey="lossPct"
            formatter={(v) => fmtPct(v, 1)}
            color="#dc2626"
            onSelect={(item) => navigate(`/devices/${item.id}`)}
          />
        );

      case 'type-distribution':
        return <BreakdownCard dimension="type" rows={breakdowns?.type ?? []} />;

      case 'group-breakdown':
        return <BreakdownCard dimension="group" rows={breakdowns?.group ?? []} />;

      case 'vendor-breakdown':
        return <BreakdownCard dimension="vendor" rows={breakdowns?.vendor ?? []} />;

      case 'model-breakdown':
        return <BreakdownCard dimension="model" rows={breakdowns?.model ?? []} />;

      case 'tag-breakdown':
        return <BreakdownCard dimension="tag" rows={breakdowns?.tag ?? []} />;

      case 'open-outages':
        return (
          <Card className="flex flex-1 flex-col">
            <CardHeader
              title="قطعی‌های باز"
              subtitle="تجهیزات خارج از دسترس در همین لحظه"
              icon={<WifiOff size={18} />}
              action={
                <Link to="/alerts" className="btn-ghost btn-xs">
                  هشدارها
                </Link>
              }
            />
            <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-auto pe-1">
              {openOutages.length === 0 ? (
                <p className="py-8 text-center text-xs text-ink-400">همهٔ تجهیزات در دسترس هستند</p>
              ) : (
                openOutages.map((o) => (
                  <Link
                    key={o.id}
                    to={`/devices/${o.deviceId}`}
                    className="flex items-center justify-between gap-2 rounded-soft border border-red-100 bg-red-50/40 px-3 py-2 transition hover:border-red-200"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-ink-700">{o.deviceName}</span>
                      <span className="num block text-[10.5px] text-ink-400">
                        {o.ip}
                        {o.groupName ? ` · ${o.groupName}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-left">
                      <span className="num block text-[11.5px] font-semibold text-danger">{fmtDuration(o.durationSec)}</span>
                      <span className="block text-[10px] text-ink-400">از {fmtRelative(o.startedAt)}</span>
                    </span>
                  </Link>
                ))
              )}
            </div>
          </Card>
        );

      case 'recent-alerts':
        return <AlertsCard alerts={recentAlerts} />;

      case 'avg-rtt':
        return (
          <Card className="flex flex-1 flex-col">
            <CardHeader title="میانگین تأخیر شبکه" subtitle="۷ روز گذشته" icon={<Gauge size={18} />} />
            {data.avgRttTrend?.some((d) => d.avgRtt != null) ? (
              <ChartFill className="mt-3 min-h-0 flex-1" minHeight={130}>
                {(h) => (
                  <TrendLineChart
                    points={(data.avgRttTrend ?? []).map((d) => ({
                      label: new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(
                        new Date(Date.parse(`${d.day}T12:00:00Z`) + tzOffset * 60000)
                      ),
                      avgRtt: d.avgRtt ?? null,
                    }))}
                    series={[{ key: 'avgRtt', label: 'میانگین تأخیر', color: '#f59e0b' }]}
                    suffix=" ms"
                    height={h}
                  />
                )}
              </ChartFill>
            ) : (
              <ChartFill className="mt-3 min-h-0 flex-1" minHeight={130}>
                {(h) => <LatencyAreaChart points={offlineTrend.map((o) => ({ t: o.t, rtt: null }))} height={h} tzOffset={tzOffset} />}
              </ChartFill>
            )}
            <div className="mt-3 rounded-soft border border-sun-100 bg-sun-50/70 p-3 text-[11px] text-warning">
              آستانه مجاز تأخیر: <span className="num font-semibold">{faDigits(settings?.latency_threshold ?? 150)} ms</span> — آستانه افت بسته:{' '}
              <span className="num font-semibold">{faDigits(settings?.loss_threshold ?? 10)}٪</span>
            </div>
          </Card>
        );

      case 'quick-links':
        return (
          <Card className="flex flex-1 flex-col">
            <CardHeader title="نکات کاربردی" subtitle="برای دسترسی سریع به بخش‌های کلیدی" icon={<Zap size={18} />} />
            <div className="mt-3 grid min-h-0 flex-1 auto-rows-fr gap-3 md:grid-cols-3">
              <QuickLink to="/devices?status=offline" title="بررسی تجهیزات قطع‌شده" desc="مشاهده و ثبت سابقه برای تجهیزات خارج از دسترس" />
              <QuickLink to="/maintenance" title="ثبت سابقه تعمیرات" desc="ثبت علت خرابی، اقدام انجام‌شده و هزینه نگهداری" />
              <QuickLink to="/map" title="موقعیت جغرافیایی تجهیزات" desc="نمایش تجهیزات روی نقشه آفلاین و مدیریت لایه‌ها" />
            </div>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-800">داشبورد پایش</h2>
          <p className="mt-1 text-xs text-ink-500">
            آخرین به‌روزرسانی {fmtRelative(updatedAt ?? data.generatedAt)} · {faDigits(health.checks24h)} بررسی در ۲۴ ساعت گذشته · به وقت{' '}
            {fmtTimezone(tzOffset)}
            {error ? <span className="text-warning"> · نمایش آخرین دادهٔ موفق (خطا: {error})</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusLegend className="hidden md:flex" />
          <LayoutToolbar
            editMode={editMode}
            setEditMode={layoutHook.setEditMode}
            layout={layout}
            defs={DASHBOARD_WIDGETS}
            onAdd={(id) => layoutHook.setVisible(id, true)}
            onReset={layoutHook.reset}
          />
          <button type="button" className="btn-ghost btn-xs" onClick={refresh}>
            <RefreshCw size={14} />
            به‌روزرسانی
          </button>
          <Link to="/reports" className="btn-soft btn-xs">
            <Gauge size={14} />
            تحلیل کامل
          </Link>
        </div>
      </div>

      <DataFreshness updatedAt={updatedAt ?? data.generatedAt} intervalMs={25000} onRefresh={refresh} />

      {editMode ? (
        <div className="animate-fade-up rounded-card border border-brand-200 bg-brand-50/70 p-3 text-[12px] text-accent">
          حالت شخصی‌سازی فعال است: ویجت‌ها را بکشید و روی هم رها کنید تا جابه‌جا شوند، اندازه انتخاب کنید یا حذف/افزوده کنید. برای ارتفاع دلخواه، لبهٔ پایین هر ویجت را به بالا یا پایین بکشید.
        </div>
      ) : null}

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
    </div>
  );
}

type BreakdownDimension = 'type' | 'group' | 'vendor' | 'model' | 'tag';

const BREAKDOWN_META: Record<
  BreakdownDimension,
  {
    title: string;
    subtitle: string;
    icon: React.ComponentType<{ size?: number | string; className?: string }>;
    /** برچسب ردیف‌هایی که فیلتر مستقیم در صفحهٔ تجهیزات ندارند */
    placeholder?: string;
    /** پارامترهای آدرس صفحهٔ تجهیزات برای دیدن همان دسته */
    filter: (label: string) => string;
  }
> = {
  type: {
    title: 'نوع تجهیز',
    subtitle: 'تعداد و وضعیت اتصال هر نوع',
    icon: Server,
    placeholder: 'نامشخص',
    filter: (label) => `type=${encodeURIComponent(label)}`,
  },
  group: {
    title: 'گروه تجهیزات',
    subtitle: 'توزیع و وضعیت تجهیزات در گروه‌ها',
    icon: Layers,
    placeholder: 'بدون گروه',
    filter: (label) => `group=${encodeURIComponent(label)}`,
  },
  vendor: {
    title: 'سازنده',
    subtitle: 'تعداد تجهیزات هر سازنده',
    icon: Building2,
    placeholder: 'بدون سازنده',
    filter: (label) => `search=${encodeURIComponent(label)}`,
  },
  model: {
    title: 'مدل',
    subtitle: 'تعداد تجهیزات هر مدل',
    icon: Box,
    placeholder: 'بدون مدل',
    filter: (label) => `search=${encodeURIComponent(label)}`,
  },
  tag: {
    title: 'تگ‌ها',
    subtitle: 'تعداد و وضعیت تجهیزات هر تگ',
    icon: TagIcon,
    filter: (label) => `tag=${encodeURIComponent(label)}`,
  },
};

/**
 * ویجت مشترک تفکیک تجهیزات: برای هر دسته، تعداد کل را درشت و تعداد وصل/قطع
 * را با یک نوار باریک نشان می‌دهد؛ کلیک روی هر ردیف فهرست تجهیزات همان دسته
 * را باز می‌کند.
 */
function BreakdownCard({ dimension, rows }: { dimension: BreakdownDimension; rows: DeviceBreakdownRow[] }) {
  const navigate = useNavigate();
  const meta = BREAKDOWN_META[dimension];
  const Icon = meta.icon;

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader title={meta.title} subtitle={meta.subtitle} icon={<Icon size={18} />} />
      {rows.length === 0 ? (
        <p className="py-8 text-center text-xs text-ink-400">داده‌ای برای نمایش نیست</p>
      ) : (
        <>
          <div className="mt-2.5 flex items-center gap-3 text-[10px] text-ink-400">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              وصل
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              قطع
            </span>
          </div>
          <div className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-auto pe-1">
            {rows.map((row) => {
              const upShare = row.total > 0 ? (row.up / row.total) * 100 : 0;
              const downShare = row.total > 0 ? (row.down / row.total) * 100 : 0;
              const placeholder = meta.placeholder != null && row.label === meta.placeholder;
              return (
                <button
                  key={row.label}
                  type="button"
                  disabled={placeholder}
                  onClick={() => navigate(`/devices?${meta.filter(row.label)}`)}
                  title={placeholder ? 'این مورد فیلتر مستقیم ندارد' : `نمایش تجهیزات «${row.label}»`}
                  className="group flex w-full flex-col gap-1 rounded-soft border border-transparent px-2 py-1.5 text-right transition hover:border-ink-100 hover:bg-ink-50/60 disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent"
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-700">{row.label}</span>
                    <span className="num shrink-0 text-lg font-bold leading-none text-ink-800">{fmtNumber(row.total)}</span>
                  </span>
                  <span className="flex w-full items-center gap-2">
                    <span className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-ink-100" aria-hidden>
                      <span className="h-full bg-emerald-500" style={{ width: `${upShare}%` }} />
                      <span className="h-full bg-red-500" style={{ width: `${downShare}%` }} />
                    </span>
                    <span className="num shrink-0 text-[10px] font-semibold text-success">{fmtNumber(row.up)} وصل</span>
                    <span className="num shrink-0 text-[10px] font-semibold text-danger">{fmtNumber(row.down)} قطع</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

/** فهرست رتبه‌بندی‌شده با جست‌وجوی سریع — برای ویجت‌های «بیشترین …» */
function RankedListCard({
  title,
  subtitle,
  icon,
  items,
  valueKey,
  nameKey = 'name',
  formatter,
  color,
  searchHint,
  onSelect,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  items: Record<string, unknown>[];
  valueKey: string;
  nameKey?: string;
  formatter?: (v: number) => string;
  color: string;
  searchHint?: string;
  onSelect?: (item: Record<string, unknown>) => void;
}) {
  const [q, setQ] = useState('');
  const needle = q.trim();
  const filtered = useMemo(() => {
    if (!needle) return items;
    return items.filter((item) =>
      [item[nameKey], item.name, item.ip, item.groupName]
        .filter((v) => v != null)
        .some((v) => String(v).includes(needle))
    );
  }, [items, nameKey, needle]);

  return (
    <Card className="flex flex-1 flex-col">
      <CardHeader title={title} subtitle={subtitle} icon={icon} />
      <div className="relative mt-2">
        <Search size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          className="field !rounded-pill !py-1 pr-7 text-[11px]"
          placeholder={searchHint ?? 'جست‌وجو در این فهرست…'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={`جست‌وجو در ${title}`}
        />
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-auto pe-1">
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-ink-400">موردی با این عبارت یافت نشد</p>
        ) : (
          <TopBarList items={filtered} valueKey={valueKey} nameKey={nameKey} formatter={formatter} color={color} onSelect={onSelect} />
        )}
      </div>
    </Card>
  );
}

const ALERT_FILTERS = [
  { key: 'all', label: 'همه' },
  { key: 'critical', label: 'بحرانی' },
  { key: 'warning', label: 'هشدار' },
  { key: 'info', label: 'اطلاع' },
] as const;

/** آخرین هشدارها با فیلتر شدت — تا در یک نگاه فقط موارد مهم دیده شوند */
function AlertsCard({ alerts }: { alerts: DashboardData['recentAlerts'] }) {
  const [severity, setSeverity] = useState<(typeof ALERT_FILTERS)[number]['key']>('all');
  const counts = useMemo(() => {
    const map: Record<string, number> = { all: alerts.length };
    for (const a of alerts) map[a.severity] = (map[a.severity] ?? 0) + 1;
    return map;
  }, [alerts]);
  const list = severity === 'all' ? alerts : alerts.filter((a) => a.severity === severity);

  return (
    <Card className="flex flex-1 flex-col">
      <CardHeader
        title="آخرین هشدارها"
        subtitle="رویدادهای ثبت‌شده توسط سیستم هشدار"
        icon={<Bell size={18} />}
        action={
          <Link to="/alerts" className="btn-ghost btn-xs">
            همه هشدارها
          </Link>
        }
      />
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {ALERT_FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setSeverity(filter.key)}
            aria-pressed={severity === filter.key}
            className={`rounded-pill border px-2 py-0.5 text-[10.5px] transition ${
              severity === filter.key
                ? 'border-brand-300 bg-brand-50 text-accent'
                : 'border-ink-200 bg-surface/70 text-ink-500 hover:text-ink-700'
            }`}
          >
            {filter.label}
            <span className="num ms-1 text-[9.5px] text-ink-400">{faDigits(counts[filter.key] ?? 0)}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 min-h-0 flex-1 divide-y divide-ink-100 overflow-auto pe-1">
        {list.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-400">هشداری با این شدت ثبت نشده است</p>
        ) : (
          list.map((a) => {
            const sev = SEVERITY_META[a.severity] ?? SEVERITY_META.info;
            return (
              <Link
                key={a.id}
                to={a.deviceId ? `/devices/${a.deviceId}` : '/alerts'}
                className="flex items-start gap-3 py-2.5 transition hover:bg-brand-50/30"
              >
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${sev.dot}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink-700">{a.title}</span>
                  <span className="mt-0.5 line-clamp-1 block text-[11px] text-ink-500">{a.message}</span>
                </span>
                <span className="shrink-0 text-[10.5px] text-ink-400">{fmtRelative(a.createdAt)}</span>
              </Link>
            );
          })
        )}
      </div>
    </Card>
  );
}

function QuickLink({ to, title, desc }: { to: string; title: string; desc: string }) {
  return (
    <Link to={to} className="group flex h-full flex-col justify-center rounded-soft border border-ink-200/70 bg-surface/70 p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft">
      <p className="text-[13px] font-semibold text-ink-700 group-hover:text-accent">{title}</p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">{desc}</p>
    </Link>
  );
}
