import {
  AlertTriangle,
  ChevronDown,
  Eye,
  EyeOff,
  GitBranch,
  Info,
  LayoutGrid,
  Link2,
  Maximize2,
  Minus,
  Move,
  Plus,
  RotateCcw,
} from 'lucide-react';

import { faDigits } from '../../../lib/format';
import { CONNECTION_TYPES, connectionType } from '../../../lib/diagrams';
import type { DiagramConnectionKind, DiagramGraphBrokenLink, DiagramGraphItem } from '../../../lib/types';

export function OverviewToolbar({
  items,
  broken,
  canEdit,
  linkKind,
  onLinkKind,
  connectMode,
  onToggleConnect,
  showCreate,
  onToggleCreate,
  autoLayout,
  onAutoLayout,
  onManualLayout,
  onResetLayout,
  treeOnly,
  onToggleTree,
  showEdgeLabels,
  onToggleEdgeLabels,
  legendOpen,
  onToggleLegend,
  brokenOpen,
  onToggleBroken,
  zoom,
  onZoomOut,
  onZoomIn,
  onFit,
}: {
  items: DiagramGraphItem[];
  broken: DiagramGraphBrokenLink[];
  canEdit: boolean;
  linkKind: DiagramConnectionKind;
  onLinkKind: (kind: DiagramConnectionKind) => void;
  connectMode: boolean;
  onToggleConnect: () => void;
  showCreate: boolean;
  onToggleCreate: () => void;
  autoLayout: boolean;
  onAutoLayout: () => void;
  onManualLayout: () => void;
  onResetLayout: () => void;
  treeOnly: boolean;
  onToggleTree: () => void;
  showEdgeLabels: boolean;
  onToggleEdgeLabels: () => void;
  legendOpen: boolean;
  onToggleLegend: () => void;
  brokenOpen: boolean;
  onToggleBroken: () => void;
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-ink-100 bg-ink-50/40 px-3 py-1.5 text-[10.5px] text-ink-500"
      dir="rtl"
    >
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0 w-5 border-t-2 border-dashed border-ink-400" aria-hidden />
        زیرمجموعه
      </span>
      <div className="relative">
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-pill border px-1.5 py-0.5 text-[10px] font-medium transition ${
            legendOpen
              ? 'border-brand-300 bg-brand-50 text-accent'
              : 'border-ink-200 bg-surface text-ink-500 hover:text-ink-700'
          }`}
          onClick={onToggleLegend}
          aria-expanded={legendOpen}
          aria-label="راهنمای نوع ارتباط‌ها"
        >
          <Info size={11} />
          راهنمای نوع‌ها
          <ChevronDown size={11} className={legendOpen ? 'rotate-180' : ''} />
        </button>
        {legendOpen ? (
          <div
            className="absolute right-0 top-full z-40 mt-1 w-56 rounded-soft border border-ink-200 bg-surface p-2 shadow-pop"
            dir="rtl"
            role="dialog"
            aria-label="نوع‌های ارتباط"
          >
            <p className="mb-1 px-1 text-[10px] font-semibold text-ink-500">نوع ارتباط</p>
            {CONNECTION_TYPES.map((type) => (
              <div
                key={type.kind}
                className="flex items-center gap-2 rounded-md px-1 py-1 text-[10.5px] text-ink-600"
              >
                <span
                  aria-hidden
                  className="w-7 shrink-0"
                  style={
                    type.dash
                      ? { borderTop: `2px dashed ${type.color}` }
                      : { height: 3, background: type.color, borderRadius: 2 }
                  }
                />
                <span className="flex-1">{type.label}</span>
              </div>
            ))}
            <div className="mt-1 flex items-center gap-2 border-t border-ink-100 px-1 pt-1.5 text-[10px] text-ink-500">
              <span className="w-7 shrink-0 border-t-2 border-dashed border-ink-400" aria-hidden />
              زیرمجموعه
            </div>
          </div>
        ) : null}
      </div>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full border-2 border-brand-500 bg-brand-100" aria-hidden />
        دیاگرام جاری
      </span>
      {broken.length ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-pill border border-sun-200 bg-sun-50 px-1.5 py-0.5 text-[10px] font-medium text-warning"
          onClick={onToggleBroken}
          aria-expanded={brokenOpen}
          title="پیوندهای شکسته را ببینید و پاک کنید"
        >
          <AlertTriangle size={11} />
          {faDigits(broken.length)} پیوند شکسته
          <ChevronDown size={11} className={brokenOpen ? 'rotate-180' : ''} />
        </button>
      ) : null}

      <span className="mx-0.5 h-4 w-px bg-ink-200" aria-hidden />

      {canEdit ? (
        <>
          <label className="inline-flex items-center gap-1 rounded-pill border border-ink-200 bg-surface px-1.5 py-0.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: connectionType(linkKind).color }}
              aria-hidden
            />
            <span className="text-[9.5px] text-ink-400">نوع اتصال</span>
            <select
              className="max-w-[120px] bg-transparent text-[10.5px] font-medium text-ink-700 outline-none"
              value={linkKind}
              onChange={(event) => onLinkKind(event.target.value as DiagramConnectionKind)}
              aria-label="نوع ارتباط پیوند جدید"
            >
              {CONNECTION_TYPES.map((type) => (
                <option key={type.kind} value={type.kind}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`btn-ghost btn-xs ${connectMode ? '!border-brand-300 !bg-brand-50 !text-accent' : ''}`}
            onClick={onToggleConnect}
            disabled={items.length < 2}
            aria-pressed={connectMode}
            title="حالت اتصال کلیک‌به‌کلیک: اول مبدأ، بعد مقصد"
          >
            <Link2 size={12} />
            حالت اتصال
          </button>
          <button
            type="button"
            className={`btn-ghost btn-xs ${showCreate ? '!border-brand-300 !bg-brand-50 !text-accent' : ''}`}
            onClick={onToggleCreate}
            disabled={items.length < 2}
            aria-expanded={showCreate}
            title="ساخت پیوند با انتخاب مبدأ و مقصد"
          >
            <Link2 size={12} />
            پیوند تازه
          </button>
          <span className="mx-0.5 h-4 w-px bg-ink-200" aria-hidden />
          <span className="flex items-center gap-0.5 rounded-pill bg-surface p-0.5">
            <button
              type="button"
              className={`btn-ghost btn-xs ${autoLayout ? '!border-brand-300 !text-accent shadow-soft' : ''}`}
              onClick={onAutoLayout}
              title="چیدمان خودکار بر اساس ساختار درخت و جهت پیوندها"
              aria-pressed={autoLayout}
            >
              <LayoutGrid size={12} />
              خودکار
            </button>
            <button
              type="button"
              className={`btn-ghost btn-xs ${!autoLayout ? '!border-sky-300 !text-info shadow-soft' : ''}`}
              onClick={onManualLayout}
              title="چیدمان آزاد: کارت‌ها را با کشیدن جابه‌جا کنید"
              aria-pressed={!autoLayout}
            >
              <Move size={12} />
              آزاد
            </button>
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={onResetLayout}
              title="بازگشت به چیدمان خودکار و پاک کردن جابه‌جایی‌ها"
              aria-label="بازنشانی چیدمان"
            >
              <RotateCcw size={12} />
            </button>
          </span>
        </>
      ) : null}

      <button
        type="button"
        className={`btn-ghost btn-xs ${treeOnly ? '!border-brand-300 !bg-brand-50 !text-accent' : ''}`}
        onClick={onToggleTree}
        aria-pressed={treeOnly}
        title="فقط ساختار درختی؛ پیوندهای دستی پنهان می‌شوند"
      >
        <GitBranch size={11} />
        فقط درخت
      </button>
      <button
        type="button"
        className={`btn-ghost btn-xs ${showEdgeLabels ? '' : '!text-ink-400'}`}
        onClick={onToggleEdgeLabels}
        aria-pressed={showEdgeLabels}
        title="نمایش یا پنهان‌کردن برچسب ارتباط‌ها"
      >
        {showEdgeLabels ? <Eye size={11} /> : <EyeOff size={11} />}
        برچسب‌ها
      </button>

      <span className="ms-auto flex items-center gap-1">
        <button
          type="button"
          className="btn-ghost btn-xs"
          onClick={onZoomOut}
          title="کوچک‌نمایی"
          aria-label="کوچک‌نمایی"
        >
          <Minus size={12} />
        </button>
        <span className="num w-9 text-center text-[10px] text-ink-400">{faDigits(Math.round(zoom * 100))}٪</span>
        <button
          type="button"
          className="btn-ghost btn-xs"
          onClick={onZoomIn}
          title="بزرگ‌نمایی"
          aria-label="بزرگ‌نمایی"
        >
          <Plus size={12} />
        </button>
        <button type="button" className="btn-ghost btn-xs" onClick={onFit} title="جا دادن همهٔ کارت‌ها در کادر">
          <Maximize2 size={12} />
          جا دادن
        </button>
      </span>
    </div>
  );
}
