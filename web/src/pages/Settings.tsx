import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, BookOpen, Database, Gamepad2, Layers, LayoutGrid, Map as MapIcon, MonitorSmartphone, Palette, Pause, Play, RefreshCw, RotateCcw, Save, Server, Settings2, Tag as TagIcon, Trash2, TriangleAlert, Users, Wrench } from 'lucide-react';
import { api } from '../lib/api';
import { MODE_LABEL } from '../components/Layout';
import { useApp, useAsync, useToast } from '../lib/store';
import { useUrlParams } from '../lib/params';
import { useAuth } from '../lib/auth';
import { faDigits, fmtDateTime, fmtNumber, fmtRelative } from '../lib/format';
import { Badge, Card, CardHeader, EmptyState, Field, PageLoader, Toggle } from '../components/ui';

import { ThemeSegmented } from '../components/ThemeToggle';


import { InfoCell } from '../features/settings/components/InfoCell';
import { GroupsTab } from '../features/settings/tabs/GroupsTab';
import { TagsTab } from '../features/settings/tabs/TagsTab';
import { DeviceTypesTab } from '../features/settings/tabs/DeviceTypesTab';
import { LayersTab } from '../features/settings/tabs/LayersTab';
import { WidgetLayoutTab } from '../features/settings/tabs/WidgetLayoutTab';
import { RepairTab } from '../features/settings/tabs/RepairTab';
import { UsersTab } from '../features/settings/tabs/UsersTab';
import type { AppSettings } from '../lib/types';

type TabKey = 'general' | 'engine' | 'display' | 'groups' | 'tags' | 'types' | 'layers' | 'widgets' | 'repair' | 'data' | 'users';

const SETTINGS_GROUPS: { label: string; tabs: TabKey[] }[] = [
  { label: 'پایه', tabs: ['general', 'display'] },
  { label: 'پایش و نگهداری', tabs: ['engine', 'repair'] },
  { label: 'داده و دارایی', tabs: ['groups', 'tags', 'types', 'layers', 'widgets'] },
  { label: 'سیستم', tabs: ['data', 'users'] },
];

/** کلیدهای هر بخش برای نشان‌دادن تغییرات ذخیره‌نشده و ذخیرهٔ بخشی. */
const TAB_SETTING_KEYS: Record<TabKey, string[]> = {
  general: ['site_name', 'calendar', 'timezone_offset_minutes', 'chart_default_range', 'notify_browser', 'engine_enabled'],
  engine: [
    'engine_mode', 'ping_interval', 'timeout_ms', 'retries', 'packet_count', 'max_workers', 'latency_threshold',
    'loss_threshold', 'failures_for_offline', 'successes_for_online', 'tcp_port', 'probe_allowed_cidrs',
  ],
  display: ['map_default_center', 'map_default_zoom', 'map_show_labels'],
  repair: ['repair_causes', 'repair_actions'],
  data: [
    'retention_enabled', 'retention_legal_hold', 'retention_run_time', 'retention_interval_minutes',
    'retention_batch_size', 'retention_max_rows_per_run', 'samples_retention_days', 'daily_stats_retention_days',
    'outages_retention_days', 'alerts_retention_days', 'audit_retention_days', 'engine_log_retention_days',
    'retention_prune_backups', 'backup_daily_keep', 'backup_weekly_keep', 'backup_interval_hours',
    'backup_enabled', 'backup_prune_enabled',
  ],
  groups: [],
  tags: [],
  types: [],
  layers: [],
  widgets: [],
  users: [],
};

export default function Settings() {
  const { settings, saveSettings, refreshSettings, refreshMeta, engine } = useApp();
  const { push } = useToast();
  const { can } = useAuth();
  const canWrite = can('settings:write');
  const canUsers = can('users:manage');
  const { params, setParam } = useUrlParams();
  const tabKeys: TabKey[] = [
    ...(['general', 'engine', 'display', 'groups', 'tags', 'types', 'layers', 'widgets', 'repair', 'data'] as TabKey[]),
    ...(canUsers ? (['users'] as TabKey[]) : []),
  ];
  const tabParam = params.get('tab') as TabKey | null;
  const tab: TabKey = tabParam && tabKeys.includes(tabParam) ? tabParam : 'general';
  const setTab = (key: TabKey) => setParam('tab', key === 'general' ? '' : key);
  const [tabSearch, setTabSearch] = useState('');
  const [local, setLocal] = useState<AppSettings | null>(settings);
  // متن خام فیلد محدودهٔ Probe؛ تا هنگام تایپ CIDR ناقص، مقدار آرایهٔ تنظیمات
  // با هر کلید پاک نشود و متن تایپ‌شده حفظ بماند.
  const [cidrText, setCidrText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setLocal(settings);
      setCidrText((settings.probe_allowed_cidrs ?? []).join(', '));
    }
  }, [settings]);

  const { data: engineData, refresh: refreshEngine } = useAsync((signal) => api.engineStatus(signal), [], { interval: 15000 });
  const { refresh: refreshLayers } = useAsync((signal) => api.layers(signal), []);
  const { data: retentionData, refresh: refreshRetention } = useAsync(
    (signal) => api.retentionStatus(signal),
    [],
    { interval: 15000 }
  );
  const { data: backupData, refresh: refreshBackup } = useAsync(
    (signal) => api.backupStatus(signal),
    [],
    { interval: 30000 }
  );

  const dirtyKeys = useMemo(() => {
    if (!local || !settings) return [] as string[];
    const current = local as unknown as Record<string, unknown>;
    const saved = settings as unknown as Record<string, unknown>;
    return Object.keys(current).filter((key) => JSON.stringify(current[key]) !== JSON.stringify(saved[key]));
  }, [local, settings]);

  if (!local) return <PageLoader label="در حال دریافت تنظیمات…" />;

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => setLocal((s) => (s ? { ...s, [k]: v } : s));

  const persist = async (patch?: Partial<AppSettings>) => {
    // ذخیرهٔ مکرر تنظیمات با کلیک سریع، چند PUT پشت‌سرهم می‌فرستاد
    if (saving) return;
    if (!canWrite) {
      push('نقش شما اجازهٔ تغییر تنظیمات را ندارد.', 'warning');
      return;
    }
    setSaving(true);
    try {
      const rejected = await saveSettings(patch ?? local);
      if (rejected.length) {
        // سرور مقدارهای نامعتبر را رد می‌کند و مقدار قبلی را نگه می‌دارد؛ بدون این
        // پیام، کاربر فکر می‌کند مقدار ناقص ذخیره شده است.
        push(`برخی مقدارها نامعتبر بودند و ذخیره نشدند: ${rejected.join('، ')}`, 'warning');
      } else {
        push('تنظیمات ذخیره شد', 'success');
      }
      refreshEngine();
    } catch (e) {
      push((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const tabDirty = dirtyKeys.some((key) => (TAB_SETTING_KEYS[tab] ?? []).includes(key));
  const persistCurrent = async () => {
    const keys = (TAB_SETTING_KEYS[tab] ?? []).filter((key) => dirtyKeys.includes(key));
    if (!keys.length) {
      push('در این بخش تغییر ذخیره‌نشده‌ای وجود ندارد.', 'info');
      return;
    }
    const patch = Object.fromEntries(keys.map((key) => [key, (local as unknown as Record<string, unknown>)[key]]));
    await persist(patch as Partial<AppSettings>);
  };

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'general', label: 'عمومی', icon: <Settings2 size={14} /> },
    { key: 'engine', label: 'موتور مانیتورینگ', icon: <Activity size={14} /> },
    { key: 'display', label: 'نمایش و نقشه', icon: <Palette size={14} /> },
    { key: 'groups', label: 'گروه‌ها', icon: <Layers size={14} /> },
    { key: 'tags', label: 'تگ‌ها', icon: <TagIcon size={14} /> },
    { key: 'types', label: 'انواع تجهیزات', icon: <Server size={14} /> },
    { key: 'layers', label: 'لایه‌های نقشه', icon: <MapIcon size={14} /> },
    { key: 'widgets', label: 'چیدمان ویجت‌ها', icon: <LayoutGrid size={14} /> },
    { key: 'repair', label: 'علت‌ها و اقدامات', icon: <Wrench size={14} /> },
    { key: 'data', label: 'داده‌ها و نگهداری', icon: <Database size={14} /> },
    ...(canUsers ? [{ key: 'users' as TabKey, label: 'کاربران', icon: <Users size={14} /> }] : []),
  ];

  const visibleTabs = tabs.filter((item) => !tabSearch.trim() || item.label.includes(tabSearch.trim()));

  return (
    <div className="grid gap-4 xl:grid-cols-[236px_minmax(0,1fr)] xl:items-start">
      <Card padded={false} className="xl:sticky xl:top-4">
        <div className="border-b border-ink-100 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-ink-800">تنظیمات</p>
            <Link to="/docs" className="btn-ghost btn-xs text-accent" title="مستندات و راهنما">
              <BookOpen size={14} />
              مستندات
            </Link>
          </div>
          <input
            className="field mt-2 !py-1.5 !text-[12px]"
            placeholder="جست‌وجوی بخش تنظیمات…"
            value={tabSearch}
            onChange={(event) => setTabSearch(event.target.value)}
            aria-label="جست‌وجوی بخش تنظیمات"
          />
        </div>
        <nav className="max-h-[calc(100dvh-18rem)] space-y-3 overflow-y-auto p-2" aria-label="بخش‌های تنظیمات">
          {SETTINGS_GROUPS.map((group) => {
            const groupTabs = visibleTabs.filter((item) => group.tabs.includes(item.key));
            if (!groupTabs.length) return null;
            return (
              <div key={group.label} className="space-y-1">
                <p className="px-2 py-1 text-[12px] font-semibold text-ink-400">{group.label}</p>
                {groupTabs.map((item) => {
                  const dot = (TAB_SETTING_KEYS[item.key] ?? []).some((key) => dirtyKeys.includes(key));
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setTab(item.key)}
                      aria-current={tab === item.key ? 'page' : undefined}
                      className={`flex w-full items-center gap-2 rounded-soft px-2.5 py-2 text-right text-[12.5px] transition ${
                        tab === item.key ? 'bg-brand-50 font-medium text-accent' : 'text-ink-600 hover:bg-ink-50'
                      }`}
                    >
                      {item.icon}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {dot ? <span className="h-2 w-2 shrink-0 rounded-full bg-sun-500" title="تغییر ذخیره‌نشده" /> : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="space-y-2 border-t border-ink-100 p-3">
          <p className="text-[12px] text-ink-400">
            {dirtyKeys.length ? `${faDigits(dirtyKeys.length)} تغییر ذخیره‌نشده` : 'همهٔ تغییرات ذخیره شده‌اند'}
          </p>
          {canWrite ? (
            <button type="button" className="btn-primary btn-xs w-full" onClick={() => void persistCurrent()} disabled={saving || !tabDirty}>
              <Save size={14} />
              {saving ? 'در حال ذخیره…' : `ذخیرهٔ ${tabs.find((item) => item.key === tab)?.label ?? 'بخش'}`}
            </button>
          ) : (
            <span className="chip border-ink-200 bg-ink-50 text-ink-500">دسترسی فقط‌خواندنی</span>
          )}
        </div>
      </Card>

      <div className="min-w-0 space-y-4">
      {!canWrite ? (
        <div className="rounded-card border border-sun-200 bg-sun-50/70 px-4 py-3 text-[11.5px] leading-relaxed text-warning" role="status">
          نقش شما اجازهٔ تغییر تنظیمات را ندارد؛ مقادیر فقط برای مشاهده نمایش داده می‌شوند. عملیات مدیریتی (پشتیبان‌گیری، Retention و بازنشانی) نیز در صورت نداشتن مجوز توسط سرور رد می‌شوند.
        </div>
      ) : null}

      {tab === 'general' ? (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="تنظیمات عمومی" subtitle="نام سامانه و قالب نمایش تاریخ" icon={<Settings2 size={18} />} />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="نام سامانه / مرکز پایش">
                <input className="field" value={local.site_name} onChange={(e) => set('site_name', e.target.value)} />
              </Field>
              <Field label="قالب تقویم">
                <select className="field" value={local.calendar} onChange={(e) => set('calendar', e.target.value as AppSettings['calendar'])}>
                  <option value="jalali">شمسی (هجری خورشیدی)</option>
                  <option value="gregorian">میلادی</option>
                </select>
              </Field>
              <Field label="اختلاف زمانی نمایش (دقیقه)" hint="برای منطقه زمانی ایران: ۲۱۰ دقیقه">
                <input type="number" dir="ltr" className="field num" value={local.timezone_offset_minutes} onChange={(e) => set('timezone_offset_minutes', Number(e.target.value) || 0)} />
              </Field>
              <Field label="بازه پیش‌فرض نمودارها">
                <select className="field" value={local.chart_default_range} onChange={(e) => set('chart_default_range', e.target.value as AppSettings['chart_default_range'])}>
                  <option value="15m">۱۵ دقیقه</option>
                  <option value="1h">۱ ساعت</option>
                  <option value="6h">۶ ساعت</option>
                  <option value="24h">۲۴ ساعت</option>
                  <option value="7d">۷ روز</option>
                </select>
              </Field>
              <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
                <Toggle checked={local.notify_browser} onChange={(v) => set('notify_browser', v)} label="نمایش اعلان هشدارها در رابط کاربری" hint="هشدارهای جدید به‌صورت پیام کوتاه نمایش داده می‌شوند" />
                <Toggle checked={local.notify_sound} onChange={(v) => set('notify_sound', v)} label="پخش صدای اژیر برای هشدار سرورها" hint="با اولین کلیک/کلید در صفحه فعال می‌شود؛ صدای اژیر فقط برای عبور از آستانه‌های سرور پخش می‌شود." />
                <Toggle checked={local.engine_enabled} onChange={(v) => set('engine_enabled', v)} label="موتور مانیتورینگ فعال باشد" hint="غیرفعال کردن، بررسی خودکار تجهیزات را متوقف می‌کند" />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="وضعیت موتور مانیتورینگ" subtitle="کنترل اجرای مستقل موتور" icon={<Activity size={18} />} />
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-soft bg-ink-50 px-3 py-2.5">
                <span className="text-[12px] text-ink-500">وضعیت</span>
                <Badge tone={engineData?.running ? 'emerald' : 'red'}>{engineData?.running ? 'در حال اجرا' : 'متوقف'}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                <InfoCell label="حالت" value={MODE_LABEL[engineData?.mode ?? ''] ?? '—'} />
                <InfoCell label="بازه بررسی" value={`${faDigits(engineData?.interval ?? 0)} ثانیه`} />
                <InfoCell label="چرخه‌ها" value={fmtNumber(engineData?.cycles ?? 0)} />
                <InfoCell label="بررسی‌ها" value={fmtNumber(engineData?.checksRun ?? 0)} />
                <InfoCell label="همزمانی" value={fmtNumber(engineData?.maxWorkers ?? 0)} />
                <InfoCell label="در حال اجرا" value={fmtNumber(engineData?.inflight ?? 0)} />
                <InfoCell label="رد شده" value={fmtNumber(engineData?.skipped ?? 0)} />
                <InfoCell label="خطاها" value={fmtNumber(engineData?.errors ?? 0)} />
              </div>
              <div className="rounded-soft border border-ink-200 bg-surface/70 p-3 text-[11px] text-ink-500">
                <p className="flex items-center justify-between">
                  <span>دسترسی ICMP</span>
                  <Badge tone={engineData?.icmpAvailable ? 'emerald' : 'sun'}>{engineData?.icmpAvailable ? 'فعال' : 'در دسترس نیست'}</Badge>
                </p>
                <p className="mt-2 leading-relaxed">
                  در صورت در دسترس نبودن ICMP (نبود مجوز RAW socket)، بررسی‌ها روی TCP انجام می‌شود. برای ICMP واقعی، برنامه را با دسترسی مناسب اجرا کنید.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-soft btn-xs" onClick={async () => { await api.engineControl('restart'); push('موتور بازراه‌اندازی شد', 'success'); refreshEngine(); }}>
                  <RotateCcw size={13} />
                  بازراه‌اندازی
                </button>
                <button type="button" className="btn-ghost btn-xs" onClick={async () => { await api.engineControl('start'); refreshEngine(); }}>
                  <Play size={13} />
                  شروع
                </button>
                <button type="button" className="btn-ghost btn-xs" onClick={async () => { await api.engineControl('stop'); refreshEngine(); }}>
                  <Pause size={13} />
                  توقف
                </button>
                <button type="button" className="btn-ghost btn-xs" onClick={async () => { const r = await api.checkAll(); push(`بررسی همه تجهیزات آغاز شد (${faDigits(r.queued)} تجهیز)`, 'success'); refreshEngine(); }}>
                  <RefreshCw size={13} />
                  بررسی همه تجهیزات
                </button>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'engine' ? (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="تنظیمات موتور مانیتورینگ" subtitle="کنترل بازه‌ها، آستانه‌ها و تشخیص وضعیت" icon={<Activity size={18} />} />
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="حالت بررسی" hint="auto: ICMP و در صورت نبود مجوز TCP؛ simulate: داده نمونه">
                <select className="field" value={local.engine_mode} onChange={(e) => set('engine_mode', e.target.value as AppSettings['engine_mode'])}>
                  <option value="auto">خودکار (ICMP/TCP)</option>
                  <option value="icmp">فقط ICMP</option>
                  <option value="tcp">فقط TCP</option>
                  <option value="simulate">شبیه‌سازی (دمو)</option>
                </select>
              </Field>
              <Field label="بازه پیش‌فرض Ping (ثانیه)">
                <input type="number" min={5} dir="ltr" className="field num" value={local.ping_interval} onChange={(e) => set('ping_interval', Number(e.target.value) || 30)} />
              </Field>
              <Field label="زمان انتظار پاسخ (ms)">
                <input type="number" min={100} dir="ltr" className="field num" value={local.timeout_ms} onChange={(e) => set('timeout_ms', Number(e.target.value) || 1200)} />
              </Field>
              <Field label="تعداد تلاش مجدد">
                <input type="number" min={0} max={5} dir="ltr" className="field num" value={local.retries} onChange={(e) => set('retries', Number(e.target.value) || 0)} />
              </Field>
              <Field label="تعداد Packet در هر بررسی">
                <input type="number" min={1} max={10} dir="ltr" className="field num" value={local.packet_count} onChange={(e) => set('packet_count', Number(e.target.value) || 1)} />
              </Field>
              <Field label="حداکثر همزمانی (تجهیز)">
                <input type="number" min={1} max={512} dir="ltr" className="field num" value={local.max_workers} onChange={(e) => set('max_workers', Number(e.target.value) || 64)} />
              </Field>
              <Field label="آستانه مجاز تأخیر (ms)">
                <input type="number" min={1} dir="ltr" className="field num" value={local.latency_threshold} onChange={(e) => set('latency_threshold', Number(e.target.value) || 150)} />
              </Field>
              <Field label="آستانه مجاز افت بسته (٪)">
                <input type="number" min={0} max={100} dir="ltr" className="field num" value={local.loss_threshold} onChange={(e) => set('loss_threshold', Number(e.target.value) || 10)} />
              </Field>
              <Field label="شکست متوالی برای وضعیت قطع">
                <input type="number" min={1} dir="ltr" className="field num" value={local.failures_for_offline} onChange={(e) => set('failures_for_offline', Number(e.target.value) || 3)} />
              </Field>
              <Field label="پاسخ موفق متوالی برای بازگشت به وضعیت وصل">
                <input type="number" min={1} dir="ltr" className="field num" value={local.successes_for_online} onChange={(e) => set('successes_for_online', Number(e.target.value) || 2)} />
              </Field>
              <Field label="پورت بررسی TCP">
                <input type="number" min={1} max={65535} dir="ltr" className="field num" value={local.tcp_port} onChange={(e) => set('tcp_port', Number(e.target.value) || 80)} />
              </Field>
              <div className="sm:col-span-2 lg:col-span-3">
                <Field
                  label="محدودهٔ مقاصد مجاز Probe (CIDR)"
                  hint="هر CIDR با ویرگول جدا شود؛ مثال: 10.0.0.0/8, 192.168.0.0/16. برای پذیرش همهٔ مقاصد (شامل اینترنت): 0.0.0.0/0, ::/0. آدرس‌های Link-Local و Cloud Metadata باز هم مسدود می‌مانند و تغییر بلافاصله اعمال می‌شود."
                >
                  <input
                    dir="ltr"
                    className="field"
                    placeholder="10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16"
                    value={cidrText}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCidrText(v);
                      set('probe_allowed_cidrs', v.split(',').map((s) => s.trim()).filter(Boolean));
                    }}
                  />
                </Field>
              </div>
            </div>
            <p className="mt-4 rounded-soft border border-brand-100 bg-brand-50/60 p-3 text-[11.5px] leading-relaxed text-accent">
              بازه بررسی را می‌توان برای هر گروه یا هر تجهیز به‌صورت مستقل تعیین کرد (از صفحه ویرایش تجهیز یا ویرایش گروهی). مقدار تعریف‌شده در تجهیز، بر مقدار عمومی اولویت دارد.
            </p>
          </Card>

          <Card>
            <CardHeader title="آخرین رویدادهای موتور" subtitle="گزارش فعالیت و خطاها" icon={<MonitorSmartphone size={18} />} action={<button type="button" className="btn-ghost btn-xs" onClick={refreshEngine}><RefreshCw size={13} /></button>} />
            <div className="mt-3 max-h-[460px] space-y-2 overflow-y-auto">
              {(engineData?.lastLogs ?? []).map((l, i) => (
                <div key={i} className="rounded-soft border border-ink-100 bg-surface/70 px-3 py-2">
                  <p className="text-[11.5px] text-ink-600">{l.message}</p>
                  <p className="mt-0.5 text-[10px] text-ink-400">
                    {fmtDateTime(l.ts, local.timezone_offset_minutes)} · {l.level}
                  </p>
                </div>
              ))}
              {(engineData?.lastLogs ?? []).length === 0 ? <EmptyState title="رویدادی ثبت نشده" /> : null}
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'display' ? (
        <Card>
          <CardHeader title="نمایش، نقشه و تجربه کاربری" subtitle="تنظیمات ظاهری و پیش‌فرض‌های نقشه" icon={<Palette size={18} />} />
          {/* تم فقط روی همین مرورگر ذخیره می‌شود (localStorage) و به سرور نمی‌رود. */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-soft border border-ink-200 bg-ink-50/60 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-ink-700">تم رابط کاربری</p>
              <p className="mt-0.5 text-[11px] text-ink-400">
                تم تاریک برای اتاق مانیتورینگ و استفادهٔ شبانه؛ گزینهٔ هم‌سیستم ترجیح سیستم‌عامل را دنبال می‌کند.
              </p>
            </div>
            <ThemeSegmented />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="عرض جغرافیایی مرکز نقشه">
              <input dir="ltr" className="field num" value={local.map_default_center?.[0] ?? 35.6892} onChange={(e) => set('map_default_center', [Number(e.target.value) || 0, local.map_default_center?.[1] ?? 51.389])} />
            </Field>
            <Field label="طول جغرافیایی مرکز نقشه">
              <input dir="ltr" className="field num" value={local.map_default_center?.[1] ?? 51.389} onChange={(e) => set('map_default_center', [local.map_default_center?.[0] ?? 35.6892, Number(e.target.value) || 0])} />
            </Field>
            <Field label="زوم پیش‌فرض نقشه">
              <input type="number" min={2} max={18} dir="ltr" className="field num" value={local.map_default_zoom} onChange={(e) => set('map_default_zoom', Number(e.target.value) || 6)} />
            </Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <Toggle checked={local.map_show_labels} onChange={(v) => set('map_show_labels', v)} label="نمایش برچسب تگ‌ها روی نشانگرهای نقشه" hint="تگ‌هایی که گزینه نمایش روی نقشه دارند به‌صورت برچسب کنار نشانگر نمایش داده می‌شوند" />
            </div>
          </div>
        </Card>
      ) : null}

      {tab === 'groups' ? <GroupsTab /> : null}
      {tab === 'tags' ? <TagsTab /> : null}
      {tab === 'types' ? <DeviceTypesTab /> : null}
      {tab === 'layers' ? <LayersTab /> : null}
      {tab === 'widgets' ? <WidgetLayoutTab /> : null}
      {tab === 'repair' ? <RepairTab local={local} set={set} persist={persist} saving={saving} /> : null}
      {tab === 'users' && canUsers ? <UsersTab /> : null}

      {tab === 'data' ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader title="سیاست نگهداری داده" subtitle="Data Retention Policy — قابل تنظیم و ثبت‌شده در Audit Log" icon={<Database size={18} />} />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-2">
                <Toggle checked={local.retention_enabled} onChange={(v) => set('retention_enabled', v)} label="اجرای خودکار Retention فعال باشد" hint="با غیرفعال‌کردن، هیچ حذف خودکاری انجام نمی‌شود (اجرای دستی مدیر همچنان ممکن است)" />
                <Toggle checked={local.retention_legal_hold} onChange={(v) => set('retention_legal_hold', v)} label="الزام قانونی نگهداری (Legal Hold)" hint="در صورت فعال‌بودن، هیچ داده‌ای حذف نمی‌شود تا مدیر سیاست را آگاهانه تغییر دهد" />
              </div>
              <Field label="زمان اجرای روزانه" hint="به وقت محلی تنظیمات (HH:MM)">
                <input dir="ltr" className="field num" value={local.retention_run_time} onChange={(e) => set('retention_run_time', e.target.value)} />
              </Field>
              <Field label="حداقل فاصلهٔ اجرا (دقیقه)">
                <input type="number" min={15} dir="ltr" className="field num" value={local.retention_interval_minutes} onChange={(e) => set('retention_interval_minutes', Number(e.target.value) || 1440)} />
              </Field>
              <Field label="اندازهٔ هر Batch (رکورد)">
                <input type="number" min={100} max={50000} dir="ltr" className="field num" value={local.retention_batch_size} onChange={(e) => set('retention_batch_size', Number(e.target.value) || 5000)} />
              </Field>
              <Field label="سقف رکورد در هر اجرا">
                <input type="number" min={1000} dir="ltr" className="field num" value={local.retention_max_rows_per_run} onChange={(e) => set('retention_max_rows_per_run', Number(e.target.value) || 100000)} />
              </Field>
              <Field label="نمونه‌های خام (روز)" hint="پیش از حذف، آمار روزانه تثبیت می‌شود">
                <input type="number" min={1} max={3650} dir="ltr" className="field num" value={local.samples_retention_days} onChange={(e) => set('samples_retention_days', Number(e.target.value) || 90)} />
              </Field>
              <Field label="آمار روزانه (روز)" hint="حداقل ۳۶۵ روز">
                <input type="number" min={365} dir="ltr" className="field num" value={local.daily_stats_retention_days} onChange={(e) => set('daily_stats_retention_days', Number(e.target.value) || 365)} />
              </Field>
              <Field label="قطعی‌ها (روز)" hint="حداقل ۳۶۵ روز؛ قطعی باز هرگز حذف نمی‌شود">
                <input type="number" min={365} dir="ltr" className="field num" value={local.outages_retention_days} onChange={(e) => set('outages_retention_days', Number(e.target.value) || 365)} />
              </Field>
              <Field label="هشدارها (روز)" hint="هشدار حل‌نشده هرگز حذف نمی‌شود">
                <input type="number" min={30} dir="ltr" className="field num" value={local.alerts_retention_days} onChange={(e) => set('alerts_retention_days', Number(e.target.value) || 180)} />
              </Field>
              <Field label="گزارش حسابرسی (روز)" hint="حداقل ۳۶۵ روز">
                <input type="number" min={365} dir="ltr" className="field num" value={local.audit_retention_days} onChange={(e) => set('audit_retention_days', Number(e.target.value) || 365)} />
              </Field>
              <Field label="لاگ موتور (روز)">
                <input type="number" min={7} dir="ltr" className="field num" value={local.engine_log_retention_days} onChange={(e) => set('engine_log_retention_days', Number(e.target.value) || 30)} />
              </Field>
              <div className="sm:col-span-2">
                <Toggle checked={local.retention_prune_backups} onChange={(v) => set('retention_prune_backups', v)} label="Retention فایل‌های پشتیبان را هم هرس کند" hint="پیش‌فرض خاموش است؛ هرس پشتیبان با سیاست مستقل ۷ روزانه + ۴ هفتگی انجام می‌شود" />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="وضعیت Retention Engine"
              subtitle={`آخرین اجرا: ${retentionData?.lastRun ? fmtDateTime(retentionData.lastRun.startedAt, local.timezone_offset_minutes) : '—'}`}
              icon={<Activity size={18} />}
              action={<button type="button" className="btn-ghost btn-xs" onClick={refreshRetention}><RefreshCw size={13} /></button>}
            />
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-soft bg-ink-50 px-3 py-2.5">
                <span className="text-[12px] text-ink-500">وضعیت</span>
                <Badge tone={retentionData?.running ? 'sun' : retentionData?.lastRun?.status === 'failed' ? 'red' : 'emerald'}>
                  {retentionData?.running ? 'در حال اجرا' : retentionData?.lastRun?.status ?? 'بدون اجرا'}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                <InfoCell label="اجرای بعدی" value={retentionData ? fmtDateTime(retentionData.nextRunAt, local.timezone_offset_minutes) : '—'} />
                <InfoCell label="قفل" value={retentionData?.lock?.owner ? (retentionData.lock.heldByThisProcess ? 'این نمونه' : 'نمونهٔ دیگر') : 'آزاد'} />
                <InfoCell label="رکورد حذف‌شده (آخرین)" value={fmtNumber(retentionData?.lastRun?.deletedRows ?? 0)} />
                <InfoCell label="فضای آزادشده" value={fmtNumber(Math.round((retentionData?.lastRun?.freedBytes ?? 0) / 1024)) + ' KB'} />
                <InfoCell label="حجم پایگاه‌داده" value={fmtNumber(Math.round((retentionData?.storage?.dbBytes ?? 0) / 1024 / 1024)) + ' MB'} />
                <InfoCell label="WAL" value={fmtNumber(Math.round((retentionData?.storage?.walBytes ?? 0) / 1024)) + ' KB'} />
              </div>
              {retentionData?.lastRun?.error ? (
                <p className="rounded-soft border border-red-100 bg-red-50/60 p-2 text-[11px] text-danger">{retentionData.lastRun.error}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-soft btn-xs"
                  onClick={async () => {
                    try {
                      const r = await api.runRetention(true);
                      push(`Dry-Run: ${faDigits(r.deletedRows)} رکورد قابل حذف است`, 'success');
                      refreshRetention();
                    } catch (e) {
                      push((e as Error).message, 'error');
                    }
                  }}
                >
                  Dry-Run
                </button>
                <button
                  type="button"
                  className="btn-primary btn-xs"
                  onClick={async () => {
                    if (!window.confirm('اجرای Retention اکنون انجام شود؟')) return;
                    try {
                      const r = await api.runRetention(false);
                      push(`Retention: ${faDigits(r.deletedRows)} رکورد حذف شد`, 'success');
                      refreshRetention();
                    } catch (e) {
                      push((e as Error).message, 'error');
                    }
                  }}
                >
                  <Play size={13} />
                  اجرای دستی
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-xs"
                  onClick={async () => {
                    try {
                      await api.stopRetention();
                      push('درخواست توقف ثبت شد', 'success');
                      refreshRetention();
                    } catch (e) {
                      push((e as Error).message, 'error');
                    }
                  }}
                >
                  <Pause size={13} />
                  توقف
                </button>
              </div>
              <div className="rounded-soft border border-ink-200 bg-surface/70 p-3 text-[11px] leading-relaxed text-ink-500">
                هر Batch در تراکنش مستقل اجرا می‌شود؛ پیش از حذف نمونه‌ها، آمار روزانه تثبیت می‌شود و داده‌های دارای قطعی باز یا هشدار حل‌نشده حفظ می‌شوند.
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="پشتیبان‌گیری" subtitle="نسخه‌های معتبر با Manifest و Checksum" icon={<Server size={18} />} />
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                <InfoCell label="تعداد نسخه‌ها" value={fmtNumber(backupData?.status?.count ?? 0)} />
                <InfoCell label="آخرین نسخه" value={backupData?.status?.lastBackupAt ? fmtRelative(backupData.status.lastBackupAt) : '—'} />
                <InfoCell label="نسخهٔ برنامه" value={backupData?.status?.appVersion ?? '—'} />
                <InfoCell label="نسخهٔ Schema" value={faDigits(backupData?.status?.schemaVersion ?? 0)} />
                <InfoCell label="وضعیت Restore" value={backupData?.status?.restore?.status ?? 'never'} />
                <InfoCell label="فضای آزاد دیسک" value={fmtNumber(Math.round((backupData?.status?.freeBytes ?? 0) / 1024 / 1024)) + ' MB'} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="نسخهٔ روزانه">
                  <input type="number" min={1} max={60} dir="ltr" className="field num" value={local.backup_daily_keep} onChange={(e) => set('backup_daily_keep', Number(e.target.value) || 7)} />
                </Field>
                <Field label="نسخهٔ هفتگی">
                  <input type="number" min={0} max={52} dir="ltr" className="field num" value={local.backup_weekly_keep} onChange={(e) => set('backup_weekly_keep', Number(e.target.value) || 0)} />
                </Field>
                <Field label="فاصلهٔ پشتیبان (ساعت)">
                  <input type="number" min={1} max={168} dir="ltr" className="field num" value={local.backup_interval_hours} onChange={(e) => set('backup_interval_hours', Number(e.target.value) || 24)} />
                </Field>
              </div>
              <div className="space-y-2">
                <Toggle checked={local.backup_enabled} onChange={(v) => set('backup_enabled', v)} label="پشتیبان‌گیری خودکار فعال باشد" />
                <Toggle checked={local.backup_prune_enabled} onChange={(v) => set('backup_prune_enabled', v)} label="هرس خودکار نسخه‌های قدیمی (۷ روزانه + ۴ هفتگی)" />
              </div>
              <button
                type="button"
                className="btn-soft btn-xs"
                onClick={async () => {
                  try {
                    const r = await api.createBackup();
                    push(`پشتیبان «${r.name}» ساخته شد`, 'success');
                    refreshBackup();
                  } catch (e) {
                    push((e as Error).message, 'error');
                  }
                }}
              >
                <Database size={13} />
                ساخت پشتیبان اکنون
              </button>
              <p className="text-[11px] leading-relaxed text-ink-400">
                مسیر داده‌ها: <span className="num" dir="ltr">data/netwatch.db</span> — هر مجموعهٔ پشتیبان شامل Manifest با زمان، نسخهٔ برنامه، نسخهٔ Schema، اندازه و SHA-256 است. پیش از بازیابی، Checksum و Integrity بررسی و از نسخهٔ فعلی یک نسخهٔ ایمنی ساخته می‌شود.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="بازنشانی داده‌های نمونه" subtitle="بازگرداندن سامانه به داده‌های نمایشی اولیه" icon={<TriangleAlert size={18} />} />
            <div className="mt-4 space-y-3">
              <div className="rounded-soft border border-red-100 bg-red-50/60 p-3 text-[11.5px] leading-relaxed text-danger">
                هشدار: با بازنشانی، تمام تجهیزات، سوابق قطعی، هشدارها و سوابق تعمیرات فعلی حذف و داده‌های نمونه جایگزین می‌شوند. این عملیات بازگشت‌پذیر نیست؛ پیش از آن پشتیبان بگیرید.
              </div>
              <button
                type="button"
                className="btn-danger btn-xs"
                onClick={async () => {
                  if (!window.confirm('همه داده‌های فعلی حذف و داده‌های نمونه بازنشانی شود؟')) return;
                  if (!window.confirm('تأیید نهایی: این عملیات غیرقابل بازگشت است.')) return;
                  try {
                    await api.resetDemo();
                    push('داده‌های نمونه بازنشانی شد — موتور در حال راه‌اندازی مجدد است', 'success');
                    await refreshSettings();
                    await refreshMeta();
                    refreshLayers();
                  } catch (e) {
                    push((e as Error).message, 'error');
                  }
                }}
              >
                <Trash2 size={13} />
                بازنشانی کامل داده‌ها
              </button>
              <div className="flex items-center gap-2 text-[11px] text-ink-400">
                <Gamepad2 size={13} />
                حالت فعلی بررسی: {MODE_LABEL[local.engine_mode] ?? local.engine_mode}
                {local.engine_mode === 'simulate' ? ' — داده‌ها شبیه‌سازی می‌شوند (مناسب دمو)' : ' — بررسی واقعی تجهیزات انجام می‌شود'}
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      <div className="flex items-center justify-between rounded-card border border-ink-200/70 bg-surface/80 px-4 py-3 text-[11.5px] text-ink-500">
        <span className="inline-flex items-center gap-1.5">
          <Server size={13} />
          {engine?.running ? 'موتور مانیتورینگ در حال اجرا است' : 'موتور مانیتورینگ متوقف است'}
        </span>
        <span className="text-ink-400">آخرین به‌روزرسانی: {fmtRelative(engineData?.lastRunAt ?? null)}</span>
      </div>
      </div>
    </div>
  );
}
