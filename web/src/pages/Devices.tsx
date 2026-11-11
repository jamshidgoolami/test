import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowUpDown, Columns3, Download, Filter, Grid2X2, List, Power, RefreshCw, Search, Server, Tag as TagIcon, Trash2, Upload, Wifi, X } from 'lucide-react';
import { api, downloadUrl } from '../lib/api';
import { useApp, useAsync, useLiveState, useToast } from '../lib/store';
import { useAuth } from '../lib/auth';
import { useUrlParams } from '../lib/params';
import { DataFreshness } from '../components/Freshness';
import { faDigits, fmtMs, fmtRelative, PRIORITY_META } from '../lib/format';
import { Card, EmptyState, ErrorState, PageLoader, Pagination } from '../components/ui';


import DeviceForm from '../features/DeviceForm';
import ImportDialog from '../features/ImportDialog';
import { GroupSidebar } from '../features/devices/components/GroupSidebar';
import { DeviceCard } from '../features/devices/components/DeviceCard';
import { DeviceTable } from '../features/devices/components/DeviceTable';
import { DEVICE_TABLE_COLUMNS, TABLE_COLUMN_KEYS } from '../features/devices/model/table';
import type { ViewMode } from '../features/devices/model/table';
import type { Device, Paged, Priority } from '../lib/types';

/** ستون‌های انتخابی نمای جدول؛ برخلاف فیلترها، فقط ترجیح نمایش همین مرورگر است. */
function readTableColumnsPreference(): string[] {
  try {
    const raw = localStorage.getItem('nw.tableColumns');
    if (!raw) return [...TABLE_COLUMN_KEYS];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...TABLE_COLUMN_KEYS];
    const unique = [
      ...new Set(parsed.filter((key): key is string => typeof key === 'string' && TABLE_COLUMN_KEYS.includes(key))),
    ];
    return unique.length ? unique : [...TABLE_COLUMN_KEYS];
  } catch {
    return [...TABLE_COLUMN_KEYS];
  }
}

function saveTableColumnsPreference(keys: string[]) {
  try {
    localStorage.setItem('nw.tableColumns', JSON.stringify(keys));
  } catch {
    /* ذخیره‌سازی مرورگر در دسترس نیست */
  }
}

// فیلتر وضعیت به‌صورت سه بخش کنار هم: وصل / قطع / همه
const STATUS_SEGMENTS = [
  { value: 'online', label: 'وصل' },
  { value: 'warning', label: 'دارای اختلال' },
  { value: 'offline', label: 'قطع' },
  { value: '', label: 'همه' },
] as const;

const STATUS_LABELS: Record<string, string> = {
  online: 'وصل',
  offline: 'قطع',
  warning: 'دارای اختلال',
  maintenance: 'در تعمیرات',
  unknown: 'نامشخص',
  high_latency: 'پینگ بالا',
};

const SORT_OPTIONS = [
  { value: 'name', label: 'نام' },
  { value: 'status', label: 'وضعیت' },
  { value: 'latency', label: 'آخرین تأخیر' },
  { value: 'avg_latency', label: 'میانگین تأخیر' },
  { value: 'loss', label: 'افت بسته' },
  { value: 'uptime', label: 'دسترس‌پذیری' },
  { value: 'last_check', label: 'آخرین بررسی' },
  { value: 'outages', label: 'تعداد قطعی' },
  { value: 'ip', label: 'آدرس IP' },
  { value: 'installed', label: 'تاریخ نصب' },
];

/**
 * ترجیح نمایش (کارت/جدول) در حافظهٔ مرورگر نگه داشته می‌شود؛ در حالت مرور خصوصی یا
 * وقتی ذخیره‌سازی مرورگر غیرفعال است، دسترسی به localStorage استثنا می‌دهد و پیش‌تر
 * همین یک خط باعث از کار افتادن کل صفحه می‌شد.
 */
function readViewPreference(): ViewMode {
  try {
    return (localStorage.getItem('nw.view') as ViewMode) || 'cards';
  } catch {
    return 'cards';
  }
}

function saveViewPreference(view: ViewMode) {
  try {
    localStorage.setItem('nw.view', view);
  } catch {
    /* ذخیره‌سازی مرورگر در دسترس نیست */
  }
}

/** تعداد کارت‌های هر ردیف (۱ تا ۸) */
function readColsPreference(): number {
  try {
    const n = Number(localStorage.getItem('nw.cols'));
    return n >= 1 && n <= 8 ? n : 4;
  } catch {
    return 4;
  }
}

function saveColsPreference(cols: number) {
  try {
    localStorage.setItem('nw.cols', String(cols));
  } catch {
    /* ذخیره‌سازی مرورگر در دسترس نیست */
  }
}

/** تگ‌هایی که روی کارت تجهیز نمایش داده می‌شوند (جدا از فیلتر تگ) */
function readCardTagPreference(): string[] {
  try {
    const raw = localStorage.getItem('nw.cardTags');
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveCardTagPreference(tags: string[]) {
  try {
    localStorage.setItem('nw.cardTags', JSON.stringify(tags));
  } catch {
    /* ذخیره‌سازی مرورگر در دسترس نیست */
  }
}

/** نشان‌های ثابت کارت (اولویت و موقعیت) مستقل از تگ‌های سفارشی‌اند. */
interface CardBadgePreference {
  priority: boolean;
  geo: boolean;
}

function readCardBadgePreference(): CardBadgePreference {
  try {
    const raw = localStorage.getItem('nw.cardBadges');
    const parsed = raw ? (JSON.parse(raw) as Partial<CardBadgePreference>) : null;
    return {
      priority: parsed?.priority !== false,
      geo: parsed?.geo !== false,
    };
  } catch {
    return { priority: true, geo: true };
  }
}

function saveCardBadgePreference(preference: CardBadgePreference) {
  try {
    localStorage.setItem('nw.cardBadges', JSON.stringify(preference));
  } catch {
    /* ذخیره‌سازی مرورگر در دسترس نیست */
  }
}

export default function Devices() {
  const { params, setParam, resetParams } = useUrlParams();
  const { meta, refreshMeta, settings } = useApp();
  const { push } = useToast();
  const live = useLiveState();
  const { can } = useAuth();
  // عملیات غیرمجاز از همان ابتدا پنهان می‌شود؛ سرور نیز مستقل از UI آن را رد می‌کند.
  const canWrite = can('devices:write');
  const canProbe = can('probe:run');

  const [view, setView] = useState<ViewMode>(readViewPreference);
  const [cols, setCols] = useState<number>(readColsPreference);
  const [tableColumns, setTableColumns] = useState<string[]>(readTableColumnsPreference);
  const [columnsOpen, setColumnsOpen] = useState(false);
  // در موبایل/تبلت منوی گروه‌ها بسته شروع می‌شود تا فهرست تجهیزات زیر چند
  // صفحه گروه پنهان نشود؛ در دسکتاپ باز است.
  const [groupsOpen, setGroupsOpen] = useState<boolean>(() => {
    try {
      return window.matchMedia('(min-width: 1280px)').matches;
    } catch {
      return true;
    }
  });
  const [exportOpen, setExportOpen] = useState(false);
  const [tagDisplayOpen, setTagDisplayOpen] = useState(false);
  const [cardTags, setCardTags] = useState<string[]>(readCardTagPreference);
  const [cardBadges, setCardBadges] = useState<CardBadgePreference>(readCardBadgePreference);
  const [selected, setSelected] = useState<number[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sparks, setSparks] = useState<Record<number, { t: number; rtt: number | null; loss: number }[]>>({});

  const query = useMemo(
    () => ({
      search: params.get('search') ?? '',
      group: params.get('group') ?? '',
      tag: params.get('tag') ?? '',
      status: params.get('status') ?? '',
      type: params.get('type') ?? '',
      priority: params.get('priority') ?? '',
      enabled: params.get('enabled') ?? '',
      sort: params.get('sort') ?? 'name',
      order: params.get('order') ?? 'asc',
      page: Number(params.get('page') ?? 1),
      // تعداد نمایش همیشه مضربی از ۱۰۰ است.
      pageSize: Number(params.get('pageSize') ?? 100),
      geo: params.get('geo') ?? '',
    }),
    [params, view]
  );

  const { data, loading, error, refresh, updatedAt, refreshing } = useAsync<Paged<Device>>(
    (signal) => api.devices(query as unknown as Record<string, string | number>, signal),
    [JSON.stringify(query)],
    { interval: 30000 }
  );

  const devices = data?.items ?? [];

  // Command Palette و لینک‌های عملیاتی می‌توانند فرم افزودن را مستقیم باز کنند.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    if (canWrite) {
      setEditing(null);
      setFormOpen(true);
    }
    setParam('new', '');
  }, [params, setParam, canWrite]);

  // اتصال مجدد SSE → Snapshot تازه فهرست، تا وضعیت‌های ازدست‌رفته با داده قبلی
  // اشتباه گرفته نشوند.
  const syncToken = live.syncToken;
  const seenSync = useRef(syncToken);
  useEffect(() => {
    if (syncToken === seenSync.current) return;
    seenSync.current = syncToken;
    refresh();
  }, [syncToken, refresh]);

  // آمار گروه‌ها برای منوی کناری (تعداد کل، وصل و قطع هر گروه)
  const { data: groupsData } = useAsync((signal) => api.groups(signal), [], { interval: 30000 });
  const groups = groupsData?.items ?? meta?.groups ?? [];

  useEffect(() => {
    saveViewPreference(view);
  }, [view]);

  useEffect(() => {
    saveColsPreference(cols);
  }, [cols]);

  useEffect(() => {
    saveTableColumnsPreference(tableColumns);
  }, [tableColumns]);

  useEffect(() => {
    if (view !== 'table') setColumnsOpen(false);
  }, [view]);

  useEffect(() => {
    saveCardTagPreference(cardTags);
  }, [cardTags]);

  useEffect(() => {
    saveCardBadgePreference(cardBadges);
  }, [cardBadges]);

  useEffect(() => {
    setSelected([]);
  }, [JSON.stringify(query)]);

  // نمودار کوچک کارت‌ها: یک بار در هر دقیقه بازخوانی می‌شود
  const [sparkTick, setSparkTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSparkTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const deviceIds = devices.map((d) => d.id).join(',');
  // شناسه‌های بارگیری‌شده نگه داشته می‌شوند تا با رفتن به صفحهٔ بعد، نمودار
  // تجهیزات تازه هم گرفته شود (پیش‌تر فقط وجود نمودار اولین کارت بررسی می‌شد و
  // کارت‌های صفحه‌های بعد خالی می‌ماندند).
  const loadedSparks = useRef(0);
  useEffect(() => {
    if (!deviceIds || view !== 'cards') return;
    const ids = deviceIds.split(',').map(Number);
    if (loadedSparks.current === sparkTick && ids.every((id) => sparks[id])) return;
    let alive = true;
    api
      .sparklines(ids, '1h')
      .then((res) => {
        if (!alive) return;
        loadedSparks.current = sparkTick;
        setSparks((prev) => ({ ...prev, ...res.series }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceIds, view, sparkTick]);

  const highLatency = meta?.highLatency ?? 0;

  const activeFilters = [
    query.status ? { key: 'status', label: STATUS_LABELS[query.status] ?? query.status } : null,
    query.group ? { key: 'group', label: `گروه: ${query.group}` } : null,
    query.tag ? { key: 'tag', label: `تگ: ${query.tag}` } : null,
    query.type ? { key: 'type', label: `نوع: ${query.type}` } : null,
    query.priority ? { key: 'priority', label: `اولویت: ${PRIORITY_META[query.priority as Priority]?.label ?? query.priority}` } : null,
    query.enabled !== '' ? { key: 'enabled', label: query.enabled === '0' ? 'غیرفعال' : 'فعال' } : null,
    query.geo ? { key: 'geo', label: query.geo === 'with' ? 'دارای موقعیت' : 'بدون موقعیت' } : null,
  ].filter(Boolean) as { key: string; label: string }[];

  const toggleSelect = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allSelected = devices.length > 0 && selected.length === devices.length;

  const runBulk = async (action: string, payload: Record<string, unknown> = {}, message?: string) => {
    if (!selected.length || busy) return;
    setBusy(true);
    try {
      const res = await api.bulk(selected, action, payload);
      push(message ?? `${faDigits(res.affected ?? selected.length)} تجهیز به‌روزرسانی شد`, 'success');
      setSelected([]);
      refresh();
      refreshMeta();
    } catch (e) {
      push((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const quickPing = async (device: Device) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.pingDevice(device.id);
      const r = res.result;
      push(
        r.ok ? `${device.name} — پاسخ در ${fmtMs(r.rtt)} (${r.mode})` : `${device.name} — پاسخ نداد (${r.error ?? 'بدون پاسخ'})`,
        r.ok ? 'success' : 'error'
      );
      refresh();
    } catch (e) {
      push((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeDevice = async (device: Device) => {
    if (busy) return;
    if (!window.confirm(`تجهیز «${device.name}» حذف شود؟ تمام تاریخچه و سوابق آن نیز حذف خواهد شد.`)) return;
    setBusy(true);
    try {
      await api.deleteDevice(device.id);
      push('تجهیز حذف شد', 'success');
      refresh();
      refreshMeta();
    } catch (e) {
      push((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* نوار ابزار — یک ردیف فیلتر همیشه‌نمایان، سپس نحوهٔ نمایش و وضعیت */}
      <Card padded={false} className="relative z-40 p-2.5">
        <div className="flex flex-col gap-2">
          {/* ردیف ۱: جست‌وجو و همهٔ فیلترها، همیشه در یک ردیف */}
          <div className="-mb-1 flex items-center gap-2 overflow-x-auto pb-1">
            <div className="relative w-[210px] shrink-0">
              <Search size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                className="field !rounded-pill pr-9"
                placeholder="جست‌وجو در تجهیزات…"
                aria-label="جست‌وجو در تجهیزات"
                value={query.search}
                onChange={(e) => setParam('search', e.target.value)}
              />
            </div>

            <select
              className="field !w-auto shrink-0 !rounded-pill !py-1.5 !text-[12px]"
              value={query.tag}
              onChange={(e) => setParam('tag', e.target.value)}
              aria-label="فیلتر تگ"
            >
              <option value="">همه تگ‌ها</option>
              {(meta?.tags ?? []).map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>

            <select
              className="field !w-auto shrink-0 !rounded-pill !py-1.5 !text-[12px]"
              value={query.type}
              onChange={(e) => setParam('type', e.target.value)}
              aria-label="فیلتر نوع تجهیز"
            >
              <option value="">همه انواع</option>
              {(meta?.types ?? []).map((t) => (
                <option key={t.value} value={t.value}>
                  {t.value} ({faDigits(t.count)})
                </option>
              ))}
            </select>

            <select
              className="field !w-auto shrink-0 !rounded-pill !py-1.5 !text-[12px]"
              value={query.priority}
              onChange={(e) => setParam('priority', e.target.value)}
              aria-label="فیلتر اولویت"
            >
              <option value="">همه اولویت‌ها</option>
              {Object.entries(PRIORITY_META).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>

            <select
              className="field !w-auto shrink-0 !rounded-pill !py-1.5 !text-[12px]"
              value={query.sort}
              onChange={(e) => setParam('sort', e.target.value)}
              aria-label="ترتیب فهرست"
            >
              {SORT_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  مرتب‌سازی: {s.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="btn-ghost btn-xs shrink-0"
              onClick={() => setParam('order', query.order === 'asc' ? 'desc' : 'asc')}
            >
              <ArrowUpDown size={14} />
              {query.order === 'asc' ? 'صعودی' : 'نزولی'}
            </button>

            {activeFilters.map((f) => (
              <button key={f.key} type="button" className="chip shrink-0 border-brand-200 bg-brand-50 text-accent" onClick={() => setParam(f.key, '')}>
                {f.label}
                <X size={11} />
              </button>
            ))}
            {activeFilters.length ? (
              <button type="button" className="shrink-0 text-[11px] text-ink-400 underline hover:text-danger" onClick={() => resetParams()}>
                پاک کردن همه
              </button>
            ) : null}

            <span className="ms-auto shrink-0 text-[11px] text-ink-400">
              <Filter size={12} className="inline" /> {faDigits(data?.total ?? 0)} تجهیز یافت شد
              {updatedAt ? ` · آخرین به‌روزرسانی ${fmtRelative(updatedAt)}` : ''}
              {refreshing ? ' · در حال به‌روزرسانی…' : ''}
            </span>
          </div>

          {/* ردیف ۲: نحوهٔ نمایش و حالت وصل/قطع/همه */}
          <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-2">
            <div className="inline-flex items-center rounded-pill border border-ink-200 bg-surface/70 p-0.5">
              {STATUS_SEGMENTS.map((s) => (
                <button
                  key={s.value || 'all'}
                  type="button"
                  onClick={() => setParam('status', s.value)}
                  className={`rounded-pill px-3 py-1.5 text-[12px] font-medium transition ${
                    query.status === s.value
                      ? s.value === 'online'
                        ? 'bg-emerald-500 text-white'
                        : s.value === 'offline'
                          ? 'bg-red-500 text-white'
                          : s.value === 'warning'
                            ? 'bg-sun-500 text-white'
                            : 'bg-brand-500 text-white'
                      : 'text-ink-500 hover:text-ink-700'
                  }`}
                >
                  {s.label}
                </button>
              ))}
              {highLatency > 0 ? (
                <button
                  type="button"
                  onClick={() => setParam('status', 'high_latency')}
                  className={`inline-flex items-center gap-1 rounded-pill px-3 py-1.5 text-[12px] font-medium transition ${
                    query.status === 'high_latency' ? 'bg-sun-500 text-white' : 'text-warning hover:text-warning'
                  }`}
                >
                  <Activity size={12} />
                  پینگ بالا
                  <span className="num">{faDigits(highLatency)}</span>
                </button>
              ) : null}
            </div>

            <div className="ms-auto flex flex-wrap items-center gap-2">
              {/* نمایش تگ‌های دلخواه روی کارت‌ها — مستقل از فیلتر تگ */}
              <div className="relative">
                <button
                  type="button"
                  className="btn-ghost btn-xs"
                  onClick={() => setTagDisplayOpen((v) => !v)}
                  aria-expanded={tagDisplayOpen}
                  aria-haspopup="dialog"
                  title="انتخاب تگ‌هایی که روی کارت تجهیزات نمایش داده می‌شوند"
                >
                  <TagIcon size={14} />
                  تگ روی کارت
                  {cardTags.length || cardBadges.priority || cardBadges.geo ? (
                    <span className="num chip border-brand-200 bg-brand-50 px-1.5 py-0 text-[10px] text-accent">
                      {faDigits(cardTags.length + (cardBadges.priority ? 1 : 0) + (cardBadges.geo ? 1 : 0))}
                    </span>
                  ) : null}
                </button>
                {tagDisplayOpen ? <button type="button" className="fixed inset-0 z-20 cursor-default" aria-label="بستن انتخاب تگ" onClick={() => setTagDisplayOpen(false)} /> : null}
                {tagDisplayOpen ? (
                  <div className="absolute left-0 z-30 mt-1 w-64 rounded-soft border border-ink-200 bg-surface p-2 shadow-pop" role="dialog" aria-label="تگ‌های نمایشی روی کارت">
                    <p className="px-1 pb-1 text-[10.5px] text-ink-400">تگ‌هایی که روی کارت تجهیزات دیده شوند؛ این انتخاب با فیلتر تگ تفاوت دارد.</p>
                    <div className="max-h-56 space-y-0.5 overflow-auto">
                      {(meta?.tags ?? []).length === 0 ? (
                        <p className="px-1 py-3 text-center text-[11px] text-ink-400">تگی تعریف نشده است</p>
                      ) : (
                        (meta?.tags ?? []).map((t) => (
                          <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-ink-600 hover:bg-brand-50/60">
                            <input
                              type="checkbox"
                              className="accent-brand-600"
                              checked={cardTags.includes(t.name)}
                              onChange={(e) =>
                                setCardTags((prev) => (e.target.checked ? [...new Set([...prev, t.name])] : prev.filter((x) => x !== t.name)))
                              }
                            />
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} />
                            <span className="min-w-0 flex-1 truncate">{t.name}</span>
                            <span className="num text-[10px] text-ink-400">{faDigits(t.device_count ?? 0)}</span>
                          </label>
                        ))
                      )}
                    </div>
                    <div className="mt-1 border-t border-ink-100 pt-1">
                      <p className="px-1 pb-1 text-[10px] font-medium text-ink-400">نشان‌های ثابت کارت</p>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-ink-600 hover:bg-brand-50/60">
                        <input
                          type="checkbox"
                          className="accent-brand-600"
                          checked={cardBadges.priority}
                          onChange={(e) => setCardBadges((prev) => ({ ...prev, priority: e.target.checked }))}
                        />
                        <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-hidden />
                        <span className="min-w-0 flex-1">نوع اولویت</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-ink-600 hover:bg-brand-50/60">
                        <input
                          type="checkbox"
                          className="accent-brand-600"
                          checked={cardBadges.geo}
                          onChange={(e) => setCardBadges((prev) => ({ ...prev, geo: e.target.checked }))}
                        />
                        <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-hidden />
                        <span className="min-w-0 flex-1">دارای موقعیت</span>
                      </label>
                    </div>
                    <div className="mt-1 flex items-center justify-between border-t border-ink-100 pt-1">
                      <button type="button" className="btn-ghost btn-xs" onClick={() => setCardTags([])}>
                        پیش‌فرض (دو تگ اول)
                      </button>
                      <button type="button" className="btn-soft btn-xs" onClick={() => setTagDisplayOpen(false)}>
                        بستن
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {view === 'cards' ? (
                <div className="inline-flex items-center gap-0.5 rounded-soft border border-ink-200 bg-surface/70 px-1.5 py-1" title="تعداد کارت‌های هر ردیف">
                  <Grid2X2 size={13} className="ms-0.5 me-1 text-ink-400" />
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setCols(n)}
                      className={`num h-6 w-6 rounded-md text-[11px] font-medium transition ${
                        cols === n ? 'bg-brand-500 text-white' : 'text-ink-500 hover:bg-ink-100'
                      }`}
                    >
                      {faDigits(n)}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="inline-flex rounded-soft bg-ink-100/70 p-1">
                <button
                  type="button"
                  onClick={() => setView('cards')}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium transition ${
                    view === 'cards' ? 'bg-surface text-accent shadow-soft' : 'text-ink-500'
                  }`}
                >
                  <Grid2X2 size={14} />
                  کارت
                </button>
                <button
                  type="button"
                  onClick={() => setView('table')}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium transition ${
                    view === 'table' ? 'bg-surface text-accent shadow-soft' : 'text-ink-500'
                  }`}
                >
                  <List size={14} />
                  جدول
                </button>
              </div>

              {view === 'table' ? (
                <div className="relative">
                  <button
                    type="button"
                    className="btn-ghost btn-xs"
                    onClick={() => setColumnsOpen((value) => !value)}
                    aria-expanded={columnsOpen}
                    aria-haspopup="dialog"
                    title="انتخاب ستون‌های نمایش‌داده‌شده در جدول"
                  >
                    <Columns3 size={14} />
                    ستون‌ها
                    <span className="num chip border-ink-200 bg-ink-50 px-1.5 py-0 text-[10px] text-ink-600">
                      {faDigits(tableColumns.length)}/{faDigits(DEVICE_TABLE_COLUMNS.length)}
                    </span>
                  </button>
                  {columnsOpen ? (
                    <button
                      type="button"
                      className="fixed inset-0 z-20 cursor-default"
                      aria-label="بستن انتخاب ستون‌ها"
                      onClick={() => setColumnsOpen(false)}
                    />
                  ) : null}
                  {columnsOpen ? (
                    <div
                      className="absolute left-0 z-30 mt-1 w-60 rounded-soft border border-ink-200 bg-surface p-2 shadow-pop"
                      role="dialog"
                      aria-label="ستون‌های نمای جدول"
                    >
                      <p className="px-1 pb-1 text-[10.5px] text-ink-400">ستون‌هایی که در نمای جدول دیده شوند.</p>
                      <div className="max-h-64 space-y-0.5 overflow-auto">
                        {DEVICE_TABLE_COLUMNS.map((column) => {
                          const checked = tableColumns.includes(column.key);
                          const lastVisible = checked && tableColumns.length === 1;
                          return (
                            <label
                              key={column.key}
                              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] ${
                                lastVisible
                                  ? 'cursor-not-allowed text-ink-400'
                                  : 'cursor-pointer text-ink-600 hover:bg-brand-50/60'
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="accent-brand-600"
                                checked={checked}
                                disabled={lastVisible}
                                onChange={(event) => {
                                  setTableColumns((previous) => {
                                    if (event.target.checked) return [...new Set([...previous, column.key])];
                                    return previous.length > 1 ? previous.filter((key) => key !== column.key) : previous;
                                  });
                                }}
                              />
                              <span className="min-w-0 flex-1 truncate">{column.label}</span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="mt-1 flex items-center justify-between border-t border-ink-100 pt-1">
                        <button
                          type="button"
                          className="btn-ghost btn-xs"
                          onClick={() => setTableColumns([...TABLE_COLUMN_KEYS])}
                        >
                          همهٔ ستون‌ها
                        </button>
                        <button type="button" className="btn-soft btn-xs" onClick={() => setColumnsOpen(false)}>
                          بستن
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {canWrite ? (
                <button type="button" className="btn-ghost btn-xs" onClick={() => setImportOpen(true)}>
                  <Upload size={14} />
                  ورود گروهی
                </button>
              ) : null}

              <div className="relative">
                <button
                  type="button"
                  className="btn-ghost btn-xs"
                  onClick={() => setExportOpen((v) => !v)}
                  aria-expanded={exportOpen}
                  aria-haspopup="menu"
                >
                  <Download size={14} />
                  خروجی
                </button>
                {exportOpen ? <button type="button" className="fixed inset-0 z-20 cursor-default" aria-label="بستن منوی خروجی" onClick={() => setExportOpen(false)} /> : null}
                <div className={exportOpen ? 'absolute left-0 z-30 mt-1 w-52 rounded-soft border border-ink-200 bg-surface p-1.5 shadow-pop' : 'hidden'}>
                  <a className="block rounded-lg px-3 py-2 text-[12px] text-ink-600 hover:bg-brand-50" href={downloadUrl('/devices/export', { format: 'xlsx' })} onClick={() => setExportOpen(false)}>
                    خروجی Excel از تجهیزات
                  </a>
                  <a className="block rounded-lg px-3 py-2 text-[12px] text-ink-600 hover:bg-brand-50" href={downloadUrl('/devices/export', { format: 'csv' })} onClick={() => setExportOpen(false)}>
                    خروجی CSV از تجهیزات
                  </a>
                  <a className="block rounded-lg px-3 py-2 text-[12px] text-ink-600 hover:bg-brand-50" href={downloadUrl('/devices/export/geo', { format: 'xlsx' })} onClick={() => setExportOpen(false)}>
                    خروجی مختصات جغرافیایی
                  </a>
                </div>
              </div>

              {canWrite ? (
                <button
                  type="button"
                  className="btn-primary btn-xs"
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  <Server size={14} />
                  افزودن تجهیز
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      <DataFreshness updatedAt={updatedAt} intervalMs={30000} onRefresh={refresh} />

      {/* نوار عملیات گروهی */}
      {canWrite && selected.length > 0 ? (
        <div className="sticky top-[68px] z-[700] animate-fade-up rounded-card border border-brand-100 bg-surface/95 p-3 shadow-pop backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip border-brand-200 bg-brand-50 text-accent">
              {faDigits(selected.length)} تجهیز انتخاب شده
            </span>
            <button type="button" className="btn-ghost btn-xs" disabled={busy} onClick={() => runBulk('ping', {}, 'Ping برای تجهیزات انتخاب‌شده در صف قرار گرفت')}>
              <Wifi size={13} />
              Ping
            </button>
            <button type="button" className="btn-ghost btn-xs" disabled={busy} onClick={() => runBulk('monitoring_on', {}, 'پایش تجهیزات فعال شد')}>
              <Power size={13} />
              فعال‌سازی پایش
            </button>
            <button type="button" className="btn-ghost btn-xs" disabled={busy} onClick={() => runBulk('monitoring_off', {}, 'پایش تجهیزات غیرفعال شد')}>
              <Power size={13} />
              غیرفعال‌سازی پایش
            </button>
            <button type="button" className="btn-ghost btn-xs" disabled={busy} onClick={() => runBulk('enable', {}, 'تجهیزات فعال شدند')}>
              فعال‌سازی تجهیز
            </button>
            <button type="button" className="btn-ghost btn-xs" disabled={busy} onClick={() => runBulk('disable', {}, 'تجهیزات غیرفعال شدند')}>
              غیرفعال‌سازی تجهیز
            </button>
            <select
              className="field !w-auto !py-1.5 text-xs"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) runBulk('group', { group: e.target.value }, 'گروه تجهیزات تغییر کرد');
                e.currentTarget.value = '';
              }}
            >
              <option value="">انتقال به گروه…</option>
              {(meta?.groups ?? []).map((g) => (
                <option key={g.id} value={g.name}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              className="field !w-auto !py-1.5 text-xs"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) runBulk('interval', { interval: e.target.value }, 'بازه بررسی به‌روزرسانی شد');
                e.currentTarget.value = '';
              }}
            >
              <option value="">بازه بررسی…</option>
              {[15, 30, 60, 120, 300, 600].map((i) => (
                <option key={i} value={i}>
                  {faDigits(i)} ثانیه
                </option>
              ))}
              <option value="">مقدار عمومی</option>
            </select>
            <button
              type="button"
              className="btn-danger btn-xs"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`حذف ${selected.length} تجهیز انتخاب‌شده؟ این عملیات بازگشت‌پذیر نیست.`)) runBulk('delete', {}, 'تجهیزات حذف شدند');
              }}
            >
              <Trash2 size={13} />
              حذف
            </button>
            <button type="button" className="btn-ghost btn-xs ms-auto" onClick={() => setSelected([])}>
              لغو انتخاب
            </button>
          </div>
        </div>
      ) : null}

      {/* چیدمان: محتوا (راست) · منوی گروه‌ها (چپ) — دکمهٔ باز/بسته در سرصفحهٔ خود فهرست */}
      <div className="flex flex-col gap-4 xl:flex-row-reverse xl:items-start">
        <div className={`shrink-0 ${groupsOpen ? 'xl:w-[250px]' : 'xl:w-auto'}`}>
          <GroupSidebar
            open={groupsOpen}
            onToggle={() => setGroupsOpen((v) => !v)}
            groups={groups.map((g) => ({
              id: g.id,
              name: g.name,
              color: g.color,
              total: g.device_count ?? 0,
              online: g.online ?? 0,
              offline: g.offline ?? 0,
            }))}
            selected={query.group}
            onSelect={(name) => setParam('group', name)}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-4">
      {/* محتوا */}
      {loading && !data ? (
        <PageLoader label="در حال دریافت تجهیزات…" />
      ) : error && !data ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : devices.length === 0 ? (
        <EmptyState
          title="تجهیزی با این فیلترها یافت نشد"
          description="فیلترها را تغییر دهید یا تجهیز جدیدی اضافه کنید. برای ورود گروهی می‌توانید از فایل Excel استفاده کنید."
          icon={<Server size={22} />}
          action={
            canWrite ? (
              <div className="flex gap-2">
                <button type="button" className="btn-primary btn-xs" onClick={() => { setEditing(null); setFormOpen(true); }}>
                  افزودن تجهیز
                </button>
                <button type="button" className="btn-ghost btn-xs" onClick={() => setImportOpen(true)}>
                  ورود گروهی از فایل
                </button>
              </div>
            ) : undefined
          }
        />
      ) : view === 'cards' ? (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:[grid-template-columns:repeat(var(--nw-cols),minmax(0,1fr))]"
          style={{ '--nw-cols': cols } as React.CSSProperties}
        >
          {devices.map((d, i) => (
            <DeviceCard
              key={d.id}
              device={d}
              spark={sparks[d.id] ?? []}
              visibleTags={cardTags}
              showPriority={cardBadges.priority}
              showGeo={cardBadges.geo}
              threshold={d.latencyThreshold ?? settings?.latency_threshold ?? 150}
              selected={selected.includes(d.id)}
              selectable={canWrite}
              canProbe={canProbe}
              canWrite={canWrite}
              onSelect={() => toggleSelect(d.id)}
              onPing={() => quickPing(d)}
              onEdit={() => {
                setEditing(d);
                setFormOpen(true);
              }}
              onDelete={() => removeDevice(d)}
              delay={i * 25}
            />
          ))}
        </div>
      ) : (
        <DeviceTable
          devices={devices}
          selected={selected}
          allSelected={allSelected}
          selectable={canWrite}
          canProbe={canProbe}
          canWrite={canWrite}
          onToggleAll={() => setSelected(allSelected ? [] : devices.map((d) => d.id))}
          onToggle={toggleSelect}
          onPing={quickPing}
          onEdit={(d) => {
            setEditing(d);
            setFormOpen(true);
          }}
          onDelete={removeDevice}
          visibleColumns={tableColumns}
          sort={query.sort}
          order={query.order}
          onSort={(key) => setParam('sort', key)}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          className="field !w-auto !rounded-pill"
          value={String(query.pageSize)}
          onChange={(e) => setParam('pageSize', e.target.value)}
        >
          {[100, 200, 300, 400, 500].map((n) => (
            <option key={n} value={n}>
              نمایش {faDigits(n)} مورد
            </option>
          ))}
        </select>
        <button type="button" className="btn-ghost btn-xs" onClick={refresh}>
          <RefreshCw size={13} />
          به‌روزرسانی فهرست
        </button>
      </div>

      <Pagination
        page={data?.page ?? 1}
        pages={data?.pages ?? 1}
        total={data?.total ?? 0}
        pageSize={data?.pageSize ?? query.pageSize}
        onPage={(p) => setParam('page', String(p))}
      />

        </div>
      </div>

      <DeviceForm
        open={formOpen}
        device={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          refresh();
          refreshMeta();
        }}
      />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={() => { refresh(); refreshMeta(); }} />
    </div>
  );
}

/* ------------------------------ منوی کناری گروه‌ها ------------------------------ */

/* ------------------------------- Device card ------------------------------- */
/* ------------------------------- Device table ------------------------------- */