import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Pencil,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Badge, Card, Spinner } from '../../components/ui';
import { useToast } from '../../lib/store';
import { faDigits, fmtRelative } from '../../lib/format';
import { strengthMeta } from '../../lib/credential-rules';
import type { Credential, CredentialCheckupItem } from '../../lib/types';

const AUTO_HIDE_MS = 45000;
const CLIPBOARD_CLEAR_MS = 30000;

/**
 * پنل جزئیات یک ورود — همهٔ اطلاعات ورود در یک نگاه.
 * رمز فقط با درخواست صریح کاربر از سرور خوانده می‌شود، پس از ۴۵ ثانیه خودکار
 * پنهان می‌شود و با تغییر ورود، مقدار آن از حافظهٔ صفحه پاک می‌شود.
 */
export default function CredentialDetail({
  credential,
  issue,
  canReveal,
  canWrite,
  onEdit,
  onDelete,
  onClose,
  onRevealSecret,
}: {
  credential: Credential;
  issue?: CredentialCheckupItem | null;
  canReveal: boolean;
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  onRevealSecret: (id: number) => Promise<string | null>;
}) {
  const { push } = useToast();
  const [secret, setSecret] = useState('');
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<'username' | 'secret' | null>(null);
  const clearTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  const wipe = useCallback(() => {
    setSecret('');
    setVisible(false);
    setLoading(false);
    setCopied(null);
  }, []);

  useEffect(() => {
    wipe();
  }, [credential.id, wipe]);

  useEffect(() => {
    return () => {
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  const scheduleHide = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setVisible(false);
      setSecret('');
    }, AUTO_HIDE_MS);
  };

  const ensureSecret = async (): Promise<string | null> => {
    if (secret) return secret;
    setLoading(true);
    const value = await onRevealSecret(credential.id);
    setLoading(false);
    if (value == null) return null;
    setSecret(value);
    return value;
  };

  const toggleSecret = async () => {
    if (visible) {
      setVisible(false);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      return;
    }
    const value = await ensureSecret();
    if (value == null) return;
    setVisible(true);
    scheduleHide();
  };

  const copy = async (kind: 'username' | 'secret') => {
    const value = kind === 'username' ? credential.username : await ensureSecret();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 2000);
      if (kind === 'secret') {
        if (clearTimer.current) window.clearTimeout(clearTimer.current);
        clearTimer.current = window.setTimeout(() => {
          void navigator.clipboard.writeText('').catch(() => {});
        }, CLIPBOARD_CLEAR_MS);
        push('رمز کپی شد؛ کلیپ‌بورد پس از ۳۰ ثانیه پاک می‌شود.', 'info');
      }
    } catch {
      push('کپی در مرورگر مجاز نیست؛ مقدار را دستی انتخاب کنید.', 'warning');
    }
  };

  const meta = strengthMeta(credential.strength);
  const target = credential.host ? `${credential.host}${credential.port ? `:${credential.port}` : ''}` : '';
  const issues = issue?.issues ?? [];

  return (
    <Card padded={false} className="flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-ink-100 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-accent">
            <KeyRound size={20} />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-ink-800">{credential.label}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone="ink">{credential.kindLabel}</Badge>
              <span className={`inline-flex items-center gap-1 text-[11px] ${meta.text}`}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.bar }} />
                {meta.label}
              </span>
              {credential.deviceId ? (
                <Link to={`/devices/${credential.deviceId}`} className="text-[11px] text-accent hover:underline">
                  {credential.deviceName ?? `تجهیز #${credential.deviceId}`}
                </Link>
              ) : null}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-400 transition hover:bg-ink-50 hover:text-ink-800 lg:hidden"
          onClick={onClose}
          aria-label="بستن جزئیات"
          title="بستن"
        >
          <X size={16} />
        </button>
      </div>

      <div className="space-y-3 p-4">
        {issues.length ? (
          <div className="space-y-1.5 rounded-soft border border-sun-200 bg-sun-50/80 p-3 text-[11.5px] leading-5 text-ink-600">
            {issues.includes('breached') ? (
              <p className="flex items-start gap-1.5 font-medium text-danger">
                <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                این رمز در فهرست رمزهای افشاشده یا پیش‌فرض دیده شده است؛ آن را عوض کنید.
              </p>
            ) : null}
            {issues.includes('reused') ? (
              <p className="flex items-start gap-1.5 text-warning">
                <Copy size={12} className="mt-0.5 shrink-0" />
                همین رمز برای {faDigits(issue?.sharedWith ?? 0)} ورودی استفاده شده است؛ بهتر است برای هر تجهیز رمز جداگانه باشد.
              </p>
            ) : null}
            {issues.includes('weak') ? (
              <p className="flex items-start gap-1.5 text-warning">
                <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                {credential.weakReasons[0] ?? 'این رمز ضعیف است و به‌راحتی حدس زده می‌شود.'}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="divide-y divide-ink-100 overflow-hidden rounded-soft border border-ink-100">
          <div className="flex items-center gap-2 bg-surface px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] text-ink-400">نام کاربری</p>
              <p className="mt-0.5 break-all text-[13px] text-ink-800" dir="ltr">
                {credential.username || '—'}
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost btn-xs px-2"
              onClick={() => void copy('username')}
              disabled={!credential.username}
              title="کپی نام کاربری"
              aria-label="کپی نام کاربری"
            >
              {copied === 'username' ? <Check size={14} className="text-success" /> : <Copy size={14} />}
            </button>
          </div>

          <div className="flex items-center gap-2 bg-surface px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] text-ink-400">رمز عبور</p>
              <p className="mt-0.5 break-all font-mono text-[13px] text-ink-800" dir="ltr">
                {loading ? (
                  <span className="font-sans text-[11px] text-ink-400">در حال رمزگشایی…</span>
                ) : visible && secret ? (
                  secret
                ) : (
                  '••••••••••••'
                )}
              </p>
            </div>
            {canReveal ? (
              <>
                <button
                  type="button"
                  className="btn-ghost btn-xs px-2"
                  onClick={() => void toggleSecret()}
                  disabled={loading || !credential.hasSecret}
                  title={visible ? 'پنهان‌کردن رمز' : 'نمایش رمز'}
                  aria-label={visible ? 'پنهان‌کردن رمز' : 'نمایش رمز'}
                >
                  {loading ? <Spinner className="!h-3.5 !w-3.5" /> : visible ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-xs px-2"
                  onClick={() => void copy('secret')}
                  disabled={loading || !credential.hasSecret}
                  title="کپی رمز"
                  aria-label="کپی رمز"
                >
                  {copied === 'secret' ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                </button>
              </>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-400" title="برای نمایش رمز به مجوز نمایش نیاز دارید">
                <Lock size={12} /> بدون مجوز نمایش
              </span>
            )}
          </div>

          {target ? (
            <div className="flex items-center gap-2 bg-surface px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[10.5px] text-ink-400">میزبان</p>
                <p className="mt-0.5 break-all font-mono text-[12.5px] text-ink-700" dir="ltr">
                  {target}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {credential.tags.length ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10.5px] text-ink-400">برچسب‌ها:</span>
            {credential.tags.map((tag) => (
              <Badge key={tag} tone="brand" className="!px-1.5 !py-0 !text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}

        {credential.notes ? (
          <div>
            <p className="text-[10.5px] text-ink-400">یادداشت</p>
            <p className="mt-0.5 whitespace-pre-wrap rounded-soft border border-ink-100 bg-ink-50/50 p-2.5 text-[12px] leading-5 text-ink-600">
              {credential.notes}
            </p>
          </div>
        ) : null}

        <p className="text-[10.5px] text-ink-400">
          آخرین تغییر: {fmtRelative(credential.updatedAt)}
          {credential.createdBy ? ` · ثبت‌شده توسط ${credential.createdBy}` : ''}
        </p>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-ink-100 bg-ink-50/50 p-3">
        {canWrite ? (
          <>
            <button type="button" className="btn-soft btn-xs" onClick={onEdit}>
              <Pencil size={13} />
              ویرایش
            </button>
            <button
              type="button"
              className="btn-ghost btn-xs ms-auto text-danger hover:bg-red-50"
              onClick={onDelete}
              aria-label={`حذف ${credential.label}`}
            >
              <Trash2 size={13} />
              حذف
            </button>
          </>
        ) : (
          <span className="text-[10.5px] text-ink-400">فقط مشاهده — ویرایش نیاز به مجوز نوشتن دارد.</span>
        )}
      </div>
    </Card>
  );
}
