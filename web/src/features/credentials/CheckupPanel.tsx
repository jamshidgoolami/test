import React, { useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  Copy,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Badge, Card, ErrorState, PageLoader, StatCard } from '../../components/ui';
import { faDigits, fmtRelative } from '../../lib/format';
import type { CredentialCheckup, CredentialCheckupItem, CredentialIssue } from '../../lib/types';

const ISSUE_META: Record<CredentialIssue, { label: string; tone: 'red' | 'sun' | 'violet'; icon: React.ReactNode }> = {
  breached: { label: 'افشاشده', tone: 'red', icon: <ShieldAlert size={11} /> },
  reused: { label: 'تکراری', tone: 'violet', icon: <Copy size={11} /> },
  weak: { label: 'ضعیف', tone: 'sun', icon: <TriangleAlert size={11} /> },
};

function IssueChip({ issue, count }: { issue: CredentialIssue; count: number }) {
  const meta = ISSUE_META[issue];
  return (
    <Badge tone={meta.tone} className="!px-1.5 !py-0 !text-[10px]">
      <span className="inline-flex items-center gap-1">
        {meta.icon}
        {meta.label}
        {issue === 'reused' && count > 1 ? ` ×${faDigits(count)}` : ''}
      </span>
    </Badge>
  );
}

/**
 * «بررسی امنیت رمزها» — معادل Password Checkup گوگل.
 *
 * سه دسته بررسی می‌شود: ضعیف، تکراری و افشاشده. تشخیص افشا با فهرست مرجع
 * محلی است (برنامه آفلاین است) و در همین متن هم شفاف گفته می‌شود.
 */
export default function CheckupPanel({
  data,
  loading,
  error,
  onRefresh,
  onOpen,
}: {
  data: CredentialCheckup | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpen: (id: number) => void;
}) {
  const [filter, setFilter] = useState<'all' | CredentialIssue>('all');

  const items = useMemo(() => {
    const list = data?.items ?? [];
    return filter === 'all' ? list : list.filter((item) => item.issues.includes(filter));
  }, [data, filter]);

  const totalIssues = data?.issues ?? 0;

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-accent">
              <ShieldCheck size={19} />
            </span>
            <div>
              <h3 className="text-[14px] font-semibold text-ink-800">بررسی امنیت رمزها</h3>
              <p className="mt-1 max-w-2xl text-[11.5px] leading-5 text-ink-500">
                رمزهای ضعیف، تکراری و افشاشده در یک نگاه مشخص می‌شوند. بررسی همیشه روی همین سرور و بدون ارسال
                رمزها به اینترنت انجام می‌شود؛ تشخیص «افشاشده» با فهرست مرجع محلی رمزهای لو‌رفته است.
              </p>
            </div>
          </div>
          <button type="button" className="btn-ghost btn-xs" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            بررسی دوباره
          </button>
        </div>
      </Card>

      {loading && !data ? (
        <Card>
          <PageLoader label="در حال بررسی امنیت رمزها…" />
        </Card>
      ) : error ? (
        <Card>
          <ErrorState message={error} onRetry={onRefresh} />
        </Card>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="سالم"
              value={faDigits(data.secure)}
              hint="بدون ایراد شناخته‌شده"
              icon={<ShieldCheck size={18} />}
              tone="emerald"
              onClick={() => setFilter('all')}
            />
            <StatCard
              label="ضعیف"
              value={faDigits(data.weak)}
              hint="کوتاه، پیش‌فرض یا قابل حدس"
              icon={<TriangleAlert size={18} />}
              tone={data.weak ? 'sun' : 'ink'}
              onClick={() => setFilter(filter === 'weak' ? 'all' : 'weak')}
            />
            <StatCard
              label="تکراری"
              value={faDigits(data.reused)}
              hint="در چند ورودی استفاده شده"
              icon={<Copy size={18} />}
              tone={data.reused ? 'violet' : 'ink'}
              onClick={() => setFilter(filter === 'reused' ? 'all' : 'reused')}
            />
            <StatCard
              label="افشاشده"
              value={faDigits(data.breached)}
              hint="در فهرست رمزهای لو‌رفته"
              icon={<ShieldAlert size={18} />}
              tone={data.breached ? 'red' : 'ink'}
              onClick={() => setFilter(filter === 'breached' ? 'all' : 'breached')}
            />
          </div>

          {data.unreadable ? (
            <p className="rounded-soft border border-sun-200 bg-sun-50/70 px-3 py-2 text-[11.5px] text-warning">
              {faDigits(data.unreadable)} ورودی با کلید فعلی قابل رمزگشایی نبود و در بررسی شرکت داده نشد.
            </p>
          ) : null}

          {!totalIssues ? (
            <Card className="border-emerald-200 bg-emerald-50/40">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-success">
                  <Check size={20} />
                </span>
                <div>
                  <h3 className="text-[13.5px] font-semibold text-ink-800">همهٔ رمزها سالم‌اند</h3>
                  <p className="mt-1 text-[11.5px] leading-5 text-ink-500">
                    در {faDigits(data.checked)} ورودی ذخیره‌شده، رمز ضعیف، تکراری یا افشاشده‌ای پیدا نشد. این بررسی
                    بر اساس داده‌های فعلی است؛ پس از هر تغییر دوباره اجرا می‌شود.
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            <Card padded={false} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11.5px] text-ink-500">
                    {faDigits(items.length)} مورد {filter === 'all' ? 'نیازمند بررسی' : `با ایراد «${ISSUE_META[filter].label}»`}
                  </span>
                </div>
                {filter !== 'all' ? (
                  <button type="button" className="btn-ghost btn-xs" onClick={() => setFilter('all')}>
                    نمایش همه
                  </button>
                ) : null}
              </div>

              <div className="space-y-1.5 p-2">
                {items.length === 0 ? (
                  <p className="px-2 py-6 text-center text-[11.5px] text-ink-400">در این دسته موردی نیست.</p>
                ) : (
                  items.map((item: CredentialCheckupItem) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onOpen(item.id)}
                      className="flex w-full items-center gap-3 rounded-xl border border-ink-100 bg-surface/70 px-3 py-2.5 text-right transition hover:border-brand-200 hover:bg-brand-50/30"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-ink-800">{item.label}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1">
                          {item.issues.map((issue) => (
                            <IssueChip key={issue} issue={issue} count={item.sharedWith} />
                          ))}
                          <span className="text-[10px] text-ink-400">
                            {item.kindLabel}
                            {item.deviceName ? ` · ${item.deviceName}` : ''}
                          </span>
                        </span>
                      </span>
                      <ChevronLeft size={15} className="shrink-0 text-ink-300" />
                    </button>
                  ))
                )}
              </div>
            </Card>
          )}

          <p className="px-1 text-[10.5px] leading-5 text-ink-400">
            این بررسی {faDigits(data.checked)} ورودی را سنجیده و آخرین بار {fmtRelative(data.generatedAt)} اجرا شده
            است. «افشاشده» یعنی رمز در فهرست مرجع رمزهای پرتکرار/لو‌رفته دیده شده؛ نبودن در فهرست تضمین امنیت کامل نیست.
          </p>
        </>
      ) : null}
    </div>
  );
}
