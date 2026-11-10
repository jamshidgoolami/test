import React, { useEffect, useRef, useState } from 'react';
import { Check, Download, FileSpreadsheet, ShieldAlert, Upload, X } from 'lucide-react';
import { Badge, Modal, Spinner, Tabs } from '../../components/ui';
import { api } from '../../lib/api';
import { useToast } from '../../lib/store';
import { faDigits } from '../../lib/format';
import type { CredentialImportResult } from '../../lib/types';

const IMPORT_COLUMNS = 'عنوان، نام کاربری، رمز عبور، میزبان، پورت، تجهیز، نوع، برچسب‌ها، توضیحات';

/**
 * ورود و خروجی خزانه از/به فایل Excel یا CSV.
 * ورود، ردیف‌به‌ردیف انجام می‌شود و عنوان‌های تکراری نادیده گرفته می‌شوند؛
 * خروجی شامل رمزهای خام است و فقط با مجوز «نمایش رمز» ممکن می‌شود.
 */
export default function ImportExportDialog({
  open,
  onClose,
  canReveal,
  onImported,
  onExport,
}: {
  open: boolean;
  onClose: () => void;
  canReveal: boolean;
  onImported: () => void;
  onExport: (format: 'xlsx' | 'csv') => void;
}) {
  const { push } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'import' | 'export'>('import');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CredentialImportResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setResult(null);
    setFile(null);
    setBusy(false);
    setTab('import');
  }, [open]);

  const submit = async () => {
    if (!file) {
      setError('یک فایل Excel یا CSV انتخاب کنید.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await api.importCredentials(file);
      setResult(response);
      onImported();
      push(
        response.created
          ? `${faDigits(response.created)} رمز از فایل اضافه شد.`
          : 'رمز جدیدی برای افزودن پیدا نشد.',
        response.created ? 'success' : 'info'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خواندن فایل ممکن نشد.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="ورود و خروجی رمزها"
      subtitle="انتقال رمزها از فایل Excel/CSV و گرفتن نسخهٔ پشتیبان"
      footer={
        <>
          <span className="me-auto text-[10.5px] text-ink-400">
            {tab === 'import' ? 'ردیف‌های ناقص نادیده گرفته می‌شوند و در گزارش پایین می‌آیند.' : 'فایل خروجی برای ورود مجدد هم قابل استفاده است.'}
          </span>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            بستن
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Tabs
          tabs={[
            { value: 'import', label: 'ورود از فایل', icon: <Upload size={14} /> },
            { value: 'export', label: 'خروجی گرفتن', icon: <Download size={14} /> },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'import' ? (
          <div className="space-y-3">
            <p className="rounded-soft border border-ink-100 bg-ink-50/60 px-3 py-2 text-[11.5px] leading-5 text-ink-500">
              ستون‌های قابل شناسایی: <span className="text-ink-700">{IMPORT_COLUMNS}</span>. فقط «عنوان» و «رمز عبور»
              الزامی‌اند. ورودی‌هایی که عنوانشان از قبل وجود دارد دوباره ساخته نمی‌شوند.
            </p>

            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                setFile(picked);
                setResult(null);
                setError(null);
                event.currentTarget.value = '';
              }}
            />

            <div className="flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-ink-200 bg-surface/60 px-4 py-8 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-accent">
                <FileSpreadsheet size={20} />
              </span>
              {file ? (
                <>
                  <p className="break-all text-[12.5px] font-medium text-ink-700">{file.name}</p>
                  <p className="num text-[10.5px] text-ink-400">{faDigits(Math.max(1, Math.round(file.size / 1024)))} کیلوبایت</p>
                  <div className="mt-1 flex gap-2">
                    <button type="button" className="btn-ghost btn-xs" onClick={() => fileRef.current?.click()} disabled={busy}>
                      تغییر فایل
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-xs text-danger hover:bg-red-50"
                      onClick={() => {
                        setFile(null);
                        setResult(null);
                      }}
                      disabled={busy}
                    >
                      <X size={12} />
                      حذف انتخاب
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[12.5px] font-medium text-ink-700">فایل Excel یا CSV را انتخاب کنید</p>
                  <p className="text-[10.5px] text-ink-400">xlsx، xls یا csv — حداکثر ۱۰ مگابایت</p>
                  <button type="button" className="btn-primary btn-xs mt-1" onClick={() => fileRef.current?.click()}>
                    <Upload size={13} />
                    انتخاب فایل
                  </button>
                </>
              )}
            </div>

            {error ? (
              <p className="rounded-soft border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-danger" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              className="btn-primary w-full justify-center"
              onClick={() => void submit()}
              disabled={busy || !file}
            >
              {busy ? <Spinner className="!h-4 !w-4" /> : <Upload size={15} />}
              {busy ? 'در حال خواندن فایل…' : 'ورود رمزها از فایل'}
            </button>

            {result ? (
              <div className="space-y-2 rounded-card border border-ink-200 bg-surface p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="emerald">
                    <span className="inline-flex items-center gap-1">
                      <Check size={11} />
                      {faDigits(result.created)} افزوده شد
                    </span>
                  </Badge>
                  <Badge tone="ink">{faDigits(result.skipped)} تکراری/ردشده</Badge>
                  {result.failed ? <Badge tone="red">{faDigits(result.failed)} خطا</Badge> : null}
                  <span className="num ms-auto text-[10.5px] text-ink-400">
                    {faDigits(result.total)} ردیف در فایل
                  </span>
                </div>
                {result.errors.length ? (
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-soft bg-ink-50/70 p-2">
                    {result.errors.slice(0, 12).map((item, index) => (
                      <p key={`${item.row ?? 'x'}-${index}`} className="text-[10.5px] leading-4 text-ink-500">
                        {item.row ? `ردیف ${faDigits(item.row)}: ` : ''}
                        {item.label ? `«${item.label}» — ` : ''}
                        {item.issues.join('، ')}
                      </p>
                    ))}
                    {result.errors.length > 12 ? (
                      <p className="text-[10px] text-ink-400">و {faDigits(result.errors.length - 12)} خطای دیگر…</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-soft border border-sun-200 bg-sun-50/70 px-3 py-2.5 text-[11.5px] leading-5 text-ink-600">
              <p className="inline-flex items-center gap-1.5 font-medium text-warning">
                <ShieldAlert size={13} />
                فایل خروجی شامل رمزهای خام است
              </p>
              <p className="mt-1">
                فایل را در جای امن نگه دارید و پس از انتقال حذف کنید. گرفتن خروجی به مجوز «نمایش رمز» نیاز دارد و در
                گزارش حسابرسی ثبت می‌شود.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className="btn-primary justify-center"
                onClick={() => onExport('xlsx')}
                disabled={!canReveal}
                title={canReveal ? 'دریافت فایل Excel' : 'بدون مجوز نمایش رمز امکان‌پذیر نیست'}
              >
                <FileSpreadsheet size={15} />
                خروجی Excel
              </button>
              <button
                type="button"
                className="btn-soft justify-center"
                onClick={() => onExport('csv')}
                disabled={!canReveal}
                title={canReveal ? 'دریافت فایل CSV' : 'بدون مجوز نمایش رمز امکان‌پذیر نیست'}
              >
                <Download size={15} />
                خروجی CSV
              </button>
            </div>

            {!canReveal ? (
              <p className="text-[11px] text-ink-400">
                برای خروجی گرفتن، حساب شما به مجوز «نمایش رمز» نیاز دارد. فهرست رمزها بدون این مجوز هم قابل مشاهده است.
              </p>
            ) : null}

            <p className="text-[10.5px] leading-5 text-ink-400">
              ستون‌های فایل: {IMPORT_COLUMNS}. همین فایل دوباره از بخش «ورود از فایل» قابل وارد کردن است؛ ردیف‌هایی که
              عنوانشان موجود باشد نادیده گرفته می‌شوند.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
