import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Cpu,
  HardDrive,
  Info,
  MemoryStick,
  Network,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Thermometer,
  Trash2,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useToast } from '../lib/store';
import { useAuth } from '../lib/auth';
import { faDigits, fmtClock, fmtDateTime, fmtRelative } from '../lib/format';
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageLoader, Tabs } from '../components/ui';
import { TrendLineChart } from '../components/charts';
import ServerForm from '../features/servers/ServerForm';
import AgentTokenDialog from '../features/servers/AgentTokenDialog';
import {
  HealthBadge,
  formatBitrate,
  formatBytes,
  formatNumber,
  formatPct,
  formatTemp,
  formatUptime,
  sourceLabel,
} from '../features/servers/shared';
import type { ServerDetail as ServerDetailData, ServerSeries, ServerSensor } from '../lib/types';

type Range = '1h' | '6h' | '24h' | '7d' | '30d';
type Tab = 'overview' | 'storage' | 'network' | 'bmc';

const RANGES: { value: Range; label: string }[] = [
  { value: '1h', label: '۱ ساعت' },
  { value: '6h', label: '۶ ساعت' },
  { value: '24h', label: '۲۴ ساعت' },
  { value: '7d', label: '۷ روز' },
  { value: '30d', label: '۳۰ روز' },
];

export default function ServerDetail() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const navigate = useNavigate();
  const { push } = useToast();
  const { can } = useAuth();
  const canWrite = can('servers:write');
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState<Range>('1h');
  const [editOpen, setEditOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<'collect' | 'delete' | 'rotate' | null>(null);

  const detail = useAsync<ServerDetailData>((signal) => api.server(id, signal), [id], {
    interval: 20000,
    enabled: Number.isInteger(id) && id > 0,
  });
  const series = useAsync<ServerSeries>((signal) => api.serverMetrics(id, range, signal), [id, range], {
    interval: 30000,
    enabled: Number.isInteger(id) && id > 0,
  });

  const data = detail.data;
  const refreshAll = () => {
    void detail.refresh();
    void series.refresh();
  };

  const collect = async () => {
    if (!data) return;
    setBusy('collect');
    try {
      const result = await api.collectServer(data.id);
      push(
        result.source === 'demo'
          ? 'دادهٔ نمایشی تازه ساخته شد.'
          : `BMC خوانده شد: ${faDigits(result.sensors)} سنسور و ${faDigits(result.disks)} درایو.`,
        'success'
      );
      refreshAll();
    } catch (e) {
      push(e instanceof Error ? e.message : 'خواندن BMC انجام نشد.', 'error');
      void detail.refresh();
    } finally {
      setBusy(null);
    }
  };

  const rotate = async () => {
    if (!data) return;
    if (!window.confirm('توکن فعلی Agent باطل می‌شود و Agent تا تنظیم توکن جدید داده نمی‌فرستد. ادامه می‌دهید؟')) return;
    setBusy('rotate');
    try {
      const result = await api.rotateServerAgentToken(data.id);
      if (result.agentToken) setToken(result.agentToken);
      push('توکن جدید ساخته شد. آن را روی سرور ویندوزی به‌روزرسانی کنید.', 'success');
      void detail.refresh();
    } catch (e) {
      push(e instanceof Error ? e.message : 'ساخت توکن انجام نشد.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!data) return;
    if (!window.confirm(`سرور «${data.name}» و تمام تاریخچهٔ متریک آن حذف شود؟`)) return;
    setBusy('delete');
    try {
      await api.deleteServer(data.id);
      push('سرور حذف شد.', 'success');
      navigate('/servers');
    } catch (e) {
      push(e instanceof Error ? e.message : 'حذف سرور انجام نشد.', 'error');
      setBusy(null);
    }
  };

  const agent = data?.latest.agent;
  const redfish = data?.latest.redfish;
  const ipmi = data?.latest.ipmi;
  const bmc = redfish ?? ipmi;
  const demo = data?.latest.demo;
  const primary = agent ?? demo ?? bmc;

  const chartPoints = useMemo(
    () =>
      (series.data?.points ?? []).map((point) => ({
        label: fmtClock(point.t),
        cpuPct: point.cpuPct,
        memPct: point.memPct,
        rxMbps: point.netRxBps == null ? null : Math.round((point.netRxBps / 1_000_000) * 10) / 10,
        txMbps: point.netTxBps == null ? null : Math.round((point.netTxBps / 1_000_000) * 10) / 10,
        maxTempC: point.maxTempC,
      })),
    [series.data]
  );

  if (!Number.isInteger(id) || id <= 0) return <ErrorState message="شناسهٔ سرور معتبر نیست." />;
  if (detail.loading && !data) return <PageLoader label="در حال خواندن جزئیات سرور…" />;
  if (detail.error && !data) return <ErrorState message={detail.error} onRetry={() => void detail.refresh()} />;
  if (!data) return <ErrorState message="سرور یافت نشد." />;

  const temp = redfish?.maxTempC ?? ipmi?.maxTempC ?? demo?.maxTempC ?? agent?.maxTempC ?? null;
  const cpu = agent?.cpuPct ?? demo?.cpuPct ?? null;
  const memPct = agent?.memPct ?? demo?.memPct ?? null;
  const diskPct = agent?.diskMaxPct ?? demo?.diskMaxPct ?? null;
  const health = data.latest.health;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/servers" className="mb-1 inline-flex items-center gap-1 text-[11px] text-ink-400 hover:text-accent">
            <ArrowRight size={12} /> بازگشت به سرورها
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-bold text-ink-800">{data.name}</h2>
            <HealthBadge health={health} />
            {data.bmcProtocol === 'demo' ? <Badge tone="violet">دادهٔ نمایشی</Badge> : null}
            {!data.enabled ? <Badge tone="ink">غیرفعال</Badge> : null}
            {data.stale ? <Badge tone="sun">دادهٔ قدیمی</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-ink-500" dir="ltr">
            {[data.vendor, data.model].filter(Boolean).join(' ') || 'Supermicro'}
            {data.osHostname ? ` · ${data.osHostname}` : ''}
            {data.osIp ? ` · ${data.osIp}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost btn-xs" onClick={() => void detail.refresh()} disabled={detail.refreshing}>
            <RefreshCw size={14} className={detail.refreshing ? 'animate-spin' : ''} /> به‌روزرسانی
          </button>
          {canWrite && data.bmcProtocol !== 'none' ? (
            <button type="button" className="btn-ghost btn-xs" onClick={() => void collect()} disabled={busy === 'collect'}>
              <ShieldCheck size={14} /> {busy === 'collect' ? 'در حال خواندن BMC…' : 'خواندن BMC'}
            </button>
          ) : null}
          {canWrite ? (
            <>
              <button type="button" className="btn-ghost btn-xs" onClick={() => setEditOpen(true)}>
                <Pencil size={14} /> ویرایش
              </button>
              <button type="button" className="btn-ghost btn-xs text-danger" onClick={() => void remove()} disabled={busy === 'delete'}>
                <Trash2 size={14} /> حذف
              </button>
            </>
          ) : null}
        </div>
      </div>

      {data.lastPollError && data.bmcProtocol !== 'none' ? (
        <div className="rounded-soft border border-red-100 bg-red-50/70 px-3 py-2 text-xs text-danger">
          آخرین خطای BMC: <span dir="auto">{data.lastPollError}</span>
          {data.lastPollAt ? <span className="text-ink-400"> · {fmtRelative(data.lastPollAt)}</span> : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="CPU" value={formatPct(cpu)} hint={agent ? 'Agent ویندوز' : demo ? 'دادهٔ نمایشی' : 'در انتظار Agent'} icon={<Cpu size={17} />} color="#2563eb" />
        <Metric
          label="RAM"
          value={formatPct(memPct)}
          hint={agent?.memTotalBytes ? `${formatBytes(agent.memUsedBytes)} از ${formatBytes(agent.memTotalBytes)}` : demo?.memTotalBytes ? `${formatBytes(demo.memUsedBytes)} از ${formatBytes(demo.memTotalBytes)}` : 'در انتظار Agent'}
          icon={<MemoryStick size={17} />}
          color="#7c3aed"
        />
        <Metric
          label="بیشترین مصرف هارد"
          value={formatPct(diskPct)}
          hint={agent ? `${formatBytes(agent.diskUsedBytes)} از ${formatBytes(agent.diskTotalBytes)}` : demo ? `${formatBytes(demo.diskUsedBytes)} از ${formatBytes(demo.diskTotalBytes)}` : 'در انتظار Agent'}
          icon={<HardDrive size={17} />}
          color="#d97706"
        />
        <Metric label="دما" value={formatTemp(temp)} hint={bmc ? 'بیشترین سنسور BMC' : 'از دادهٔ نمایشی/Agent'} icon={<Thermometer size={17} />} color="#dc2626" />
        <Metric
          label="توان"
          value={
            redfish?.powerWatts == null && ipmi?.powerWatts == null && demo?.powerWatts == null
              ? '—'
              : `${formatNumber(redfish?.powerWatts ?? ipmi?.powerWatts ?? demo?.powerWatts)} W`
          }
          hint="مصرف لحظه‌ای BMC"
          icon={<Zap size={17} />}
          color="#ca8a04"
        />
        <Metric label="Uptime" value={formatUptime(primary?.uptimeSec)} hint={primary ? sourceLabel(primary.source) : 'بدون داده'} icon={<Info size={17} />} color="#0d9488" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'overview', label: 'نمای کلی', icon: <Cpu size={14} /> },
            { value: 'storage', label: 'هاردها', icon: <HardDrive size={14} />, count: data.disks.length },
            { value: 'network', label: 'شبکه', icon: <Network size={14} />, count: data.nics.length },
            { value: 'bmc', label: 'BMC و سخت‌افزار', icon: <ShieldCheck size={14} />, count: data.sensors.length },
          ]}
        />
        {tab === 'overview' || tab === 'network' ? (
          <div className="flex flex-wrap items-center gap-1">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRange(r.value)}
                className={`chip border transition ${
                  range === r.value ? 'border-brand-200 bg-brand-50 text-accent' : 'border-ink-200 bg-surface text-ink-500'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {tab === 'overview' ? (
        <div className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader title="مصرف CPU و RAM" subtitle="تاریخچهٔ Agent، میانگین هر بازه" icon={<Cpu size={16} />} />
              <div className="mt-3">
                {chartPoints.length ? (
                  <TrendLineChart
                    points={chartPoints}
                    height={230}
                    yDomain={[0, 100]}
                    suffix="٪"
                    series={[
                      { key: 'cpuPct', label: 'CPU', color: '#2563eb' },
                      { key: 'memPct', label: 'RAM', color: '#7c3aed' },
                    ]}
                  />
                ) : (
                  <EmptyState title="تاریخچه‌ای وجود ندارد" description="پس از دریافت دادهٔ Agent، نمودار اینجا ساخته می‌شود." />
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="ترافیک شبکه" subtitle="ورودی و خروجی تجمیعی NICها (Mbps)" icon={<Network size={16} />} />
              <div className="mt-3">
                {chartPoints.length ? (
                  <TrendLineChart
                    points={chartPoints}
                    height={230}
                    suffix=" Mbps"
                    series={[
                      { key: 'rxMbps', label: 'ورودی', color: '#16a34a' },
                      { key: 'txMbps', label: 'خروجی', color: '#2563eb' },
                    ]}
                  />
                ) : (
                  <EmptyState title="دادهٔ شبکه‌ای نیست" description="Agent ویندوز شمارندهٔ NICها را هر ۳۰ ثانیه می‌فرستد." />
                )}
              </div>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Card>
              <CardHeader title="دما و فن‌ها" subtitle="سنسورهای BMC / Redfish" icon={<Thermometer size={16} />} />
              <div className="mt-3">
                <SensorTable sensors={data.sensors.filter((s) => s.type === 'temperature' || s.type === 'fan')} compact />
              </div>
            </Card>
            <Card>
              <CardHeader title="شبکه" subtitle="وضعیت لینک و سرعت" icon={<Network size={16} />} />
              <div className="mt-3 space-y-2">
                {data.nics.length ? (
                  data.nics.slice(0, 4).map((nic) => (
                    <div key={nic.key} className="flex items-center justify-between gap-2 border-b border-ink-100 pb-2 last:border-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-ink-700">{nic.name}</p>
                        <p className="truncate text-[10px] text-ink-400" dir="ltr">
                          {nic.mac || '—'} · {sourceLabel(nic.source)}
                        </p>
                      </div>
                      <div className="shrink-0 text-left text-[10.5px]" dir="ltr">
                        <p className="text-ink-600">↓ {formatBitrate(nic.rxBps)}</p>
                        <p className="text-ink-600">↑ {formatBitrate(nic.txBps)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="py-6 text-center text-xs text-ink-400">NIC ثبت نشده است.</p>
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="آخرین وضعیت" subtitle="منبع و زمان داده" icon={<Info size={16} />} />
              <div className="mt-3 space-y-2 text-xs">
                <InfoRow label="Agent" value={data.lastAgentAt ? fmtRelative(data.lastAgentAt) : 'متصل نشده'} />
                <InfoRow label="BMC" value={data.lastPollAt ? fmtRelative(data.lastPollAt) : 'Poll نشده'} />
                <InfoRow label="سلامت" value={<HealthBadge health={health} />} />
                <InfoRow label="منبع اصلی" value={primary ? sourceLabel(primary.source) : '—'} />
                <InfoRow
                  label="آستانه‌های هشدار"
                  value={
                    data.alertEnabled
                      ? `CPU ${faDigits(data.alertCpuPct)}٪ · RAM ${faDigits(data.alertMemPct)}٪ · دما ${faDigits(data.alertTempC)}°C`
                      : 'غیرفعال'
                  }
                />
                {data.openAlerts > 0 ? <InfoRow label="هشدارهای فعال" value={`${faDigits(data.openAlerts)} مورد`} /> : null}
                {agent?.netRxErrors != null || agent?.netTxErrors != null ? (
                  <InfoRow label="خطای شبکه" value={`${faDigits(agent?.netRxErrors ?? 0)} / ${faDigits(agent?.netTxErrors ?? 0)}`} />
                ) : null}
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="روند دما" subtitle="بیشترین دمای سنسور در هر بازه" icon={<Thermometer size={16} />} />
            <div className="mt-3">
              {chartPoints.length ? (
                <TrendLineChart
                  points={chartPoints}
                  height={210}
                  suffix="°C"
                  series={[{ key: 'maxTempC', label: 'بیشترین دما', color: '#dc2626' }]}
                />
              ) : (
                <EmptyState title="دادهٔ دمایی نیست" description="برای دما به BMC متصل شوید یا سرور نمایشی بسازید." />
              )}
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'storage' ? (
        <div className="space-y-3">
          <Card>
            <CardHeader title="درایوها و هاردهای فیزیکی" subtitle="سلامت، دما، عمر و ظرفیت از BMC" icon={<HardDrive size={16} />} />
            <div className="mt-3">
              <DiskTable disks={data.disks.filter((d) => d.kind === 'physical')} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Volumeهای ویندوز" subtitle="مصرف و فضای آزاد از Agent" icon={<HardDrive size={16} />} />
            <div className="mt-3">
              <DiskTable disks={data.disks.filter((d) => d.kind !== 'physical')} />
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'network' ? (
        <div className="space-y-3">
          <Card>
            <CardHeader title="ترافیک ورودی و خروجی" subtitle="Mbps تجمیعی همهٔ NICها" icon={<Network size={16} />} />
            <div className="mt-3">
              {chartPoints.length ? (
                <TrendLineChart
                  points={chartPoints}
                  height={260}
                  suffix=" Mbps"
                  series={[
                    { key: 'rxMbps', label: 'ورودی', color: '#16a34a' },
                    { key: 'txMbps', label: 'خروجی', color: '#2563eb' },
                  ]}
                />
              ) : (
                <EmptyState title="دادهٔ شبکه‌ای نیست" description="Agent ویندوز را روی سرور نصب کنید." />
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="کارت‌های شبکه" subtitle="سرعت لینک، MAC و خطاها" icon={<Network size={16} />} />
            <div className="mt-3 overflow-x-auto">
              {data.nics.length ? (
                <table className="w-full min-w-[680px] text-right text-xs">
                  <thead>
                    <tr className="border-b border-ink-100 text-[11px] text-ink-400">
                      <th className="py-2 font-medium">نام</th>
                      <th className="py-2 font-medium">MAC</th>
                      <th className="py-2 font-medium">وضعیت</th>
                      <th className="py-2 font-medium">سرعت</th>
                      <th className="py-2 font-medium">ورودی</th>
                      <th className="py-2 font-medium">خروجی</th>
                      <th className="py-2 font-medium">خطا (RX/TX)</th>
                      <th className="py-2 font-medium">منبع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.nics.map((nic) => (
                      <tr key={nic.key} className="border-b border-ink-50 last:border-0">
                        <td className="py-2.5 font-medium text-ink-700">{nic.name}</td>
                        <td className="py-2.5 font-mono text-[10.5px] text-ink-500" dir="ltr">{nic.mac || '—'}</td>
                        <td className="py-2.5">
                          <Badge tone={nic.linkStatus === 'up' ? 'emerald' : nic.linkStatus === 'down' ? 'red' : 'ink'}>{nic.linkStatus}</Badge>
                        </td>
                        <td className="py-2.5 text-ink-600" dir="ltr">{formatBitrate(nic.speedBps)}</td>
                        <td className="py-2.5 text-ink-600" dir="ltr">{formatBitrate(nic.rxBps)}</td>
                        <td className="py-2.5 text-ink-600" dir="ltr">{formatBitrate(nic.txBps)}</td>
                        <td className="py-2.5 text-ink-600" dir="ltr">{faDigits(nic.rxErrors ?? 0)} / {faDigits(nic.txErrors ?? 0)}</td>
                        <td className="py-2.5 text-[10.5px] text-ink-400">{sourceLabel(nic.source)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState title="کارت شبکه‌ای ثبت نشده" description="Agent یا BMC هنوز داده‌ای نفرستاده است." />
              )}
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'bmc' ? (
        <div className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader title="اتصال BMC" subtitle="Redfish روی HTTPS یا IPMI 2.0" icon={<ShieldCheck size={16} />} />
              <div className="mt-3 space-y-2 text-xs">
                <InfoRow
                  label="پروتکل"
                  value={
                    data.bmcProtocol === 'redfish'
                      ? 'Redfish'
                      : data.bmcProtocol === 'ipmi'
                        ? 'IPMI 2.0 (ipmitool)'
                        : data.bmcProtocol === 'demo'
                          ? 'نمایشی'
                          : 'غیرفعال'
                  }
                />
                <InfoRow label="آدرس" value={<span dir="ltr">{data.bmcIp || '—'}</span>} />
                <InfoRow label="نام کاربری" value={data.bmcUsername || '—'} />
                <InfoRow label="اعتبارسنجی TLS" value={data.bmcVerifyTls ? 'فعال' : 'غیرفعال'} />
                <InfoRow label="CA سفارشی" value={data.bmcHasCa ? 'ثبت شده' : 'استفاده از CA سیستم'} />
                <InfoRow label="System / Chassis" value={`${data.bmcSystemId} / ${data.bmcChassisId}`} />
                <InfoRow label="فاصلهٔ Polling" value={`${faDigits(data.pollIntervalSec)} ثانیه`} />
                <InfoRow label="آخرین Poll" value={data.lastPollAt ? fmtDateTime(data.lastPollAt) : '—'} />
                <InfoRow
                  label="نتیجهٔ Poll"
                  value={data.lastPollOk === true ? 'موفق' : data.lastPollOk === false ? <span className="text-danger">ناموفق</span> : '—'}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="موجودی سخت‌افزار" subtitle="از SMBIOS/Redfish" icon={<Info size={16} />} />
              <div className="mt-3 space-y-2 text-xs">
                <InfoRow label="سازنده / مدل" value={[data.inventory?.manufacturer, data.inventory?.model].filter(Boolean).join(' ') || '—'} />
                <InfoRow label="سریال" value={<span dir="ltr">{data.inventory?.serial || data.serial || '—'}</span>} />
                <InfoRow label="BIOS" value={data.inventory?.biosVersion || '—'} />
                <InfoRow label="Firmware BMC" value={data.inventory?.bmcFirmware || '—'} />
                <InfoRow label="CPU" value={data.inventory?.cpuModel || '—'} />
                <InfoRow
                  label="هسته / رشته"
                  value={data.inventory?.cpuCores != null ? `${faDigits(data.inventory.cpuCores)} / ${faDigits(data.inventory.cpuThreads ?? 0)}` : '—'}
                />
                <InfoRow label="حافظه" value={formatBytes(data.inventory?.memoryTotalBytes)} />
                <InfoRow label="DIMM / PSU" value={`${faDigits(data.inventory?.dimmCount ?? 0)} / ${faDigits(data.inventory?.psuCount ?? 0)}`} />
                <InfoRow label="سیستم‌عامل" value={data.inventory?.osName || '—'} />
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="سنسورهای BMC" subtitle="دما، فن، ولتاژ و توان" icon={<Thermometer size={16} />} />
            <div className="mt-3">
              <SensorTable sensors={data.sensors} />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Agent ویندوز"
              subtitle="ارسال امن متریک‌های سیستم‌عامل به NetWatch"
              icon={<Cpu size={16} />}
              action={
                canWrite ? (
                  <button type="button" className="btn-ghost btn-xs" onClick={() => void rotate()} disabled={busy === 'rotate'}>
                    <RefreshCw size={13} /> توکن جدید
                  </button>
                ) : null
              }
            />
            <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
              <div className="space-y-2">
                <InfoRow label="وضعیت" value={data.agentConfigured ? 'توکن تعریف شده' : 'بدون توکن'} />
                <InfoRow label="پیشوند توکن" value={<span dir="ltr">{data.agentKeyPrefix || '—'}…</span>} />
                <InfoRow label="ثبت Agent" value={data.agentRegisteredAt ? fmtDateTime(data.agentRegisteredAt) : 'هنوز متصل نشده'} />
                <InfoRow label="آخرین داده" value={data.lastAgentAt ? fmtRelative(data.lastAgentAt) : '—'} />
              </div>
              <div className="rounded-soft border border-ink-100 bg-ink-50/50 p-3 text-[11px] leading-relaxed text-ink-500">
                <p className="font-medium text-ink-600">نصب روی ویندوز</p>
                <p className="mt-1" dir="ltr">
                  powershell -ExecutionPolicy Bypass -File Install-NetWatchAgent.ps1 -ServerUrl https://netwatch.local:8080 -Token &lt;TOKEN&gt;
                </p>
                <p className="mt-1">اسکریپت را از پوشهٔ <code dir="ltr">deploy/server-agent</code> روی سرور کپی کنید. توکن فقط یک‌بار نمایش داده می‌شود.</p>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      <ServerForm
        open={editOpen}
        server={data}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          push('تغییرات سرور ذخیره شد.', 'success');
          void detail.refresh();
        }}
      />
      <AgentTokenDialog open={!!token} token={token} serverName={data.name} onClose={() => setToken(null)} />
    </div>
  );
}

function Metric({ label, value, hint, icon, color }: { label: string; value: string; hint?: string; icon: React.ReactNode; color: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] text-ink-500">{label}</p>
        <span className="shrink-0" style={{ color }}>{icon}</span>
      </div>
      <p className="num mt-1 text-lg font-bold text-ink-800">{value}</p>
      {hint ? <p className="mt-0.5 truncate text-[10px] text-ink-400">{hint}</p> : null}
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-ink-50 pb-1.5 last:border-0 last:pb-0">
      <span className="shrink-0 text-ink-400">{label}</span>
      <span className="min-w-0 text-left text-ink-700">{value}</span>
    </div>
  );
}

function SensorTable({ sensors, compact = false }: { sensors: ServerSensor[]; compact?: boolean }) {
  if (!sensors.length) return <p className="py-6 text-center text-xs text-ink-400">سنسوری ثبت نشده است.</p>;
  return (
    <div className="overflow-x-auto">
      <table className={`w-full ${compact ? '' : 'min-w-[620px]'} text-right text-xs`}>
        <thead>
          <tr className="border-b border-ink-100 text-[11px] text-ink-400">
            <th className="py-2 font-medium">سنسور</th>
            <th className="py-2 font-medium">نوع</th>
            <th className="py-2 font-medium">مقدار</th>
            <th className="py-2 font-medium">وضعیت</th>
            {!compact ? <th className="py-2 font-medium">آستانه</th> : null}
          </tr>
        </thead>
        <tbody>
          {sensors.map((sensor) => (
            <tr key={sensor.key} className="border-b border-ink-50 last:border-0">
              <td className="py-2 text-ink-700">{sensor.name}</td>
              <td className="py-2 text-[10.5px] text-ink-500">{sensorTypeLabel(sensor.type)}</td>
              <td className="py-2 num text-ink-700" dir="ltr">
                {formatNumber(sensor.reading, 1)} {sensor.unit}
              </td>
              <td className="py-2"><HealthBadge health={sensor.status} /></td>
              {!compact ? (
                <td className="py-2 text-[10.5px] text-ink-400" dir="ltr">
                  {sensor.upperCritical != null ? `Crit ${formatNumber(sensor.upperCritical, 0)}` : '—'}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiskTable({ disks }: { disks: NonNullable<ServerDetailData['disks']> }) {
  if (!disks.length) return <p className="py-6 text-center text-xs text-ink-400">درایوی ثبت نشده است.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-right text-xs">
        <thead>
          <tr className="border-b border-ink-100 text-[11px] text-ink-400">
            <th className="py-2 font-medium">نام</th>
            <th className="py-2 font-medium">مسیر / فایل‌سیستم</th>
            <th className="py-2 font-medium">ظرفیت</th>
            <th className="py-2 font-medium">آزاد</th>
            <th className="py-2 font-medium">مصرف</th>
            <th className="py-2 font-medium">دما</th>
            <th className="py-2 font-medium">عمر مصرف‌شده</th>
            <th className="py-2 font-medium">سلامت</th>
            <th className="py-2 font-medium">منبع</th>
          </tr>
        </thead>
        <tbody>
          {disks.map((disk) => (
            <tr key={disk.key} className="border-b border-ink-50 last:border-0">
              <td className="py-2.5 font-medium text-ink-700">{disk.name}</td>
              <td className="py-2.5 text-[10.5px] text-ink-500" dir="ltr">
                {[disk.mount, disk.filesystem].filter(Boolean).join(' · ') || '—'}
              </td>
              <td className="py-2.5 num text-ink-600">{formatBytes(disk.totalBytes)}</td>
              <td className="py-2.5 num text-ink-600">{formatBytes(disk.freeBytes)}</td>
              <td className="py-2.5 text-ink-600">{formatPct(disk.usedPct)}</td>
              <td className="py-2.5 text-ink-600">{formatTemp(disk.temperatureC)}</td>
              <td className="py-2.5 text-ink-600">{disk.wearPct == null ? '—' : formatPct(disk.wearPct)}</td>
              <td className="py-2.5"><HealthBadge health={disk.health} /></td>
              <td className="py-2.5 text-[10.5px] text-ink-400">{sourceLabel(disk.source)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sensorTypeLabel(type: string): string {
  if (type === 'temperature') return 'دما';
  if (type === 'fan') return 'فن';
  if (type === 'voltage') return 'ولتاژ';
  if (type === 'power') return 'توان';
  return 'سایر';
}
