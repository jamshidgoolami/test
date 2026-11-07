import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/store';
import { faDigits } from '../../lib/format';
import { Modal, Spinner } from '../../components/ui';
import type { Credential, CredentialReveal as RevealData } from '../../lib/types';

const AUTO_CLOSE_SECONDS = 45;
const CLIPBOARD_CLEAR_MS = 30000;

/**
 * نمایش صریح رمز یک اعتبارنامه.
 *
 * قواعد:
 *   • رمز فقط زمانی از سرور خوانده می‌شود که کاربر «نمایش رمز» را زده باشد.
 *   • با بستن پنجره، مقدار از state پاک می‌شود و پنجره پس از ۴۵ ثانیه خودکار
 *     بسته می‌شود تا رمز روی صفحهٔ باز رها نماند.
 *   • کپی، کلیپ‌بورد را پس از ۳۰ ثانیه پاک می‌کند (به‌صورت بهترین‌تلاش؛ اگر
 *     مرورگر اجازه نداد، فقط پیام اطلاع‌رسانی نشان داده می‌شود).
 */
export default function CredentialReveal({
  open,
  credential,
  onClose,
}: {
  open: boolean;
  credential: Credential | null;
  onClose: () => void;
}) {
  const { push } = useToast();
  const [data, setData] = useState<RevealData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [remaining, setRemaining] = useState(AUTO_CLOSE_SECONDS);
  const [copied, setCopied] = useState<'secret' | 'username' | null>(null);
  const clearTimer = useRef<number | null>(null);

  const wipe = useCallback(() => {
    setData(null);
    setVisible(true);
    setCopied(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!open || !credential) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setVisible(true);
    setRemaining(AUTO_CLOSE_SECONDS);
    api
      .revealCredential(credential.id)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'خواندن رمز ممکن نشد.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      wipe();
    };
  }, [open, credential, wipe]);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(id);
          onClose();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [open, onClose]);

  useEffect(() => {
    return () => {
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
    };
  }, []);

  const copy = async (kind: 'secret' | 'username') => {
    const value = kind === 'secret' ? data?.secret : data?.username;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
      clearTimer.current = window.setTimeout(() => {
        void navigator.clipboard.writeText('').catch(() => {});
      }, CLIPBOARD_CLEAR_MS);
      if (kind === 'secret') push('رمز کپی شد؛ کلیپ‌بورد پس از ۳۰ ثانیه پاک می‌شود.', 'info');
    } catch {
      push('کپی در مرورگر مجاز نیست؛ مقدار را دستی انتخاب کنید.', 'warning');
    }
  };

  const rows = [
    { key: 'username' as const, label: 'نام کاربری', value: data?.username ?? '' },
    { key: 'secret' as const, label: 'رمز / توکن', value: data?.secret ?? '', secret: true },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={credential ? `رمز «${credential.label}»` : 'نمایش رمز'}
      subtitle="این نمایش در گزارش حسابرسی ثبت شده است و پاسخ آن در مرورگر کش نمی‌شود."
      footer={
        <>
          <span className="mr-auto text-[11px] text-ink-400">
            بستن خودکار در {faDigits(remaining)} ثانیه
          </span>
          <button type="button" className="btn-ghost" onClick={onClose}>
            بستن
          </button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-400">
          <Spinner /> در حال رمزگشایی…
        </div>
      ) : error ? (
        <div className="rounded-soft border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-danger" role="alert">
          {error}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-soft border border-sun-200 bg-sun-50 px-3 py-2 text-[11.5px] leading-5 text-warning">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <ShieldAlert size={13} /> مراقب محیط باشید
            </span>
            <p className="mt-0.5 text-ink-600">
              رمز را در چت، ایمیل یا فایل متنی نگه ندارید. پس از استفاده، پنجره را ببندید.
            </p>
          </div>

          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-2 rounded-soft border border-ink-200 bg-surface px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-ink-400">{row.label}</p>
                <p className="mt-0.5 break-all font-mono text-[13px] text-ink-800" dir="ltr">
                  {row.value ? (row.secret && !visible ? '•'.repeat(Math.min(24, row.value.length)) : row.value) : '—'}
                </p>
              </div>
              {row.secret ? (
                <button
                  type="button"
                  className="btn-ghost btn-xs px-2"
                  onClick={() => setVisible((value) => !value)}
                  aria-label={visible ? 'پنهان‌کردن رمز' : 'نمایش رمز'}
                  title={visible ? 'پنهان‌کردن' : 'نمایش'}
                >
                  {visible ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              ) : null}
              <button
                type="button"
                className="btn-ghost btn-xs px-2"
                onClick={() => void copy(row.key)}
                disabled={!row.value}
                aria-label={`کپی ${row.label}`}
                title="کپی"
              >
                {copied === row.key ? <Check size={14} className="text-success" /> : <Copy size={14} />}
              </button>
            </div>
          ))}

          {credential ? (
            <p className="text-[11px] text-ink-400">
              آخرین چرخش: {credential.lastRotatedAt ? new Date(credential.lastRotatedAt).toLocaleDateString('fa-IR') : 'ثبت نشده'}
              {credential.rotateEveryDays ? ` · دورهٔ چرخش ${faDigits(credential.rotateEveryDays)} روز` : ''}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
