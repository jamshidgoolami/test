import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ServerCog,
  Sparkles,
  Thermometer,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useToast } from '../lib/store';
import { useAuth } from '../lib/auth';
import { faDigits, fmtRelative } from '../lib/format';
import { Badge, Card, EmptyState, ErrorState, PageLoader, Progress, StatCard } from '../components/ui';
import ServerForm from '../features/servers/ServerForm';
import AgentTokenDialog from '../features/servers/AgentTokenDialog';
import { HEALTH_META, HealthBadge, formatBitrate, formatPct, formatTemp } from '../features/servers/shared';
import type { ServerHealth, ServerList, ServerMutationResult, ServerSummary } from '../lib/types';

const FILTERS: { value: '' | ServerHealth; label: string }[] = [
  { value: '', label: 'همه' },
  { value: 'ok', label: 'سالم' },
  { value: 'warning', label: 'هشدار' },
  { value: 'critical', label: 'بحرانی' },
  { value: 'unknown', label: 'نامشخص' },
];

function serverMetrics(server: ServerSummary) {
  const agent = server.latest.agent;
  const redfish = server.latest.redfish;
  const ipmi = server.latest.ipmi;
  const bmc = redfish ?? ipmi;
  const demo = server.latest.demo;
  const primary = agent ?? demo ?? bmc;
  return {
    primary,
    cpu: agent?.cpuPct ?? demo?.cpuPct ?? null,
    mem: agent?.memPct ?? demo?.memPct ?? null,
    memUsed: agent?.memUsedBytes ?? demo?.memUsedBytes ?? null,
    memTotal: agent?.memTotalBytes ?? demo?.memTotalBytes ?? null,
    disk: agent?.diskMaxPct ?? demo?.diskMaxPct ?? null,
    temp: redfish?.maxTempC ?? ipmi?.maxTempC ?? demo?.maxTempC ?? agent?.maxTempC ?? null,
    rx: agent?.netRxBps ?? demo?.netRxBps ?? null,
    tx: agent?.netTxBps ?? demo?.netTxBps ?? null,
    power: redfish?.powerWatts ?? ipmi?.powerWatts ?? demo?.powerWatts ?? null,
  };
}

export default function Servers() {
  const [params, setParams] = useSearchParams();
  const { push } = useToast();
  const { can } = useAuth();
  const canWrite = can('servers:write');
  const [search, setSearch] = useState('');
  const [health, setHealth] = useState<'' | ServerHealth>('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ServerSummary | null>(null);
  const [token, setToken] = useState<{ value: string; serverName: string } | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  const { data, loading, error, refresh, refreshing } = useAsync<ServerList>((signal) => api.servers(signal), [], {
    interval: 15000,
  });

  useEffect(() => {
    if (params.get('new') !== '1') return;
    if (canWrite) {
      setEditing(null);
      setFormOpen(true);
    }
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [params, setParams, canWrite]);

  const items = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('fa');
    return (data?.items ?? []).filter((server) => {
      if (health && server.latest.health !== health) return false;
      if (!needle) return true;
      return [server.name, server.osHostname, server.osIp, server.bmcIp, server.model, server.location, server.serial]
        .join(' ')
        .toLocaleLowerCase('fa')
        .includes(needle);
    });
  }, [data?.items, health, search]);

  const summary = data?.summary;

  const onSaved = (result: ServerMutationResult) => {
    push('سرور ذخیره شد.', 'success');
    void refresh();
    if (result.agentToken) setToken({ value: result.agentToken, serverName: result.server.name });
  };

  const createDemo = async () => {
    setDemoBusy(true);
    try {
      const result = await api.createDemoServer({ name: 'سرور نمایشی Supermicro' });
      push(`«${result.server.name}» ساخته شد و دادهٔ نمایشی آن در حال تولید است.`, 'success');
      void refresh();
    } catch (e) {
      push(e instanceof Error ? e.message : 'ساخت سرور نمایشی انجام نشد.', 'error');
    } finally {
      setDemoBusy(false);
    }
  };

  if (loading && !data) return <PageLoader label="در حال خواندن سرورها…" />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void refresh()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink-800">
            <ServerCog size={21} className="text-accent" /> پایش سرورها
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Agent ویندوز برای CPU، رم، هارد و شبکه — Redfish برای دما، فن، توان و سلامت سخت‌افزار Supermicro
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost btn-xs" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> به‌روزرسانی
          </button>
          {canWrite ? (
            <>
              <button type="button" className="btn-ghost btn-xs" onClick={() => void createDemo()} disabled={demoBusy}>
                <Sparkles size={14} /> سرور نمایشی
              </button>
              <button
                type="button"
                className="btn-primary btn-xs"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus size={14} /> افزودن سرور
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="کل سرورها" value={faDigits(summary?.total ?? 0)} hint={`${faDigits(summary?.enabled ?? 0)} فعال`} icon={<ServerCog size={18} />} />
        <StatCard
          label="آنلاین"
          value={faDigits(summary?.online ?? 0)}
          hint={`${faDigits(summary?.stale ?? 0)} بدون دادهٔ تازه`}
          icon={<Activity size={18} />}
          tone="emerald"
        />
        <StatCard
          label="نیازمند بررسی"
          value={faDigits((summary?.warning ?? 0) + (summary?.critical ?? 0))}
          hint={`${faDigits(summary?.critical ?? 0)} بحرانی`}
          icon={<Thermometer size={18} />}
          tone={(summary?.critical ?? 0) > 0 ? 'red' : 'sun'}
        />
        <StatCard
          label="میانگین CPU"
          value={summary?.avgCpuPct == null ? '—' : formatPct(summary.avgCpuPct)}
          hint="از آخرین دادهٔ Agent"
          icon={<Cpu size={18} />}
          tone="violet"
        />
        <StatCard
          label="بیشترین دما"
          value={formatTemp(summary?.maxTempC)}
          hint="از سنسورهای BMC"
          icon={<Thermometer size={18} />}
          tone={(summary?.maxTempC ?? 0) >= 70 ? 'red' : 'sun'}
        />
      </div>

      <Card padded={false} className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="field pr-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جست‌وجوی نام، IP، BMC یا مدل…"
              aria-label="جست‌وجوی سرور"
            />
          </div>
          {FILTERS.map((filter) => (
            <button
              key={filter.value || 'all'}
              type="button"
              onClick={() => setHealth(filter.value)}
              className={`chip border transition ${
                health === filter.value
                  ? 'border-brand-200 bg-brand-50 text-accent'
                  : 'border-ink-200 bg-surface text-ink-500 hover:border-brand-200'
              }`}
            >
              {filter.value ? (
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: HEALTH_META[filter.value].color }} />
              ) : null}
              {filter.label}
            </button>
          ))}
          <span className="ms-auto text-[11px] text-ink-400">{faDigits(items.length)} سرور</span>
        </div>
      </Card>

      {items.length === 0 ? (
        <EmptyState
          title="سروری برای نمایش نیست"
          description={
            search || health
              ? 'فیلتر را تغییر دهید یا جست‌وجو را پاک کنید.'
              : 'اولین سرور Supermicro را اضافه کنید یا برای آشنایی با رابط، یک سرور نمایشی بسازید.'
          }
          icon={<ServerCog size={24} />}
          action={
            canWrite ? (
              <div className="flex gap-2">
                <button type="button" className="btn-primary btn-xs" onClick={() => setFormOpen(true)}>
                  <Plus size={14} /> افزودن سرور
                </button>
                <button type="button" className="btn-ghost btn-xs" onClick={() => void createDemo()} disabled={demoBusy}>
                  <Sparkles size={14} /> سرور نمایشی
                </button>
              </div>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((server) => {
            const m = serverMetrics(server);
            return (
              <Card key={server.id} className="group relative overflow-hidden p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/servers/${server.id}`} className="block truncate text-sm font-semibold text-ink-800 hover:text-accent">
                      {server.name}
                    </Link>
                    <p className="mt-0.5 truncate text-[11px] text-ink-500" dir="ltr">
                      {[server.vendor, server.model].filter(Boolean).join(' ') || 'Supermicro'}
                      {server.osHostname ? ` · ${server.osHostname}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {server.openAlerts > 0 ? <Badge tone="red">{faDigits(server.openAlerts)} هشدار</Badge> : null}
                    <HealthBadge health={server.latest.health} />
                    {canWrite ? (
                      <button
                        type="button"
                        className="btn-ghost btn-xs opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                        onClick={() => {
                          setEditing(server);
                          setFormOpen(true);
                        }}
                        aria-label={`ویرایش ${server.name}`}
                      >
                        <Pencil size={13} />
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone={server.bmcProtocol === 'redfish' || server.bmcProtocol === 'ipmi' ? 'brand' : server.bmcProtocol === 'demo' ? 'violet' : 'ink'}>
                    {server.bmcProtocol === 'redfish' ? 'Redfish' : server.bmcProtocol === 'ipmi' ? 'IPMI' : server.bmcProtocol === 'demo' ? 'نمایشی' : 'بدون BMC'}
                  </Badge>
                  {server.bmcIp ? (
                    <span className="chip border-ink-200 bg-ink-50 text-ink-500" dir="ltr">
                      BMC {server.bmcIp}
                    </span>
                  ) : null}
                  {server.stale ? <Badge tone="sun">دادهٔ قدیمی</Badge> : <Badge tone="emerald">دادهٔ تازه</Badge>}
                </div>

                <div className="mt-4 space-y-3">
                  <MetricBar label="CPU" value={m.cpu} icon={<Cpu size={12} />} color="#2563eb" />
                  <MetricBar label="RAM" value={m.mem} icon={<MemoryStick size={12} />} color="#7c3aed" hint={m.memTotal ? `${formatPct(m.mem)} از ${Math.round(m.memTotal / 1024 ** 3)} GB` : undefined} />
                  <MetricBar label="هارد" value={m.disk} icon={<HardDrive size={12} />} color="#d97706" />
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-ink-100 pt-3 text-[11px]">
                  <span className="inline-flex items-center gap-1 text-ink-500">
                    <Thermometer size={12} className="text-danger" /> {formatTemp(m.temp)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-ink-500" dir="ltr" title="ترافیک ورودی">
                    <Network size={12} className="text-success" /> ↓ {formatBitrate(m.rx)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-ink-500" dir="ltr" title="ترافیک خروجی">
                    <Network size={12} className="text-accent" /> ↑ {formatBitrate(m.tx)}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between text-[10.5px] text-ink-400">
                  <span>آخرین داده: {server.lastSeenAt ? fmtRelative(server.lastSeenAt) : 'هنوز داده‌ای نرسیده'}</span>
                  <Link to={`/servers/${server.id}`} className="font-medium text-accent">
                    جزئیات ←
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ServerForm open={formOpen} server={editing} onClose={() => setFormOpen(false)} onSaved={onSaved} />
      <AgentTokenDialog
        open={!!token}
        token={token?.value ?? null}
        serverName={token?.serverName}
        onClose={() => setToken(null)}
      />
    </div>
  );
}

function MetricBar({
  label,
  value,
  icon,
  color,
  hint,
}: {
  label: string;
  value: number | null;
  icon: React.ReactNode;
  color: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="inline-flex items-center gap-1 text-ink-500">
          {icon} {label}
        </span>
        <span className="num text-ink-700">{formatPct(value)}</span>
      </div>
      <Progress value={value ?? 0} color={color} height={5} />
      {hint ? <p className="mt-0.5 text-[10px] text-ink-400">{hint}</p> : null}
    </div>
  );
}
