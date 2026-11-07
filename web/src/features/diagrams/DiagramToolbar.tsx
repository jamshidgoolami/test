/**
 * نوار ابزار بوم — سه گروه روشن تا ابزار پرکاربرد در یک نگاه پیدا شود.
 *
 * گروه «افزودن»: تجهیز (از فهرست انواع)، گروه، یادداشت، تصویر، شکل و پیوند
 * دیاگرام. گروه «ویرایش»: انتخاب/اتصال، نوع ارتباط، واگرد/ازنو، تکثیر، حذف،
 * شبکه و همگام‌سازی. گروه «نما»: چیدمان خودکار، زوم/فیت، نمایش IP و اطلاعات
 * اتصال، فیلتر وضعیت، جست‌وجو و ذخیره.
 *
 * ردیف دوم فقط با انتخاب ظاهر می‌شود: تراز/توزیع، قفل موقعیت، رنگ گروهی و
 * کپی/چسباندن. همهٔ دکمه‌ها Tooltip و aria-label دارند و در صفحه‌های کوچک
 * برچسب متنی کنار آیکون پنهان می‌شود تا نوار روی بوم جا شود.
 */
import React, { useState } from 'react';
import {
  Activity,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ChevronDown,
  Circle,
  ClipboardPaste,
  Columns3,
  Copy,
  Eye,
  EyeOff,
  Frame,
  Grid3x3,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  Lock,
  Maximize2,
  MousePointer2,
  Plus,
  Redo2,
  RefreshCw,
  Rows3,
  Save,
  Search,
  Square,
  StickyNote,
  Trash,
  Undo2,
  Unlock,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { CONNECTION_TYPES, DEVICE_CATALOG, connectionType } from '../../lib/diagrams';
import type { AlignMode, DiagramStatusFilter } from '../../lib/diagrams';
import type { AutoLayoutMode } from '../../lib/diagram-layout';
import type { DiagramConnectionKind, DiagramShape, DiagramSummary } from '../../lib/types';
import { faDigits } from '../../lib/format';
import { DeviceGlyph } from './DeviceGlyph';
import { ColorPickerPopover } from '../../components/ColorField';

export type CanvasTool = 'select' | 'connect';
export type PendingTool =
  | { kind: 'device'; deviceKey: string; deviceId?: number; label?: string; model?: string }
  | { kind: 'shape'; shape: DiagramShape }
  | { kind: 'image'; src: string; attachmentId: number }
  | { kind: 'diagram'; diagramId: number; label: string; description?: string }
  | { kind: 'note' }
  | { kind: 'group' }
  | null;

export interface DiagramToolbarProps {
  tool: CanvasTool;
  pending: PendingTool;
  connectionKind: DiagramConnectionKind;
  selectedColor: string | null;
  hasSelection: boolean;
  selectedCount: number;
  canUndo: boolean;
  canRedo: boolean;
  snapToGrid: boolean;
  clipboardCount: number;
  onSelectTool: () => void;
  onConnectTool: () => void;
  onPickDevice: (key: string) => void;
  onPickShape: (shape: DiagramShape) => void;
  onPickNote: () => void;
  onPickGroup: () => void;
  onPickImage: () => void;
  /** فهرست دیاگرام‌ها برای ساخت پیوند بین فایل‌ها */
  diagrams?: DiagramSummary[];
  onPickDiagram?: (diagram: { id: number; name: string; description?: string }) => void;
  onConnectionKind: (kind: DiagramConnectionKind) => void;
  onColor: (color: string) => void;
  onGroupColor: (color: string) => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleSnap: () => void;
  onSyncDevices: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: 'x' | 'y') => void;
  syncing?: boolean;
  /** چیدمان خودکار: سلسله‌مراتبی، افقی یا گروه‌بندی */
  layoutMode: AutoLayoutMode;
  onAutoLayout: (mode: AutoLayoutMode) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  showIp: boolean;
  onToggleIp: () => void;
  showConnectionInfo: boolean;
  onToggleConnectionInfo: () => void;
  statusFilter: DiagramStatusFilter;
  onStatusFilter: (filter: DiagramStatusFilter) => void;
  searchQuery: string;
  onSearchQuery: (query: string) => void;
  searchMatches?: number;
  lockedSelected: boolean;
  onToggleLock: () => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}

function ToolButton({
  active,
  onClick,
  icon,
  label,
  title,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      aria-pressed={!!active}
      disabled={disabled}
      className={`btn-ghost btn-xs ${active ? '!border-brand-300 !bg-brand-50 !text-accent' : ''}`}
    >
      {icon}
      <span className="hidden whitespace-nowrap sm:inline">{label}</span>
    </button>
  );
}

function IconButton({
  onClick,
  icon,
  title,
  disabled,
  active,
  danger,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      className={`grid h-7 w-7 place-items-center rounded-lg border border-transparent text-ink-500 transition hover:border-ink-200 hover:bg-surface hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? '!border-brand-300 !bg-brand-50 !text-accent' : ''
      } ${danger ? 'hover:!text-danger' : ''}`}
    >
      {icon}
    </button>
  );
}

function ToolGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex min-w-0 flex-wrap items-center gap-0.5 rounded-lg border border-ink-100/80 bg-ink-50/50 p-0.5"
    >
      <span className="hidden select-none px-1 text-[9px] font-semibold text-ink-400 xl:inline">{label}</span>
      {children}
    </div>
  );
}

/** نمونهٔ خط هر نوع ارتباط؛ رنگ و الگوی خط را پیش از انتخاب نشان می‌دهد. */
function LineSample({ kind }: { kind: DiagramConnectionKind }) {
  const meta = connectionType(kind);
  return (
    <svg width="24" height="8" viewBox="0 0 24 8" aria-hidden className="shrink-0">
      <line
        x1="1"
        y1="4"
        x2="23"
        y2="4"
        stroke={meta.color}
        strokeWidth={Math.min(4, meta.width)}
        strokeDasharray={meta.dash || undefined}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * انتخاب نوع ارتباط: فهرست کوچک و همیشه در دسترس. برخلاف <select>، حالت
 * رسم اتصال را نمی‌بندد و تغییر نوع بلافاصله روی ارتباط بعدی اعمال می‌شود.
 */
function ConnectionKindPicker({
  kind,
  onChange,
}: {
  kind: DiagramConnectionKind;
  onChange: (kind: DiagramConnectionKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = connectionType(kind);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="btn-ghost btn-xs"
        aria-label="نوع ارتباط"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`نوع ارتباط: ${active.label} — تغییر نوع، حالت رسم را فعال نگه می‌دارد`}
      >
        <LineSample kind={kind} />
        <span className="hidden whitespace-nowrap sm:inline">{active.label}</span>
        <ChevronDown size={11} />
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30 cursor-default"
            aria-label="بستن فهرست نوع ارتباط"
            onClick={() => setOpen(false)}
          />
          <div
            role="listbox"
            aria-label="نوع ارتباط"
            className="absolute end-0 top-full z-40 mt-1 w-44 rounded-xl border border-ink-200 bg-surface p-1 shadow-pop"
          >
            <p className="px-2 py-1 text-[10px] font-semibold text-ink-400">نوع ارتباط بعدی را انتخاب کنید</p>
            {CONNECTION_TYPES.map((type) => (
              <button
                key={type.kind}
                type="button"
                role="option"
                aria-selected={type.kind === kind}
                onClick={() => {
                  onChange(type.kind);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-right text-[11.5px] transition hover:bg-ink-50 ${
                  type.kind === kind ? 'bg-brand-50 text-accent' : 'text-ink-600'
                }`}
              >
                <LineSample kind={type.kind} />
                <span className="flex-1 truncate">{type.label}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

const ALIGN_BUTTONS: { mode: AlignMode; title: string; icon: React.ReactNode }[] = [
  { mode: 'left', title: 'تراز از لبهٔ راست (شروع)', icon: <AlignStartVertical size={13} /> },
  { mode: 'center-x', title: 'تراز افقی وسط', icon: <AlignCenterVertical size={13} /> },
  { mode: 'right', title: 'تراز از لبهٔ چپ (پایان)', icon: <AlignEndVertical size={13} /> },
  { mode: 'top', title: 'تراز از لبهٔ بالا', icon: <AlignStartHorizontal size={13} /> },
  { mode: 'center-y', title: 'تراز عمودی وسط', icon: <AlignCenterHorizontal size={13} /> },
  { mode: 'bottom', title: 'تراز از لبهٔ پایین', icon: <AlignEndHorizontal size={13} /> },
];

const LAYOUT_OPTIONS: { mode: AutoLayoutMode; label: string; hint: string; icon: React.ReactNode }[] = [
  { mode: 'hierarchical', label: 'سلسله‌مراتبی (عمودی)', hint: 'بالادست بالا، پایین‌دست در لایه‌های بعدی', icon: <Rows3 size={14} /> },
  { mode: 'horizontal', label: 'افقی', hint: 'جریان ارتباط از راست به چپ', icon: <Columns3 size={14} /> },
  { mode: 'grouped', label: 'گروه‌بندی', hint: 'هر گروه یک خوشهٔ جدا و مرتب', icon: <LayoutGrid size={14} /> },
];

export default function DiagramToolbar({
  tool,
  pending,
  connectionKind,
  selectedColor,
  hasSelection,
  selectedCount,
  canUndo,
  canRedo,
  snapToGrid,
  clipboardCount,
  onSelectTool,
  onConnectTool,
  onPickDevice,
  onPickShape,
  onPickNote,
  onPickGroup,
  onPickImage,
  diagrams = [],
  onPickDiagram,
  onConnectionKind,
  onColor,
  onGroupColor,
  onDelete,
  onUndo,
  onRedo,
  onToggleSnap,
  onSyncDevices,
  onCopy,
  onPaste,
  onDuplicate,
  onAlign,
  onDistribute,
  syncing,
  layoutMode,
  onAutoLayout,
  onZoomIn,
  onZoomOut,
  onFit,
  showIp,
  onToggleIp,
  showConnectionInfo,
  onToggleConnectionInfo,
  statusFilter,
  onStatusFilter,
  searchQuery,
  onSearchQuery,
  searchMatches,
  lockedSelected,
  onToggleLock,
  dirty,
  saving,
  onSave,
}: DiagramToolbarProps) {
  const [deviceMenu, setDeviceMenu] = useState(false);
  const [diagramMenu, setDiagramMenu] = useState(false);
  const [shapeMenu, setShapeMenu] = useState(false);
  const [layoutMenu, setLayoutMenu] = useState(false);
  const activeDevice = pending?.kind === 'device' ? pending.deviceKey : null;
  const multi = selectedCount >= 2;
  const activeLayout = LAYOUT_OPTIONS.find((option) => option.mode === layoutMode) ?? LAYOUT_OPTIONS[0];

  return (
    <div
      role="toolbar"
      aria-label="ابزارهای دیاگرام"
      className="relative z-30 flex flex-wrap items-center gap-1 rounded-xl border border-ink-200/70 bg-surface px-1.5 py-1 shadow-soft"
      dir="rtl"
    >
      <ToolGroup label="افزودن">
        <div className="relative">
          <button
            type="button"
            onClick={() => setDeviceMenu((v) => !v)}
            title="افزودن تجهیز (کلیک کنید، سپس روی بوم کلیک کنید)"
            className={`btn-ghost btn-xs ${pending?.kind === 'device' ? '!border-brand-300 !bg-brand-50 !text-accent' : ''}`}
            aria-expanded={deviceMenu}
          >
            <Plus size={13} />
            <span className="hidden whitespace-nowrap sm:inline">
              {activeDevice
                ? pending?.kind === 'device' && pending.label
                  ? pending.label
                  : DEVICE_CATALOG.find((d) => d.key === activeDevice)?.label
                : 'تجهیز'}
            </span>
            <ChevronDown size={11} />
          </button>
          {deviceMenu ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-30 cursor-default"
                aria-label="بستن فهرست تجهیزات"
                onClick={() => setDeviceMenu(false)}
              />
              <div className="absolute right-0 top-full z-40 mt-1 max-h-[60vh] w-56 overflow-y-auto rounded-xl border border-ink-200 bg-surface p-1 shadow-pop">
                <p className="px-2 py-1 text-[10px] font-semibold text-ink-400">
                  یک نوع تجهیز انتخاب کنید، سپس روی بوم کلیک کنید
                </p>
                {DEVICE_CATALOG.map((type) => (
                  <button
                    key={type.key}
                    type="button"
                    onClick={() => {
                      onPickDevice(type.key);
                      setDeviceMenu(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-right text-[11.5px] transition hover:bg-ink-50 ${
                      activeDevice === type.key ? 'bg-brand-50 text-accent' : 'text-ink-600'
                    }`}
                  >
                    <span
                      className="grid h-6 w-6 place-items-center rounded-md"
                      style={{ background: `${type.color}18`, color: type.color }}
                    >
                      <DeviceGlyph icon={type.icon} size={13} />
                    </span>
                    <span className="flex-1 truncate">{type.label}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <ToolButton
          active={pending?.kind === 'group'}
          onClick={onPickGroup}
          icon={<Frame size={13} />}
          label="گروه"
          title="افزودن کادر گروه برای دسته‌بندی تجهیزات"
        />
        <ToolButton
          active={pending?.kind === 'note'}
          onClick={onPickNote}
          icon={<StickyNote size={13} />}
          label="یادداشت"
          title="افزودن یادداشت"
        />
        <ToolButton
          onClick={onPickImage}
          icon={<ImageIcon size={13} />}
          label="تصویر"
          title="افزودن تصویر/لوگو (از پیوست‌های همین دیاگرام)"
        />

        <div className="relative">
          <button
            type="button"
            onClick={() => setShapeMenu((v) => !v)}
            title="افزودن شکل (مستطیل یا دایره)"
            aria-expanded={shapeMenu}
            className={`btn-ghost btn-xs ${pending?.kind === 'shape' ? '!border-brand-300 !bg-brand-50 !text-accent' : ''}`}
          >
            <Square size={13} />
            <span className="hidden whitespace-nowrap sm:inline">شکل</span>
            <ChevronDown size={11} />
          </button>
          {shapeMenu ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-30 cursor-default"
                aria-label="بستن فهرست شکل‌ها"
                onClick={() => setShapeMenu(false)}
              />
              <div className="absolute right-0 top-full z-40 mt-1 w-40 rounded-xl border border-ink-200 bg-surface p-1 shadow-pop">
                <button
                  type="button"
                  onClick={() => {
                    onPickShape('rect');
                    setShapeMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-right text-[11.5px] text-ink-600 transition hover:bg-ink-50"
                >
                  <Square size={13} /> مستطیل
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onPickShape('circle');
                    setShapeMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-right text-[11.5px] text-ink-600 transition hover:bg-ink-50"
                >
                  <Circle size={13} /> دایره
                </button>
              </div>
            </>
          ) : null}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setDiagramMenu((v) => !v)}
            title="افزودن پیوند به دیاگرام دیگر (برای نقشهٔ ارتباط)"
            aria-expanded={diagramMenu}
            className={`btn-ghost btn-xs ${pending?.kind === 'diagram' ? '!border-brand-300 !bg-brand-50 !text-accent' : ''}`}
            disabled={!onPickDiagram || diagrams.length === 0}
          >
            <Workflow size={13} />
            <span className="hidden whitespace-nowrap sm:inline">پیوند دیاگرام</span>
            <ChevronDown size={11} />
          </button>
          {diagramMenu ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-30 cursor-default"
                aria-label="بستن فهرست دیاگرام‌ها"
                onClick={() => setDiagramMenu(false)}
              />
              <div className="absolute right-0 top-full z-40 mt-1 max-h-[60vh] w-60 overflow-y-auto rounded-xl border border-ink-200 bg-surface p-1 shadow-pop">
                <p className="px-2 py-1 text-[10px] font-semibold text-ink-400">
                  دیاگرام مقصد را انتخاب کنید، سپس روی بوم کلیک کنید
                </p>
                {diagrams.length === 0 ? (
                  <p className="px-2 py-3 text-center text-[11px] text-ink-400">دیاگرام دیگری وجود ندارد</p>
                ) : (
                  diagrams.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        onPickDiagram?.({ id: d.id, name: d.name, description: d.description });
                        setDiagramMenu(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-right text-[11.5px] text-ink-600 transition hover:bg-ink-50"
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-50 text-accent">
                        <Workflow size={13} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{d.name}</span>
                        <span className="num block text-[9.5px] text-ink-400">{faDigits(d.nodeCount)} جزء</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : null}
        </div>
      </ToolGroup>

      <ToolGroup label="ویرایش">
        <ToolButton
          active={tool === 'select' && !pending}
          onClick={onSelectTool}
          icon={<MousePointer2 size={13} />}
          label="انتخاب"
          title="ابزار انتخاب و جابه‌جایی"
        />
        <ConnectionKindPicker kind={connectionKind} onChange={onConnectionKind} />
        <ToolButton
          active={tool === 'connect'}
          onClick={onConnectTool}
          icon={<Link2 size={13} />}
          label="اتصال"
          title="رسم ارتباط بین اجزا"
        />
        <span className="mx-0.5 h-5 w-px bg-ink-200" aria-hidden />
        <IconButton onClick={onUndo} icon={<Undo2 size={14} />} title="واگرد (Ctrl+Z)" disabled={!canUndo} />
        <IconButton onClick={onRedo} icon={<Redo2 size={14} />} title="ازنو (Ctrl+Y)" disabled={!canRedo} />
        <IconButton onClick={onDuplicate} icon={<Copy size={14} />} title="تکثیر انتخاب (Ctrl+D)" disabled={!hasSelection} />
        <IconButton
          onClick={onDelete}
          icon={<Trash size={14} />}
          title="حذف انتخاب (Delete)"
          disabled={!hasSelection}
          danger
        />
        <IconButton
          onClick={onToggleSnap}
          icon={<Grid3x3 size={14} />}
          title="چسبیدن اجزا به شبکهٔ ۱۰ پیکسلی"
          active={snapToGrid}
        />
        <ColorPickerPopover
          value={selectedColor ?? '#2563eb'}
          onChange={onColor}
          disabled={!selectedColor}
          title="تغییر رنگ انتخاب"
        >
          <span className="hidden whitespace-nowrap sm:inline">رنگ</span>
        </ColorPickerPopover>
        <IconButton
          onClick={onSyncDevices}
          icon={<RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />}
          title="همگام‌سازی نام/نوع/مدل/IP تجهیزات بوم با رکورد مانیتورینگ"
          disabled={syncing}
        />
      </ToolGroup>

      <ToolGroup label="نما">
        <div className="relative">
          <button
            type="button"
            onClick={() => setLayoutMenu((v) => !v)}
            title="چیدمان خودکار بر اساس ارتباط‌های ثبت‌شده"
            aria-expanded={layoutMenu}
            className="btn-ghost btn-xs"
          >
            {activeLayout.icon}
            <span className="hidden whitespace-nowrap md:inline">چیدمان</span>
            <ChevronDown size={11} />
          </button>
          {layoutMenu ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-30 cursor-default"
                aria-label="بستن فهرست چیدمان"
                onClick={() => setLayoutMenu(false)}
              />
              <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-xl border border-ink-200 bg-surface p-1 shadow-pop">
                <p className="px-2 py-1 text-[10px] font-semibold text-ink-400">
                  گره‌های قفل‌شده جابه‌جا نمی‌شوند؛ اجرای مجدد در واگرد قابل بازگشت است
                </p>
                {LAYOUT_OPTIONS.map((option) => (
                  <button
                    key={option.mode}
                    type="button"
                    onClick={() => {
                      onAutoLayout(option.mode);
                      setLayoutMenu(false);
                    }}
                    className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-right transition hover:bg-ink-50 ${
                      layoutMode === option.mode ? 'bg-brand-50 text-accent' : 'text-ink-600'
                    }`}
                  >
                    <span className="mt-0.5">{option.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11.5px] font-medium">{option.label}</span>
                      <span className="block text-[9.5px] text-ink-400">{option.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <IconButton onClick={onZoomOut} icon={<ZoomOut size={14} />} title="کوچک‌نمایی" />
        <IconButton onClick={onZoomIn} icon={<ZoomIn size={14} />} title="بزرگ‌نمایی" />
        <IconButton onClick={onFit} icon={<Maximize2 size={14} />} title="نمایش کل بوم (Fit to Screen)" />
        <span className="mx-0.5 h-5 w-px bg-ink-200" aria-hidden />
        <IconButton
          onClick={onToggleIp}
          icon={showIp ? <Eye size={14} /> : <EyeOff size={14} />}
          title={showIp ? 'مخفی کردن IP روی گره‌ها' : 'نمایش IP روی گره‌ها'}
          active={showIp}
        />
        <IconButton
          onClick={onToggleConnectionInfo}
          icon={<Activity size={14} />}
          title={showConnectionInfo ? 'مخفی کردن تأخیر/افت/تعداد ارتباط' : 'نمایش تأخیر/افت/تعداد ارتباط'}
          active={showConnectionInfo}
        />
        <select
          className="field !w-auto !min-w-[92px] !py-1 text-[10px]"
          value={statusFilter}
          onChange={(event) => onStatusFilter(event.target.value as DiagramStatusFilter)}
          title="فیلتر گره‌ها بر اساس وضعیت واقعی تجهیزات"
          aria-label="فیلتر وضعیت تجهیزات"
        >
          <option value="all">همه وضعیت‌ها</option>
          <option value="online">آنلاین</option>
          <option value="warning">هشدار</option>
          <option value="offline">قطع</option>
        </select>
        <div className="relative min-w-[112px] flex-1 sm:max-w-[180px]">
          <Search size={12} className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            className="field !py-1 pe-6 text-[10.5px]"
            value={searchQuery}
            onChange={(event) => onSearchQuery(event.target.value)}
            placeholder="جست‌وجوی تجهیز…"
            aria-label="جست‌وجوی تجهیز روی بوم"
            title="جست‌وجو در نام، IP و مدل تجهیزات بوم"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchQuery('')}
              className="absolute end-1 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded text-ink-400 hover:text-ink-700"
              title="پاک کردن جست‌وجو"
              aria-label="پاک کردن جست‌وجو"
            >
              <X size={11} />
            </button>
          ) : null}
          {searchMatches !== undefined && searchQuery ? (
            <span className="pointer-events-none absolute -bottom-4 end-0 text-[9px] text-ink-400">
              {faDigits(searchMatches)} نتیجه
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className={`btn-primary btn-xs ${!dirty ? '!bg-ink-100 !text-ink-500 !shadow-none' : ''}`}
          onClick={onSave}
          disabled={!dirty || saving}
          title={dirty ? 'ذخیرهٔ تغییرات (Ctrl+S)' : 'همهٔ تغییرات ذخیره شده است'}
        >
          <Save size={13} />
          <span className="hidden whitespace-nowrap sm:inline">{saving ? 'در حال ذخیره…' : dirty ? 'ذخیره' : 'ذخیره‌شده'}</span>
        </button>
      </ToolGroup>

      {hasSelection || clipboardCount ? (
        <div className="mt-1 flex w-full flex-wrap items-center gap-1 border-t border-ink-100 pt-1">
          <span className="num rounded-pill bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-accent">
            {faDigits(selectedCount)} انتخاب
          </span>
          {multi ? (
            <>
              {ALIGN_BUTTONS.map((item) => (
                <IconButton key={item.mode} onClick={() => onAlign(item.mode)} icon={item.icon} title={item.title} />
              ))}
              <span className="mx-0.5 h-4 w-px bg-ink-200" aria-hidden />
              <button
                type="button"
                className="btn-ghost btn-xs"
                onClick={() => onDistribute('x')}
                title="توزیع یکنواخت افقی"
                disabled={selectedCount < 3}
              >
                <span className="whitespace-nowrap">توزیع افقی</span>
              </button>
              <button
                type="button"
                className="btn-ghost btn-xs"
                onClick={() => onDistribute('y')}
                title="توزیع یکنواخت عمودی"
                disabled={selectedCount < 3}
              >
                <span className="whitespace-nowrap">توزیع عمودی</span>
              </button>
              <ColorPickerPopover value="#2563eb" onChange={onGroupColor} title="رنگ همهٔ انتخاب‌ها">
                رنگ گروهی
              </ColorPickerPopover>
              <span className="mx-0.5 h-4 w-px bg-ink-200" aria-hidden />
            </>
          ) : null}
          <button
            type="button"
            className={`btn-ghost btn-xs ${lockedSelected ? '!border-brand-300 !bg-brand-50 !text-accent' : ''}`}
            onClick={onToggleLock}
            title={lockedSelected ? 'باز کردن قفل موقعیت انتخاب' : 'قفل کردن موقعیت انتخاب'}
            aria-pressed={lockedSelected}
          >
            {lockedSelected ? <Unlock size={13} /> : <Lock size={13} />}
            <span className="whitespace-nowrap">{lockedSelected ? 'باز کردن قفل' : 'قفل موقعیت'}</span>
          </button>
          <button type="button" className="btn-ghost btn-xs" onClick={onCopy} title="کپی (Ctrl+C)" disabled={!hasSelection}>
            <Copy size={13} />
            <span className="whitespace-nowrap">کپی</span>
          </button>
          <button
            type="button"
            className="btn-ghost btn-xs"
            onClick={onPaste}
            disabled={!clipboardCount}
            title="چسباندن (Ctrl+V)"
          >
            <ClipboardPaste size={13} />
            <span className="whitespace-nowrap">چسباندن</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
