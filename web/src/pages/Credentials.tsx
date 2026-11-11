import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Dices, KeyRound, Lock, Plus, ShieldAlert, ShieldCheck, Unlock } from 'lucide-react';
import { api, downloadUrl } from '../lib/api';
import { useAsync, useSubmitGuard, useToast } from '../lib/store';
import { useAuth } from '../lib/auth';
import { useUrlParams } from '../lib/params';
import { faDigits, fmtRelative } from '../lib/format';
import { Card, EmptyState, Modal, Spinner } from '../components/ui';
import CredentialForm from '../features/credentials/CredentialForm';
import CredentialList from '../features/credentials/CredentialList';
import CredentialDetail from '../features/credentials/CredentialDetail';
import CheckupPanel from '../features/credentials/CheckupPanel';
import ImportExportDialog from '../features/credentials/ImportExportDialog';
import DeviceLockDialog from '../features/credentials/DeviceLockDialog';
import PasswordGenerator from '../features/credentials/PasswordGenerator';
import {
  disableDeviceLock,
  enableDeviceLock,
  getDeviceLock,
  isDeviceLockSupported,
  verifyDeviceLock,
} from '../lib/device-vault';
import type { Credential } from '../lib/types';

const AUTO_LOCK_MS = 10 * 60 * 1000;

/**
 * خزانهٔ امن رمز عبور — شبیه Google Password Manager.
 *
 * ساختار صفحه:
 *   • نوار بالا: افزودن رمز، تولید رمز، بررسی امنیت، ورود/خروجی، رمزگذاری دستگاه
 *   • ستون فهرست + پنل جزئیات (در موبایل، جزئیات جای فهرست را می‌گیرد)
 *   • نمای «بررسی امنیت» برای رمزهای ضعیف، تکراری و افشاشده
 *
 * رمزها فقط با درخواست صریح از سرور خوانده می‌شوند و در هیچ پاسخ فهرستی
 * نمی‌آیند. قفل محلی دستگاه تا باز نشود، اجازهٔ ورود به خزانه نمی‌دهد.
 */
export default function Credentials() {
  const { push } = useToast();
  const { can } = useAuth();
  const canWrite = can('credentials:write');
  const canReveal = can('credentials:reveal');
  const { params, setParam } = useUrlParams();

  const search = params.get('search') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const view: 'vault' | 'checkup' = params.get('view') === 'checkup' ? 'checkup' : 'vault';
  const selectedId = Number(params.get('credential') ?? '') || null;

  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => {
    setSearchInput(search);
  }, [search]);
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return;
    const timer = window.setTimeout(() => setParam('search', trimmed), 320);
    return () => window.clearTimeout(timer);
  }, [searchInput, search, setParam]);

  const { data, loading, error, refresh } = useAsync(
    (signal) => api.credentials({ search, page, pageSize: 50 }, signal),
    [search, page]
  );
  const {
    data: checkup,
    loading: checkupLoading,
    error: checkupError,
    refresh: refreshCheckup,
  } = useAsync((signal) => api.credentialCheckup(signal), []);
  const { data: devicePage } = useAsync((signal) => api.devices({ pageSize: 500 }, signal), []);
  const devices = devicePage?.items ?? [];

  const items = data?.items ?? [];
  const issues = useMemo(
    () => new Map((checkup?.items ?? []).map((item) => [item.id, item])),
    [checkup]
  );

  const [detail, setDetail] = useState<Credential | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Credential | null>(null);
  const [suggestedSecret, setSuggestedSecret] = useState('');
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleting, setDeleting] = useState<Credential | null>(null);
  const { busy: deleteBusy, run: runDelete } = useSubmitGuard();

  /* ------------------------- قفل رمزگذاری‌شدهٔ دستگاه ------------------------- */
  const [lock, setLock] = useState({
    supported: isDeviceLockSupported(),
    ready: false,
    enabled: false,
    unlocked: true,
  });
  const [lockOpen, setLockOpen] = useState(false);
  const [unlockPass, setUnlockPass] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!isDeviceLockSupported()) {
      setLock((prev) => ({ ...prev, ready: true }));
      return;
    }
    getDeviceLock()
      .then((record) => {
        if (alive) setLock({ supported: true, ready: true, enabled: Boolean(record), unlocked: !record });
      })
      .catch(() => {
        if (alive) setLock((prev) => ({ ...prev, ready: true }));
      });
    return () => {
      alive = false;
    };
  }, []);

  // قفل خودکار پس از ۱۰ دقیقه بی‌کاری؛ هر تعامل کاربر مهلت را تازه می‌کند.
  useEffect(() => {
    if (!lock.enabled || !lock.unlocked) return;
    let timer = 0;
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setLock((prev) => (prev.enabled ? { ...prev, unlocked: false } : prev));
      }, AUTO_LOCK_MS);
    };
    reset();
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
    };
  }, [lock.enabled, lock.unlocked]);

  const locked = lock.ready && lock.enabled && !lock.unlocked;

  const unlockVault = async () => {
    setUnlockBusy(true);
    setUnlockError(null);
    try {
      const ok = await verifyDeviceLock(unlockPass);
      if (!ok) {
        setUnlockError('عبارت عبور دستگاه درست نیست.');
        return;
      }
      setLock((prev) => ({ ...prev, unlocked: true }));
      setUnlockPass('');
    } catch (e) {
      setUnlockError(e instanceof Error ? e.message : 'باز کردن قفل ممکن نشد.');
    } finally {
      setUnlockBusy(false);
    }
  };

  const handleEnableLock = async (passphrase: string) => {
    await enableDeviceLock(passphrase);
    setLock((prev) => ({ ...prev, enabled: true, unlocked: true, ready: true }));
    push('رمزگذاری روی دستگاه فعال شد؛ از این پس این مرورگر برای دیدن رمزها قفل است.', 'success');
  };

  const handleDisableLock = async (passphrase: string) => {
    const ok = await verifyDeviceLock(passphrase);
    if (!ok) throw new Error('عبارت عبور دستگاه درست نیست.');
    await disableDeviceLock();
    setLock((prev) => ({ ...prev, enabled: false, unlocked: true }));
    push('رمزگذاری روی دستگاه غیرفعال شد.', 'info');
  };

  /* ------------------------------ جزئیات ------------------------------ */
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let alive = true;
    const fromList = items.find((item) => item.id === selectedId) ?? null;
    if (fromList) setDetail(fromList);
    api
      .credential(selectedId)
      .then((row) => {
        if (alive) setDetail(row);
      })
      .catch(() => {
        if (alive) setDetail(fromList);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, data]);

  const reloadAll = useCallback(() => {
    refresh();
    refreshCheckup();
  }, [refresh, refreshCheckup]);

  const openCreate = (secret = '') => {
    setEditing(null);
    setSuggestedSecret(secret);
    setFormOpen(true);
  };

  const openEdit = (credential: Credential) => {
    setEditing(credential);
    setSuggestedSecret('');
    setFormOpen(true);
  };

  const remove = async (credential: Credential) => {
    const done = await runDelete(async () => {
      try {
        await api.deleteCredential(credential.id);
        push('رمز عبور حذف شد.', 'success');
        setDeleting(null);
        setParam('credential', '');
        reloadAll();
        return true;
      } catch (e) {
        push(e instanceof Error ? e.message : 'حذف رمز ممکن نشد.', 'error');
        return false;
      }
    });
    if (!done) setDeleting(null);
  };

  const revealSecret = useCallback(
    async (id: number): Promise<string | null> => {
      try {
        const result = await api.revealCredential(id);
        return result.secret;
      } catch (e) {
        push(e instanceof Error ? e.message : 'خواندن رمز ممکن نشد.', 'error');
        return null;
      }
    },
    [push]
  );

  const copyUsername = async (credential: Credential) => {
    if (!credential.username) return;
    try {
      await navigator.clipboard.writeText(credential.username);
      push('نام کاربری کپی شد.', 'info');
    } catch {
      push('کپی در مرورگر مجاز نیست؛ مقدار را دستی انتخاب کنید.', 'warning');
    }
  };

  const exportVault = (format: 'xlsx' | 'csv') => {
    if (!canReveal) {
      push('برای خروجی گرفتن، مجوز نمایش رمز لازم است.', 'warning');
      return;
    }
    const link = document.createElement('a');
    link.href = downloadUrl('/credentials/export', { format });
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    push('فایل خروجی در حال آماده‌سازی است…', 'info');
  };

  const issueCount = checkup?.issues ?? 0;

  return (
    <div className="space-y-4">
      {/* سربرگ */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-accent">
            <KeyRound size={20} />
          </span>
          <div>
            <h2 className="section-title !mb-0">خزانهٔ رمز عبور</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-500">
              نام کاربری و رمز تجهیزات را در یک فضای رمزگذاری‌شده ذخیره کنید؛ رمز قوی بسازید، امنیت رمزها را بررسی
              کنید و در صورت نیاز از فایل Excel ورود/خروجی بگیرید.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`btn-ghost btn-xs ${view === 'checkup' ? '!bg-brand-50 !text-accent' : ''}`}
            onClick={() => setParam('view', view === 'checkup' ? '' : 'checkup')}
            disabled={locked}
            aria-pressed={view === 'checkup'}
          >
            <ShieldCheck size={14} />
            بررسی امنیت
            {issueCount ? (
              <span className="num rounded-pill bg-sun-100 px-1.5 text-[10px] text-warning">{faDigits(issueCount)}</span>
            ) : null}
          </button>
          <button type="button" className="btn-ghost btn-xs" onClick={() => setGeneratorOpen(true)} disabled={locked}>
            <Dices size={14} />
            تولید رمز
          </button>
          <button type="button" className="btn-ghost btn-xs" onClick={() => setImportOpen(true)} disabled={locked}>
            <ArrowUpDown size={14} />
            ورود و خروجی
          </button>
          <button
            type="button"
            className="btn-ghost btn-xs"
            onClick={() => setLockOpen(true)}
            title="رمزگذاری روی دستگاه — قفل خزانه با کلید محلی"
          >
            <Lock size={14} />
            رمزگذاری روی دستگاه
            {lock.enabled ? <span className="h-1.5 w-1.5 rounded-full bg-success" aria-label="فعال" /> : null}
          </button>
          {canWrite ? (
            <button type="button" className="btn-primary btn-xs" onClick={() => openCreate()} disabled={locked}>
              <Plus size={14} />
              افزودن رمز عبور
            </button>
          ) : null}
        </div>
      </div>

      {locked ? (
        <Card className="mx-auto max-w-lg">
          <div className="flex flex-col items-center text-center">
            <span className="grid h-14 w-14 place-items-center rounded-3xl border border-brand-100 bg-brand-50 text-accent">
              <Lock size={26} />
            </span>
            <h3 className="mt-3 text-[15px] font-semibold text-ink-800">خزانه روی این دستگاه قفل است</h3>
            <p className="mt-1 max-w-sm text-[12px] leading-6 text-ink-500">
              برای دیدن، کپی یا ویرایش رمزها، عبارت عبور دستگاه را وارد کنید. کلید این قفل فقط روی همین مرورگر ساخته
              شده و جایی ارسال نمی‌شود.
            </p>
            <form
              className="mt-4 w-full max-w-sm space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void unlockVault();
              }}
            >
              <input
                type="password"
                className="field-strong"
                dir="ltr"
                autoComplete="current-password"
                value={unlockPass}
                onChange={(event) => {
                  setUnlockPass(event.target.value);
                  setUnlockError(null);
                }}
                placeholder="عبارت عبور دستگاه"
                aria-label="عبارت عبور دستگاه"
                autoFocus
              />
              {unlockError ? (
                <p className="text-[11.5px] text-danger" role="alert">
                  {unlockError}
                </p>
              ) : null}
              <button
                type="submit"
                className="btn-primary w-full justify-center"
                disabled={unlockBusy || !unlockPass}
              >
                {unlockBusy ? <Spinner className="!h-4 !w-4" /> : <Unlock size={14} />}
                باز کردن قفل
              </button>
            </form>
            <p className="mt-3 text-[10.5px] leading-5 text-ink-400">
              اگر عبارت عبور را فراموش کرده‌اید، داده‌های همین سایت را در مرورگر پاک کنید؛ قفل محلی برداشته می‌شود و
              رمزهای ذخیره‌شده روی سرور باقی می‌مانند.
            </p>
          </div>
        </Card>
      ) : view === 'checkup' ? (
        <CheckupPanel
          data={checkup ?? null}
          loading={checkupLoading}
          error={checkupError}
          onRefresh={refreshCheckup}
          onOpen={(id) => {
            setParam('view', '');
            setParam('credential', String(id));
          }}
        />
      ) : (
        <>
          {issueCount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-sun-200 bg-sun-50/70 px-3 py-2.5">
              <p className="flex items-start gap-2 text-[12px] leading-5 text-ink-600">
                <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warning" />
                <span>
                  {faDigits(issueCount)} رمز نیاز به بررسی دارد — رمزهای ضعیف، تکراری یا افشاشده.
                </span>
              </p>
              <button type="button" className="btn-warn btn-xs" onClick={() => setParam('view', 'checkup')}>
                مشاهدهٔ بررسی امنیت
              </button>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,390px)_minmax(0,1fr)] lg:items-start">
            <div className={selectedId ? 'hidden lg:block' : ''}>
              <CredentialList
                items={items}
                total={data?.total ?? 0}
                pages={data?.pages ?? 1}
                page={data?.page ?? 1}
                pageSize={data?.pageSize ?? 50}
                loading={loading}
                error={error}
                issues={issues}
                selectedId={selectedId}
                canWrite={canWrite}
                searchInput={searchInput}
                onSearchChange={setSearchInput}
                onClearSearch={() => {
                  setSearchInput('');
                  setParam('search', '');
                }}
                onSelect={(credential) => setParam('credential', String(credential.id))}
                onEdit={openEdit}
                onCopyUsername={(credential) => void copyUsername(credential)}
                onRetry={refresh}
                onPage={(next) => setParam('page', next <= 1 ? '' : String(next))}
              />
            </div>

            <div className="min-w-0">
              {detail ? (
                <CredentialDetail
                  key={detail.id}
                  credential={detail}
                  issue={issues.get(detail.id)}
                  canReveal={canReveal}
                  canWrite={canWrite}
                  onEdit={() => openEdit(detail)}
                  onDelete={() => setDeleting(detail)}
                  onClose={() => setParam('credential', '')}
                  onRevealSecret={revealSecret}
                />
              ) : (
                <Card className="hidden min-h-[360px] lg:grid">
                  <EmptyState
                    icon={<KeyRound size={22} />}
                    title="یک ورود را انتخاب کنید"
                    description="نام کاربری، رمز، میزبان و یادداشت هر ورود در این پنل نمایش داده می‌شود. هیچ رمزی بدون درخواست شما خوانده نمی‌شود."
                  />
                </Card>
              )}
            </div>
          </div>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10.5px] leading-5 text-ink-400">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck size={12} /> رمزنگاری AES‑256‑GCM روی سرور
            </span>
            <span className="inline-flex items-center gap-1">
              <Lock size={12} /> {lock.enabled ? 'رمزگذاری روی این دستگاه فعال است' : 'رمزگذاری روی دستگاه خاموش است'}
            </span>
            {checkup ? <span>آخرین بررسی امنیت: {fmtRelative(checkup.generatedAt)}</span> : null}
          </p>
        </>
      )}

      {/* پنجره‌ها */}
      <CredentialForm
        open={formOpen}
        credential={editing}
        devices={devices}
        suggestedSecret={suggestedSecret}
        onClose={() => setFormOpen(false)}
        onSaved={(saved, mode) => {
          reloadAll();
          if (mode === 'create') setParam('credential', String(saved.id));
        }}
      />

      <Modal
        open={generatorOpen}
        onClose={() => setGeneratorOpen(false)}
        size="lg"
        title="تولید رمز عبور"
        subtitle="رمز تصادفی، قوی و یکتا در خزانه — قابل استفاده برای هر تجهیز"
      >
        <PasswordGenerator
          onUse={(value) => {
            setGeneratorOpen(false);
            openCreate(value);
          }}
        />
      </Modal>

      <ImportExportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        canReveal={canReveal}
        onImported={reloadAll}
        onExport={exportVault}
      />

      <DeviceLockDialog
        open={lockOpen}
        onClose={() => setLockOpen(false)}
        supported={lock.supported}
        enabled={lock.enabled}
        onEnable={handleEnableLock}
        onDisable={handleDisableLock}
        onLockNow={() => {
          setLockOpen(false);
          setLock((prev) => ({ ...prev, unlocked: false }));
          push('خزانه قفل شد.', 'info');
        }}
      />

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        size="sm"
        title="حذف رمز عبور"
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
          این ورود و نام کاربری/رمز رمزنگاری‌شدهٔ آن برای همیشه حذف می‌شود. خود رمز روی تجهیز تغییری نمی‌کند.
        </p>
        {deleting?.deviceId ? (
          <p className="mt-2 text-[11.5px] text-ink-400">
            متصل به تجهیز «{deleting.deviceName}» — اتصال از سمت تجهیز حذف نمی‌شود.
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
