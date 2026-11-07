/**
 * نوار ابزار بوم — همهٔ ابزارهای رسم/ویرایش در یک ردیف کم‌حجم.
 * انتخاب تجهیز، گروه یا شکل، ابزار را «مسلح» می‌کند و کلیک بعدی روی بوم آن را
 * می‌افزاید؛ انتخاب نوع ارتباط هم ابزار اتصال را فعال نگه می‌دارد تا بتوان
 * بدون خروج از حالت رسم، نوع خط را عوض کرد.
 *
 * ردیف دوم فقط وقتی چند جزء انتخاب شده باشند ظاهر می‌شود: تراز، توزیع، رنگ
 * گروهی و تکثیر — تا نوار در حالت عادی شلوغ نشود.
 */
import React, { useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ChevronDown,
  Circle,
  Copy,
  Frame,
  Grid3x3,
  Image as ImageIcon,
  Link2,
  MousePointer2,
  Plus,
  Redo2,
  RefreshCw,
  Square,
  StickyNote,
  Trash,
  Undo2,
  Workflow,
} from 'lucide-react';
import { CONNECTION_TYPES, DEVICE_CATALOG, connectionType } from '../../lib/diagrams';
import type { AlignMode } from '../../lib/diagrams';
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
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

function IconButton({
  onClick,
  icon,
  title,
  disabled,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className="grid h-7 w-7 place-items-center rounded-lg border border-transparent text-ink-500 transition hover:border-ink-200 hover:bg-surface hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
    </button>
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
        <span className="whitespace-nowrap">{active.label}</span>
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
            <p className="px-2 py-1 text-[10px] font-semibold text-ink-400">
              نوع ارتباط بعدی را انتخاب کنید
            </p>
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
}: DiagramToolbarProps) {
  const [deviceMenu, setDeviceMenu] = useState(false);
  const [diagramMenu, setDiagramMenu] = useState(false);
  const activeDevice = pending?.kind === 'device' ? pending.deviceKey : null;
  const multi = selectedCount >= 2;

  return (
    <div
      role="toolbar"
      aria-label="ابزارهای دیاگرام"
      className="relative z-30 flex flex-wrap items-center gap-1 rounded-xl border border-ink-200/70 bg-surface px-1.5 py-1 shadow-soft"
      dir="rtl"
    >
      <IconButton onClick={onUndo} icon={<Undo2 size={14} />} title="واگرد (Ctrl+Z)" disabled={!canUndo} />
      <IconButton onClick={onRedo} icon={<Redo2 size={14} />} title="ازنو (Ctrl+Y)" disabled={!canRedo} />

      <span className="mx-0.5 h-5 w-px bg-ink-200" aria-hidden />

      <ToolButton
        active={tool === 'select' && !pending}
        onClick={onSelectTool}
        icon={<MousePointer2 size={13} />}
        label="انتخاب"
        title="ابزار انتخاب و جابه‌جایی"
      />

      <div className="relative">
        <button
          type="button"
          onClick={() => setDeviceMenu((v) => !v)}
          title="افزودن تجهیز"
          className={`btn-ghost btn-xs ${pending?.kind === 'device' ? '!border-brand-300 !bg-brand-50 !text-accent' : ''}`}
          aria-expanded={deviceMenu}
        >
          <Plus size={13} />
          <span className="whitespace-nowrap">
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
              <p className="px-2 py-1 text-[10px] font-semibold text-ink-400">یک تجهیز انتخاب کنید، سپس روی بوم کلیک کنید</p>
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
                  <span className="grid h-6 w-6 place-items-center rounded-md" style={{ background: `${type.color}18`, color: type.color }}>
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
        active={pending?.kind === 'shape' && pending.shape === 'rect'}
        onClick={() => onPickShape('rect')}
        icon={<Square size={13} />}
        label="مستطیل"
        title="افزودن مستطیل"
      />
      <ToolButton
        active={pending?.kind === 'shape' && pending.shape === 'circle'}
        onClick={() => onPickShape('circle')}
        icon={<Circle size={13} />}
        label="دایره"
        title="افزودن دایره"
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

      {/* پیوند بین فایل‌های دیاگرام: یک جزء روی بوم که مقصدش دیاگرام دیگری است */}
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
          <span className="whitespace-nowrap">پیوند دیاگرام</span>
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

      <span className="mx-0.5 h-5 w-px bg-ink-200" aria-hidden />

      <ConnectionKindPicker kind={connectionKind} onChange={onConnectionKind} />
      <ToolButton
        active={tool === 'connect'}
        onClick={onConnectTool}
        icon={<Link2 size={13} />}
        label="اتصال"
        title="رسم ارتباط بین اجزا"
      />

      <span className="mx-0.5 h-5 w-px bg-ink-200" aria-hidden />

      <ToolButton
        active={snapToGrid}
        onClick={onToggleSnap}
        icon={<Grid3x3 size={13} />}
        label="شبکه"
        title="چسبیدن اجزا به شبکهٔ ۱۰ پیکسلی"
      />

      <ColorPickerPopover value={selectedColor ?? '#2563eb'} onChange={onColor} disabled={!selectedColor} title="تغییر رنگ انتخاب">
        <span className="whitespace-nowrap">رنگ</span>
      </ColorPickerPopover>

      <button
        type="button"
        className="btn-ghost btn-xs"
        onClick={onSyncDevices}
        disabled={syncing}
        aria-label="همگام‌سازی تجهیزات بوم"
        title="همگام‌سازی نام/نوع/مدل/IP همهٔ تجهیزات بوم با رکورد مانیتورینگ"
      >
        <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
        <span className="whitespace-nowrap">همگام‌سازی</span>
      </button>

      <button
        type="button"
        className="btn-ghost btn-xs hover:!border-red-200 hover:!text-danger"
        onClick={onDelete}
        disabled={!hasSelection}
        aria-label="حذف انتخاب"
        title="حذف انتخاب (Delete)"
      >
        <Trash size={13} />
        <span className="whitespace-nowrap">حذف</span>
      </button>

      {/* ردیف دوم: فقط با انتخاب چندگانه */}
      {multi ? (
        <div className="mt-1 flex w-full flex-wrap items-center gap-1 border-t border-ink-100 pt-1">
          <span className="num rounded-pill bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-accent">
            {faDigits(selectedCount)} انتخاب
          </span>
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
          <span className="mx-0.5 h-4 w-px bg-ink-200" aria-hidden />
          <ColorPickerPopover value="#2563eb" onChange={onGroupColor} title="رنگ همهٔ انتخاب‌ها">
            رنگ گروهی
          </ColorPickerPopover>
          <button type="button" className="btn-ghost btn-xs" onClick={onCopy} title="کپی (Ctrl+C)">
            <Copy size={13} />
            <span className="whitespace-nowrap">کپی</span>
          </button>
          <button type="button" className="btn-ghost btn-xs" onClick={onDuplicate} title="تکثیر (Ctrl+D)">
            <Plus size={13} />
            <span className="whitespace-nowrap">تکثیر</span>
          </button>
          <button
            type="button"
            className="btn-ghost btn-xs"
            onClick={onPaste}
            disabled={!clipboardCount}
            title="چسباندن (Ctrl+V)"
          >
            <ClipboardIcon /> <span className="whitespace-nowrap">چسباندن</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ClipboardIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  );
}
