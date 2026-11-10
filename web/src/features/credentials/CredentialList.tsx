import React from 'react';
import {
  Cable,
  Check,
  Copy,
  Database,
  Globe,
  KeyRound,
  Mail,
  Pencil,
  Search,
  Server,
  ShieldAlert,
  Terminal,
  TriangleAlert,
  Wifi,
  X,
} from 'lucide-react';
import { Card, EmptyState, ErrorState, Pagination, Spinner } from '../../components/ui';
import { strengthMeta } from '../../lib/credential-rules';
import { faDigits } from '../../lib/format';
import type { Credential, CredentialCheckupItem, CredentialKind } from '../../lib/types';

const KIND_ICON: Record<CredentialKind, React.ReactNode> = {
  ssh: <Terminal size={15} />,
  https: <Globe size={15} />,
  telnet: <Terminal size={15} />,
  snmp: <Server size={15} />,
  console: <Cable size={15} />,
  wifi: <Wifi size={15} />,
  api: <KeyRound size={15} />,
  database: <Database size={15} />,
  mail: <Mail size={15} />,
  other: <KeyRound size={15} />,
};

/** رنگ نماد ورودی از شناسه گرفته می‌شود تا پایدار و بدون تصویر بیرونی باشد. */
function avatarColor(id: number): string {
  const hue = (id * 47) % 360;
  return `hsl(${hue} 58% 42%)`;
}

function initialOf(label: string): string {
  const trimmed = String(label ?? '').trim();
  return trimmed ? [...trimmed][0] : '?';
}

/**
 * فهرست خزانه — شبیه فهرست ورودهای Password Manager:
 * جست‌وجو در بالا، ردیف‌های فشرده با نماد، نام کاربری و نشان قدرت.
 * نمایش رمز فقط از پنل جزئیات و با مسیر صریح reveal انجام می‌شود.
 */
export default function CredentialList({
  items,
  total,
  pages,
  page,
  pageSize,
  loading,
  error,
  issues,
  selectedId,
  canWrite,
  searchInput,
  onSearchChange,
  onClearSearch,
  onSelect,
  onEdit,
  onCopyUsername,
  onRetry,
  onPage,
}: {
  items: Credential[];
  total: number;
  pages: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  issues: Map<number, CredentialCheckupItem>;
  selectedId: number | null;
  canWrite: boolean;
  searchInput: string;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;
  onSelect: (credential: Credential) => void;
  onEdit: (credential: Credential) => void;
  onCopyUsername: (credential: Credential) => void;
  onRetry: () => void;
  onPage: (page: number) => void;
}) {
  const [copiedId, setCopiedId] = React.useState<number | null>(null);

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="border-b border-ink-100 p-3">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            className="field !pr-9"
            value={searchInput}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="جست‌وجوی عنوان، نام کاربری، میزبان یا تجهیز…"
            aria-label="جست‌وجوی رمز عبور"
          />
          {searchInput ? (
            <button
              type="button"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-ink-400 hover:bg-ink-100"
              onClick={onClearSearch}
              aria-label="پاک‌کردن جست‌وجو"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink-400">
          <span>
            {loading && !items.length ? 'در حال خواندن خزانه…' : `${faDigits(total)} رمز ذخیره‌شده`}
          </span>
          {issues.size ? (
            <span className="inline-flex items-center gap-1 font-medium text-warning">
              <ShieldAlert size={12} />
              {faDigits(issues.size)} نیازمند بررسی
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-success">
              <Check size={12} />
              بدون هشدار امنیتی
            </span>
          )}
        </div>
      </div>

      {loading && !items.length ? (
        <div className="flex items-center justify-center gap-2 py-14 text-[12px] text-ink-400">
          <Spinner /> در حال بارگذاری رمزها…
        </div>
      ) : error ? (
        <div className="p-4">
          <ErrorState message={error} onRetry={onRetry} />
        </div>
      ) : !items.length ? (
        <div className="p-4">
          <EmptyState
            icon={<KeyRound size={22} />}
            title={searchInput ? 'رمزی با این جست‌وجو پیدا نشد' : 'هنوز رمزی ذخیره نشده است'}
            description={
              searchInput
                ? 'عبارت جست‌وجو را تغییر دهید یا فیلتر را پاک کنید.'
                : 'نام کاربری و رمز تجهیزات را اینجا ذخیره کنید تا همیشه در دسترس و رمزنگاری‌شده باشد.'
            }
          />
        </div>
      ) : (
        <div className="max-h-[560px] space-y-1 overflow-y-auto p-1.5" role="list" aria-label="فهرست رمزهای ذخیره‌شده">
          {items.map((credential) => {
            const issue = issues.get(credential.id);
            const selected = selectedId === credential.id;
            const strength = strengthMeta(credential.strength);
            return (
              <div
                key={credential.id}
                role="listitem"
                className={`group flex items-center gap-0.5 rounded-xl pe-1 transition ${
                  selected ? 'bg-brand-50/80 ring-1 ring-brand-200' : 'hover:bg-ink-50/80'
                }`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2.5 text-right"
                  onClick={() => onSelect(credential)}
                  aria-current={selected ? 'true' : undefined}
                >
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white shadow-soft"
                    style={{ background: avatarColor(credential.id) }}
                    aria-hidden
                  >
                    {initialOf(credential.label)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-ink-800">{credential.label}</span>
                      {issue?.issues.includes('breached') ? (
                        <ShieldAlert size={13} className="shrink-0 text-danger" aria-label="رمز افشاشده" />
                      ) : issue?.issues.includes('reused') ? (
                        <Copy size={12} className="shrink-0 text-warning" aria-label="رمز تکراری" />
                      ) : issue?.issues.includes('weak') ? (
                        <TriangleAlert size={12} className="shrink-0 text-warning" aria-label="رمز ضعیف" />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-400" dir="ltr">
                      {credential.username || credential.host || '—'}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-ink-300" aria-hidden>
                      {KIND_ICON[credential.kind] ?? KIND_ICON.other}
                    </span>
                    <span
                      className="h-1.5 w-8 rounded-pill"
                      style={{ background: strength.bar }}
                      title={`قدرت رمز: ${strength.label}`}
                    />
                  </span>
                </button>

                <button
                  type="button"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-300 transition hover:bg-ink-100 hover:text-ink-700"
                  onClick={() => {
                    onCopyUsername(credential);
                    setCopiedId(credential.id);
                    window.setTimeout(() => setCopiedId((value) => (value === credential.id ? null : value)), 1600);
                  }}
                  title="کپی نام کاربری"
                  aria-label={`کپی نام کاربری ${credential.label}`}
                  disabled={!credential.username}
                >
                  {copiedId === credential.id ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                </button>
                {canWrite ? (
                  <button
                    type="button"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-300 transition hover:bg-ink-100 hover:text-ink-700"
                    onClick={() => onEdit(credential)}
                    title="ویرایش"
                    aria-label={`ویرایش ${credential.label}`}
                  >
                    <Pencil size={13} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {pages > 1 ? (
        <div className="border-t border-ink-100 px-3">
          <Pagination page={page} pages={pages} total={total} pageSize={pageSize} onPage={onPage} />
        </div>
      ) : null}
    </Card>
  );
}
