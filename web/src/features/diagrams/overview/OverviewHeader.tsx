import { Eye, GitBranch, Pencil, RefreshCw, Search, X } from 'lucide-react';

import { faDigits } from '../../../lib/format';
import type { DiagramGraphStats } from '../../../lib/types';

export function OverviewHeader({
  stats,
  itemCount,
  query,
  onQuery,
  needle,
  matchCount,
  onFocusMatches,
  mode,
  onMode,
  canWrite,
  onRefresh,
  loading,
  onClose,
}: {
  stats?: DiagramGraphStats;
  itemCount: number;
  query: string;
  onQuery: (value: string) => void;
  needle: string;
  matchCount: number;
  onFocusMatches: () => void;
  mode: 'view' | 'edit';
  onMode: (mode: 'view' | 'edit') => void;
  canWrite: boolean;
  onRefresh: () => void;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-50 text-accent">
        <GitBranch size={16} />
      </span>
      <div className="min-w-0">
        <h2 className="text-[13.5px] font-semibold text-ink-800">نقشهٔ ارتباط دیاگرام‌ها</h2>
        <p className="num text-[10px] text-ink-400">
          {faDigits(stats?.diagrams ?? itemCount)} دیاگرام · {faDigits(stats?.links ?? 0)} پیوند ·{' '}
          {faDigits(stats?.children ?? 0)} زیرمجموعه · {faDigits(stats?.orphans ?? 0)} بدون ارتباط
        </p>
      </div>

      <div className="ms-auto flex flex-wrap items-center gap-1.5">
        <div className="relative">
          <Search
            size={12}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400"
          />
          <input
            className="field !w-[190px] !rounded-pill !py-1.5 pr-7 text-[11.5px]"
            placeholder="جست‌وجوی نام یا توضیح…"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            aria-label="جست‌وجوی دیاگرام در نقشهٔ ارتباط"
          />
        </div>
        {needle ? (
          <button
            type="button"
            className="btn-ghost btn-xs"
            onClick={onFocusMatches}
            disabled={!matchCount}
            title="نمایش فقط نتایج جست‌وجو روی بوم"
          >
            <span className="num text-[10px]">{faDigits(matchCount)} نتیجه</span>
          </button>
        ) : null}

        <div
          className="inline-flex items-center rounded-pill border border-ink-200 bg-surface p-0.5"
          role="group"
          aria-label="حالت نقشهٔ ارتباط"
        >
          <button
            type="button"
            className={`inline-flex items-center gap-1 rounded-pill px-2 py-1 text-[10.5px] font-medium transition ${
              mode === 'view' ? 'bg-brand-50 text-accent' : 'text-ink-500'
            }`}
            onClick={() => onMode('view')}
            aria-pressed={mode === 'view'}
            title="فقط مشاهده و کاوش؛ پیوند و جابه‌جایی غیرفعال است"
          >
            <Eye size={11} />
            نمایش
          </button>
          <button
            type="button"
            className={`inline-flex items-center gap-1 rounded-pill px-2 py-1 text-[10.5px] font-medium transition ${
              mode === 'edit' ? 'bg-brand-50 text-accent' : 'text-ink-500'
            }`}
            onClick={() => onMode('edit')}
            disabled={!canWrite}
            aria-pressed={mode === 'edit'}
            title={canWrite ? 'ویرایش چیدمان و پیوندها' : 'برای ویرایش، دسترسی لازم است'}
          >
            <Pencil size={11} />
            ویرایش
          </button>
        </div>

        <button
          type="button"
          className="btn-ghost btn-xs"
          onClick={onRefresh}
          disabled={loading}
          title="بازخوانی ارتباط‌ها"
          aria-label="بازخوانی ارتباط‌ها"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
        <button type="button" className="btn-ghost btn-xs" onClick={onClose} aria-label="بستن">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
