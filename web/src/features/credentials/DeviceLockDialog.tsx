import { useEffect, useState } from 'react';
import { Lock, ShieldCheck, TriangleAlert, Unlock } from 'lucide-react';
import { Modal, Spinner } from '../../components/ui';

/**
 * تنظیم «رمزگذاری روی دستگاه».
 *
 * کلید از عبارت عبور دستگاه با PBKDF2 ساخته می‌شود و فقط نمک + هشِ کلید در
 * همین مرورگر می‌ماند؛ خود عبارت عبور ذخیره یا ارسال نمی‌شود.
 */
export default function DeviceLockDialog({
  open,
  onClose,
  supported,
  enabled,
  onEnable,
  onDisable,
  onLockNow,
}: {
  open: boolean;
  onClose: () => void;
  supported: boolean;
  enabled: boolean;
  onEnable: (passphrase: string) => Promise<void>;
  onDisable: (passphrase: string) => Promise<void>;
  onLockNow: () => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPassphrase('');
    setConfirm('');
    setBusy(false);
    setError(null);
  }, [open]);

  const enable = async () => {
    setError(null);
    if (passphrase.length < 8) {
      setError('عبارت عبور دستگاه باید حداقل ۸ نویسه باشد.');
      return;
    }
    if (passphrase !== confirm) {
      setError('عبارت عبور و تکرار آن یکسان نیستند.');
      return;
    }
    setBusy(true);
    try {
      await onEnable(passphrase);
      setPassphrase('');
      setConfirm('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فعال‌سازی رمزگذاری روی دستگاه ممکن نشد.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setError(null);
    if (!passphrase) {
      setError('برای غیرفعال‌کردن، عبارت عبور دستگاه را وارد کنید.');
      return;
    }
    setBusy(true);
    try {
      await onDisable(passphrase);
      setPassphrase('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'غیرفعال‌کردن قفل ممکن نشد.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="رمزگذاری روی دستگاه"
      subtitle="قفل خزانه با کلیدی که فقط روی همین مرورگر ساخته می‌شود"
      footer={
        <>
          {error ? <p className="me-auto text-[11.5px] text-danger">{error}</p> : null}
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            بستن
          </button>
          {enabled ? (
            <button type="button" className="btn-primary" onClick={() => void disable()} disabled={busy || !passphrase}>
              {busy ? <Spinner className="!h-4 !w-4" /> : <Unlock size={14} />}
              غیرفعال‌کردن
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={() => void enable()} disabled={busy || !supported}>
              {busy ? <Spinner className="!h-4 !w-4" /> : <Lock size={14} />}
              فعال‌سازی
            </button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {!supported ? (
          <p className="flex items-start gap-2 rounded-soft border border-sun-200 bg-sun-50/70 px-3 py-2 text-[11.5px] leading-5 text-warning">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            این مرورگر از رمزنگاری روی دستگاه پشتیبانی نمی‌کند. برای فعال‌بودن کلید محلی، برنامه باید از طریق HTTPS باز
            شود.
          </p>
        ) : null}

        {enabled ? (
          <div className="rounded-soft border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
            <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-success">
              <ShieldCheck size={14} />
              رمزگذاری روی دستگاه فعال است
            </p>
            <p className="mt-1 text-[11px] leading-5 text-ink-500">
              هنگام باز کردن این صفحه، برای دیدن یا کپی رمزها باید عبارت عبور دستگاه را وارد کنید. بعد از ۱۰ دقیقه
              بی‌کاری، خزانه خودکار قفل می‌شود.
            </p>
            <button type="button" className="btn-soft btn-xs mt-2" onClick={onLockNow}>
              <Lock size={12} />
              قفل کردن الآن
            </button>
          </div>
        ) : (
          <div className="rounded-soft border border-ink-100 bg-ink-50/60 px-3 py-2.5 text-[11.5px] leading-5 text-ink-500">
            با فعال‌کردن، کلیدی از عبارت عبور شما با PBKDF2‑SHA256 ساخته می‌شود و فقط روی همین مرورگر نگه داشته می‌شود.
            خود عبارت عبور ذخیره یا ارسال نمی‌شود. این قفل جدا از رمزنگاری AES‑256‑GCM سرور است.
          </div>
        )}

        <div className="grid gap-2">
          <label className="block">
            <span className="label mb-1">
              {enabled ? 'عبارت عبور دستگاه' : 'عبارت عبور دستگاه (حداقل ۸ نویسه)'}
            </span>
            <input
              type="password"
              className="field-strong"
              dir="ltr"
              autoComplete={enabled ? 'current-password' : 'new-password'}
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </label>
          {!enabled ? (
            <label className="block">
              <span className="label mb-1">تکرار عبارت عبور</span>
              <input
                type="password"
                className="field-strong"
                dir="ltr"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </label>
          ) : null}
        </div>

        <p className="text-[10.5px] leading-5 text-ink-400">
          اگر عبارت عبور را فراموش کردید، با پاک‌کردن داده‌های این سایت در مرورگر، قفل محلی برداشته می‌شود؛ رمزهای
          ذخیره‌شده روی سرور از بین نمی‌روند.
        </p>
      </div>
    </Modal>
  );
}
