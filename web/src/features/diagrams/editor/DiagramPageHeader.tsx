import {
  CheckCircle2,
  Eye,
  FileText,
  Image as ImageIcon,
  Info,
  PanelLeftOpen,
  Pencil,
  RefreshCw,
  Save,
  Workflow,
} from 'lucide-react';
import { faDigits } from '../../../lib/format';
import type { DiagramExportFormat } from '../DiagramCanvas';
import type { Mode } from './types';

export interface DiagramPageHeaderProps {
  detail: { name: string } | null;
  nodeCount: number;
  edgeCount: number;
  dirty: boolean;
  editing: boolean;
  mode: Mode;
  canWrite: boolean;
  panelOpen: boolean;
  titleBlock: boolean;
  exporting: DiagramExportFormat | null;
  autoSave: boolean;
  saving: boolean;
  onOpenPanel: () => void;
  onMode: (mode: Mode) => void;
  onOverview: () => void;
  onToggleTitleBlock: () => void;
  onExport: (format: DiagramExportFormat) => void;
  onReload: () => void;
  onToggleAutoSave: () => void;
  onSave: () => void;
}

/** نوار بالای صفحهٔ دیاگرام؛ فقط نمایش و رویدادها، بدون state دامنه. */
export function DiagramPageHeader({
  detail,
  nodeCount,
  edgeCount,
  dirty,
  editing,
  mode,
  canWrite,
  panelOpen,
  titleBlock,
  exporting,
  autoSave,
  saving,
  onOpenPanel,
  onMode,
  onOverview,
  onToggleTitleBlock,
  onExport,
  onReload,
  onToggleAutoSave,
  onSave,
}: DiagramPageHeaderProps) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
      {!panelOpen ? (
        <button
          type="button"
          className="btn-ghost btn-xs"
          onClick={onOpenPanel}
          title="باز کردن پنل کناری"
          aria-label="باز کردن پنل کناری"
          aria-expanded={false}
        >
          <PanelLeftOpen size={15} />
        </button>
      ) : null}

      <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-accent">
        <Workflow size={15} />
      </span>
      <div className="min-w-0">
        <h2 className="truncate text-[13.5px] font-semibold text-ink-800">{detail?.name ?? 'دیاگرام شبکه'}</h2>
        <p className="text-[10px] text-ink-400">
          {detail ? `${faDigits(nodeCount)} جزء · ${faDigits(edgeCount)} ارتباط` : 'دیاگرام مستقل با بوم اختصاصی'}
          {dirty ? ' · تغییرات ذخیره‌نشده' : ''}
          {!dirty && detail && editing ? ' · ذخیره‌شده' : ''}
        </p>
      </div>

      <div className="ms-auto flex items-center gap-1">
        {canWrite ? (
          <div
            className="flex items-center rounded-pill border border-ink-200 bg-surface/80 p-0.5"
            role="group"
            aria-label="حالت نمایش"
          >
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-pill px-2 py-1 text-[11px] font-medium transition ${
                mode === 'view' ? 'bg-surface text-accent shadow-soft' : 'text-ink-500'
              }`}
              onClick={() => onMode('view')}
              aria-pressed={mode === 'view'}
            >
              <Eye size={12} />
              نمایش
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-pill px-2 py-1 text-[11px] font-medium transition ${
                mode === 'edit' ? 'bg-surface text-accent shadow-soft' : 'text-ink-500'
              }`}
              onClick={() => onMode('edit')}
              aria-pressed={mode === 'edit'}
            >
              <Pencil size={12} />
              ویرایش
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className="btn-ghost btn-xs"
          onClick={onOverview}
          title="نمایش نقشهٔ ارتباط بین همهٔ دیاگرام‌ها"
        >
          <Workflow size={14} />
          <span className="hidden lg:inline">نقشهٔ ارتباط</span>
        </button>
        <button
          type="button"
          className={`btn-ghost btn-xs ${titleBlock ? '!border-brand-300 !bg-brand-50 !text-accent' : ''}`}
          onClick={onToggleTitleBlock}
          aria-pressed={titleBlock}
          title="درج کادر عنوان و متادیتا در تصویر و PDF"
        >
          <Info size={14} />
          <span className="hidden lg:inline">کادر عنوان</span>
        </button>
        <button
          type="button"
          className="btn-ghost btn-xs"
          onClick={() => onExport('png')}
          disabled={!detail || !nodeCount || exporting !== null}
          title="دانلود تصویر PNG از دیاگرام"
          aria-label="خروجی تصویر"
        >
          <ImageIcon size={14} />
          <span className="hidden md:inline">{exporting === 'png' ? 'در حال ساخت…' : 'تصویر'}</span>
        </button>
        <button
          type="button"
          className="btn-ghost btn-xs"
          onClick={() => onExport('pdf')}
          disabled={!detail || !nodeCount || exporting !== null}
          title="دانلود خروجی PDF از دیاگرام"
          aria-label="خروجی PDF"
        >
          <FileText size={14} />
          <span className="hidden md:inline">{exporting === 'pdf' ? 'در حال ساخت…' : 'PDF'}</span>
        </button>
        <button
          type="button"
          className="btn-ghost btn-xs"
          onClick={onReload}
          disabled={!detail}
          title="بازخوانی دیاگرام"
        >
          <RefreshCw size={14} />
        </button>
        {editing ? (
          <>
            <button
              type="button"
              className={`btn-ghost btn-xs ${autoSave ? '!text-success' : ''}`}
              onClick={onToggleAutoSave}
              aria-pressed={autoSave}
              title={autoSave ? 'ذخیرهٔ خودکار روشن است' : 'ذخیرهٔ خودکار خاموش است'}
            >
              <CheckCircle2 size={14} />
              <span className="hidden lg:inline">{autoSave ? 'ذخیرهٔ خودکار' : 'ذخیرهٔ دستی'}</span>
            </button>
            <button type="button" className="btn-primary btn-xs" onClick={onSave} disabled={saving || !dirty}>
              <Save size={14} />
              {saving ? 'در حال ذخیره…' : 'ذخیره'}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
