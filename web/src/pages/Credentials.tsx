import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Download,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useSubmitGuard, useToast } from '../lib/store';
import { useAuth } from '../lib/auth';
import { useUrlParams } from '../lib/params';
import { CREDENTIAL_KINDS, strengthMeta } from '../lib/credential-rules';
import { faDigits, fmtNumber } from '../lib/format';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Modal,
  PageLoader,
  Pagination,
  StatCard,
} from '../components/ui';
import CredentialForm from '../features/credentials/CredentialForm';
import CredentialReveal from '../features/credentials/CredentialReveal';
import CredentialsTable from '../features/credentials/CredentialsTable';
import type { Credential, CredentialKind } from '../lib/types';

const SORTS = [
  { value: 'updated', label: 'آخرین تغییر' },
  { value: 'label', label: 'عنوان' },
  { value: 'strength', label: 'ضعیف‌ترین' },
  { value: 'due', label: 'نزدیک‌ترین چرخش' },
];

/**
 * صفحهٔ مخزن اعتبارنامهٔ تجهیزات.
 *
 * ساختار: خلاصهٔ وضعیت (کل/ضعیف/موعد چرخش) → جست‌وجو و فیلتر → جدول.
 * رمزها فقط با دکمهٔ «نمایش» و در پنجرهٔ اختصاصی خوانده می‌شوند؛ نه در بارگذاری
 * صفحه و نه در خروجی/کش.
 */
export default function Credentials() {
  const { push } = useToast();
  const { user, can } = useAuth();
  const canWrite = can('credentials:write');
  const canReveal = can('credentials:reveal');
  const isAdmin = user?.role === 'admin';
  const { params, setParam, resetParams } = useUrlParams();

  const search = params.get('search') ?? '';
  const kind = (params.get('kind') ?? '') as CredentialKind | '';
  const weak = params.get('weak') === '1';
  const due = params.get('due') === '1';
  const sort = params.get('sort') ?? 'updated';
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);

  const [searchInput, setSearchInput] = useState(search);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Credential | null>(null);
  const [revealTarget, setRevealTarget] = useState<Credential | null>(null);
  const [deleting, setDeleting] = useState<Credential | null>(null);
  const [toolsBusy, setToolsBusy] = useState(false);
  const { busy: deleteBusy, run: runDelete } = useSubmitGuard();

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return;
    const id = window.setTimeout(() => setParam('search', trimmed), 320);
    return () => window.clearTimeout(id);
  }, [searchInput, search, setParam]);

  const { data, loading, refreshing, error, refresh } = useAsync(
    (signal) =>
      api.credentials(
        {
          search,
          kind: kind || undefined,
          weak: weak ? '1' : undefined,
          due: due ? '1' : undefined,
          sort,
          page,
          pageSize: 20,
        },
        signal
      ),
    [search, kind, weak, due, sort, page]
  );

  const { data: summary, refresh: refreshSummary } = useAsync((signal) => api.credentialSummary(signal), []);
  const { data: devicePage } = useAsync((signal) => api.devices({ pageSize: 500 }, signal), []);
  const devices = devicePage?.items ?? [];

  const items = data?.items ?? [];
  const filtersActive = Boolean(search || kind || weak || due);
  const weakCount = summary?.weak ?? 0;

  const kindsWithCounts = useMemo(() => {
    const counts = new Map((summary?.kinds ?? []).map((item) => [item.kind, item.count]));
    return CREDENTIAL_KINDS.map((item) => ({ ...item, count: counts.get(item.id) ?? 0 }));
  }, [summary]);

  const reloadAll = () => {
    refresh();
    refreshSummary();
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (credential: Credential) => {
    setEditing(credential);
    setFormOpen(true);
  };

  const rotate = async (credential: Credential) => {
    try {
      await api.markCredentialRotated(credential.id);
      push('چرخش رمز برای این اعتبارنامه ثبت شد.', 'success');
      reloadAll();
    } catch (e) {
      push(e instanceof Error ? e.message : 'ثبت چرخش ممکن نشد.', 'error');
    }
  };

  const remove = async (credential: Credential) => {
    const done = await runDelete(async () => {
      try {
        await api.deleteCredential(credential.id);
        push('اعتبارنامه حذف شد.', 'success');
        setDeleting(null);
        reloadAll();
        return true;
      } catch (e) {
        push(e instanceof Error ? e.message : 'حذف اعتبارنامه ممکن نشد.', 'error');
        return false;
      }
    });
    if (!done) setDeleting(null);
  };

  const runTool = async (tool: 'import' | 'recheck') => {
    if (toolsBusy) return;
    setToolsBusy(true);
    try {
      if (tool === 'import') {
        const result = await api.importDeviceCredentials();
        push(
          result.created
            ? `${faDigits(result.created)} اعتبارنامه از تجهیزات منتقل شد${result.skipped ? ` و ${faDigits(result.skipped)} مورد از قبل موجود بود` : ''}.`
            : 'اعتبارنامهٔ جدیدی برای انتقال پیدا نشد.',
          result.created ? 'success' : 'info'
        );
      } else {
        const result = await api.recheckCredentials();
        push(
          `${faDigits(result.checked)} اعتبارنامه بررسی شد؛ ${faDigits(result.updated)} مورد به‌روزرسانی و ${faDigits(result.weak)} رمز ضعیف شناسایی شد.`,
          'info'
        );
      }
      reloadAll();
    } catch (e) {
      push(e instanceof Error ? e.message : 'اجرای این عملیات ممکن نشد.', 'error');
    } finally {
      setToolsBusy(false);
    }
  };

  const clearFilters = () => {
    resetParams();
    setSearchInput('');
  };

  return (
    <div className="space-y-4">
      {/* سربرگ صفحه */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-accent">
            <KeyRound size={20} />
          </span>
          <div>
            <h2 className="section-title !mb-0">مخزن اعتبارنامهٔ تجهیزات</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-500">
              رمزها با AES‑256‑GCM رمزنگاری می‌شوند، فقط با مجوز نمایش و به‌صورت صریح خوانده می‌شوند و هر نمایش در
              گزارش حسابرسی ثبت می‌شود.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost btn-xs" onClick={reloadAll} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            به‌روزرسانی
          </button>
          {canWrite ? (
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => void runTool('import')}
              disabled={toolsBusy}
              title="انتقال نام کاربری/رمز فعلی تجهیزات به مخزن (یک‌بار برای هر تجهیز)"
            >
              <Download size={14} />
              انتقال از تجهیزات
            </button>
          ) : null}
          {isAdmin ? (
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => void runTool('recheck')}
              disabled={toolsBusy}
              title="بازمحاسبهٔ امتیاز قدرت همهٔ رمزها با قواعد فعلی"
            >
              <ShieldCheck size={14} />
              بازمحاسبهٔ قدرت
            </button>
          ) : null}
          {canWrite ? (
            <button type="button" className="btn-primary btn-xs" onClick={openCreate}>
              <Plus size={14} />
              اعتبارنامهٔ جدید
            </button>
          ) : null}
        </div>
      </div>

      {/* خلاصه */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="کل اعتبارنامه‌ها"
          value={faDigits(summary?.total ?? 0)}
          hint={summary ? `میانگین قدرت ${fmtNumber(summary.avgStrength, 1)} از ۴` : 'در حال بارگذاری…'}
          icon={<KeyRound size={18} />}
          tone="brand"
          onClick={clearFilters}
        />
        <StatCard
          label="رمزهای ضعیف"
          value={faDigits(weakCount)}
          hint={weakCount ? 'برای دیدن فهرست کلیک کنید' : 'همهٔ رمزها قابل قبول‌اند'}
          icon={<TriangleAlert size={18} />}
          tone={weakCount ? 'red' : 'emerald'}
          onClick={() => setParam('weak', weak ? '' : '1')}
        />
        <StatCard
          label="موعد چرخش رسیده"
          value={faDigits(summary?.due ?? 0)}
          hint="بر اساس دورهٔ چرخش هر اعتبارنامه"
          icon={<CalendarClock size={18} />}
          tone={summary?.due ? 'sun' : 'ink'}
          onClick={() => setParam('due', due ? '' : '1')}
        />
        <StatCard
          label="بدون تجهیز"
          value={faDigits(summary?.detached ?? 0)}
          hint="اعتبارنامه‌های مستقل از تجهیزات"
          icon={<ShieldAlert size={18} />}
          tone="violet"
        />
      </div>

      {weakCount > 0 && !weak ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-sun-200 bg-sun-50/70 px-4 py-3">
          <p className="flex items-start gap-2 text-[12.5px] leading-5 text-ink-700">
            <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warning" />
            <span>
              {faDigits(weakCount)} اعتبارنامه رمز ضعیف یا پیش‌فرض دارد؛ این رمزها اولین هدف حدس‌زدن هستند. با
              تولیدکنندهٔ رمز، رمز قوی بسازید و روی تجهیز اعمال کنید.
            </span>
          </p>
          <button type="button" className="btn-warn btn-xs" onClick={() => setParam('weak', '1')}>
            نمایش رمزهای ضعیف
          </button>
        </div>
      ) : null}

      {/* جست‌وجو و فیلترها */}
      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="input !pr-9"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="جست‌وجو در عنوان، نام کاربری، میزبان، تجهیز یا برچسب…"
              aria-label="جست‌وجوی اعتبارنامه"
            />
            {searchInput ? (
              <button
                type="button"
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-ink-400 hover:bg-ink-100"
                onClick={() => setSearchInput('')}
                aria-label="پاک‌کردن جست‌وجو"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>

          <select
            className="input !w-auto min-w-[150px]"
            value={kind}
            onChange={(e) => setParam('kind', e.target.value)}
            aria-label="فیلتر نوع اعتبارنامه"
          >
            <option value="">همهٔ نوع‌ها</option>
            {kindsWithCounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
                {item.count ? ` (${faDigits(item.count)})` : ''}
              </option>
            ))}
          </select>

          <select
            className="input !w-auto min-w-[140px]"
            value={sort}
            onChange={(e) => setParam('sort', e.target.value === 'updated' ? '' : e.target.value)}
            aria-label="ترتیب نمایش"
          >
            {SORTS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className={`chip ${weak ? 'border-red-200 bg-red-50 text-danger' : 'border-ink-200 bg-surface text-ink-500'}`}
            onClick={() => setParam('weak', weak ? '' : '1')}
            aria-pressed={weak}
          >
            فقط ضعیف‌ها
          </button>
          <button
            type="button"
            className={`chip ${due ? 'border-sun-200 bg-sun-50 text-warning' : 'border-ink-200 bg-surface text-ink-500'}`}
            onClick={() => setParam('due', due ? '' : '1')}
            aria-pressed={due}
          >
            موعد چرخش
          </button>
          {filtersActive ? (
            <button type="button" className="btn-ghost btn-xs" onClick={clearFilters}>
              پاک‌کردن فیلترها
            </button>
          ) : null}
        </div>

        {loading && !data ? (
          <PageLoader label="در حال خواندن مخزن اعتبارنامه…" />
        ) : error ? (
          <div className="p-4">
            <ErrorState message={error} onRetry={refresh} />
          </div>
        ) : !items.length ? (
          <div className="p-4">
            <EmptyState
              icon={<KeyRound size={22} />}
              title={filtersActive ? 'موردی با این فیلترها پیدا نشد' : 'هنوز اعتبارنامه‌ای ثبت نشده است'}
              description={
                filtersActive
                  ? 'عبارت جست‌وجو یا فیلترها را تغییر دهید.'
                  : 'برای هر تجهیز می‌توانید چند دسترسی جداگانه تعریف کنید: SSH، پنل وب، SNMP، Wi‑Fi و … . رمزها رمزنگاری‌شده ذخیره می‌شوند.'
              }
              action={
                canWrite ? (
                  <button type="button" className="btn-primary btn-xs" onClick={openCreate}>
                    <Plus size={14} />
                    افزودن اولین اعتبارنامه
                  </button>
                ) : null
              }
            />
          </div>
        ) : (
          <>
            <CredentialsTable
              items={items}
              canWrite={canWrite}
              canReveal={canReveal}
              onReveal={setRevealTarget}
              onEdit={openEdit}
              onRotate={(credential) => void rotate(credential)}
              onDelete={setDeleting}
            />
            <div className="border-t border-ink-100 px-3">
              <Pagination
                page={data?.page ?? 1}
                pages={data?.pages ?? 1}
                total={data?.total ?? 0}
                pageSize={data?.pageSize ?? 20}
                onPage={(next) => setParam('page', next <= 1 ? '' : String(next))}
              />
            </div>
          </>
        )}
      </Card>

      {/* توزیع نوع‌ها */}
      {summary && summary.kinds.length ? (
        <Card>
          <CardHeader
            title="توزیع اعتبارنامه‌ها"
            subtitle="نوع دسترسی‌های ثبت‌شده برای تجهیزات"
            icon={<KeyRound size={16} />}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.kinds.map((item) => (
              <button
                key={item.kind}
                type="button"
                onClick={() => setParam('kind', kind === item.kind ? '' : item.kind)}
                className={`chip transition ${
                  kind === item.kind
                    ? 'border-brand-200 bg-brand-50 text-accent'
                    : 'border-ink-200 bg-surface text-ink-600 hover:border-brand-200'
                }`}
              >
                {item.label}
                <span className="num rounded-pill bg-ink-100 px-1.5 text-[10px] text-ink-500">
                  {faDigits(item.count)}
                </span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      <p className="flex items-start gap-2 px-1 text-[11px] leading-5 text-ink-400">
        <ShieldCheck size={13} className="mt-0.5 shrink-0" />
        رمزها با کلید سرور رمزنگاری می‌شوند؛ بدون فایل/متغیر کلید، پشتیبان پایگاه‌داده قابل رمزگشایی نیست. برای
        نگهداری امن، از فایل کلید پشتیبان جداگانه بگیرید.
      </p>

      <CredentialForm
        open={formOpen}
        credential={editing}
        devices={devices}
        onClose={() => setFormOpen(false)}
        onSaved={(saved, mode) => {
          reloadAll();
          if (mode === 'create' && strengthMeta(saved.strength).chip === 'red') {
            push('رمز ضعیف است؛ توصیه می‌شود با تولیدکنندهٔ رمز عوض شود.', 'warning');
          }
        }}
      />

      <CredentialReveal open={Boolean(revealTarget)} credential={revealTarget} onClose={() => setRevealTarget(null)} />

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        size="sm"
        title="حذف اعتبارنامه"
        subtitle={deleting ? `«${deleting.label}»` : undefined}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              انصراف
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => deleting && void remove(deleting)}
              disabled={deleteBusy}
            >
              {deleteBusy ? 'در حال حذف…' : 'حذف کن'}
            </button>
          </>
        }
      >
        <p className="text-[13px] leading-6 text-ink-600">
          این اعتبارنامه و نام کاربری/رمز رمزنگاری‌شدهٔ آن برای همیشه حذف می‌شود. خود رمز روی تجهیز تغییری نمی‌کند.
        </p>
        {deleting?.deviceId ? (
          <p className="mt-2 text-[11.5px] text-ink-400">
            متصل به تجهیز «{deleting.deviceName}» — اتصال از سمت تجهیز حذف نمی‌شود.
          </p>
        ) : null}
        <div className="mt-3">
          <Badge tone="red">این عمل قابل بازگشت نیست</Badge>
        </div>
      </Modal>
    </div>
  );
}
