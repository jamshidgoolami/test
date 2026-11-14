import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, ShieldAlert } from 'lucide-react';
import { Modal } from '../../components/ui';

export default function AgentTokenDialog({
  open,
  token,
  serverName,
  onClose,
}: {
  open: boolean;
  token: string | null;
  serverName?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');

  useEffect(() => {
    if (open) {
      setCopied(false);
      setCopyError('');
    }
  }, [open, token]);

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setCopyError('');
    } catch {
      setCopyError('مرورگر اجازهٔ کپی خودکار نداد؛ توکن را دستی انتخاب و کپی کنید.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="توکن Agent"
      subtitle={serverName ? `توکن اختصاصی ${serverName}` : 'توکن اختصاصی این سرور'}
      size="md"
      footer={
        <button type="button" className="btn-primary" onClick={onClose}>
          متوجه شدم
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-soft border border-sun-200 bg-sun-50/70 p-3 text-xs text-ink-700">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warning" />
          <p>
            این توکن فقط همین یک‌بار نمایش داده می‌شود. آن را در فایل امن روی سرور ویندوزی ذخیره کنید. اگر گم شد،
            از دکمهٔ «توکن جدید» استفاده کنید؛ توکن قبلی بلافاصله باطل می‌شود.
          </p>
        </div>
        <div>
          <p className="label flex items-center gap-1.5">
            <KeyRound size={13} /> مقدار توکن
          </p>
          <div className="flex items-stretch gap-2">
            <code
              className="min-w-0 flex-1 select-all break-all rounded-soft border border-ink-200 bg-ink-50 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink-700"
              dir="ltr"
            >
              {token || '—'}
            </code>
            <button type="button" className="btn-ghost shrink-0" onClick={() => void copy()} aria-label="کپی توکن">
              {copied ? <Check size={15} className="text-success" /> : <Copy size={15} />}
              {copied ? 'کپی شد' : 'کپی'}
            </button>
          </div>
          {copyError ? <p className="mt-1 text-[11px] text-warning">{copyError}</p> : null}
        </div>
        <div className="rounded-soft border border-ink-100 p-3 text-[11.5px] leading-relaxed text-ink-500">
          روی سرور ویندوزی، اسکریپت <code dir="ltr">Install-NetWatchAgent.ps1</code> را با آدرس NetWatch و همین توکن
          اجرا کنید. Agent به‌صورت سرویس ویندوز نصب می‌شود و هر ۳۰ ثانیه متریک می‌فرستد.
        </div>
      </div>
    </Modal>
  );
}
