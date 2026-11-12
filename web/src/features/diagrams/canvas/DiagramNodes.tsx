import { useContext } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import type { NodeProps, NodeTypes } from '@xyflow/react';
import { ChevronDown, ImageOff, Link2, MessageSquare, StickyNote } from 'lucide-react';

import { GROUP_DEFAULT_COLOR, HANDLE_SIDES, contrastText, deviceType } from '../../../lib/diagrams';
import type { DiagramFlowNode, HandleSide } from '../../../lib/diagrams';
import type { DiagramComment } from '../../../lib/types';
import { faDigits, fmtMs, fmtPct, fmtRelative, statusMeta } from '../../../lib/format';
import { useDeviceLive } from '../../../lib/store';
import { DeviceGlyph } from '../DeviceGlyph';
import { TOOL_CONTEXT } from './toolContext';

/** نشانگر تعداد کامنت‌های یک گره؛ در خروجی تصویر چاپ نمی‌شود. */
function CommentBadge({ comments }: { comments?: DiagramComment[] }) {
  const { exporting } = useContext(TOOL_CONTEXT);
  const count = Array.isArray(comments) ? comments.length : 0;
  if (!count || exporting) return null;
  return (
    <span
      className="pointer-events-none absolute -start-1.5 -top-1.5 z-20 inline-flex items-center gap-0.5 rounded-pill border border-brand-200 bg-surface/95 px-1 py-0.5 text-[9px] font-semibold text-accent shadow-xs"
      title={`${faDigits(count)} کامنت`}
    >
      <MessageSquare size={9} />
      {faDigits(count)}
    </span>
  );
}

const POSITIONS: Record<HandleSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/**
 * لنگرهای نامرئی چهار سمت. دیگر برای کشیدن خط استفاده نمی‌شوند و فقط باعث
 * می‌شوند یال‌های ذخیره‌شدهٔ قبلی لنگر معتبر داشته باشند؛ مسیر خط با هندسهٔ
 * خود گره‌ها محاسبه می‌شود.
 */
function SideHandles() {
  const { exporting } = useContext(TOOL_CONTEXT);
  if (exporting) return null;
  return (
    <>
      {HANDLE_SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={POSITIONS[side]}
          isConnectable={false}
          className="diagram-handle"
          style={{ opacity: 0, width: 1, height: 1, border: 0, background: 'transparent', pointerEvents: 'none' }}
        />
      ))}
    </>
  );
}

/** گرهٔ مبدأ در حالت اتصال با خط‌چین مشخص می‌شود. */
function useLinkSourceClass(id: string): string {
  const { linkSourceId } = useContext(TOOL_CONTEXT);
  return linkSourceId && linkSourceId === id ? 'diagram-link-source' : '';
}

const nodeFrame = 'relative h-full w-full';

function DeviceNode({ id, data, selected }: NodeProps<DiagramFlowNode>) {
  const { editing, exporting, devices, onOpenDevice, zoomLevel } = useContext(TOOL_CONTEXT);
  const linkSource = useLinkSourceClass(id);
  const meta = deviceType(data.deviceType);
  const color = data.color || meta.color;
  const active = editing && selected && !exporting;
  const deviceId = data.deviceId ? Number(data.deviceId) : null;
  const device = deviceId ? devices.get(deviceId) ?? null : null;
  // نمونهٔ زنده فقط برای تجهیزات متصل به مانیتورینگ؛ هر گره خودش مشترک می‌شود
  // و سرور نمونهٔ همان تجهیز را می‌فرستد.
  const sample = useDeviceLive(deviceId ?? undefined);
  const status = sample?.status ?? device?.status ?? null;
  const statusInfo = status ? statusMeta(status) : null;
  const rtt = sample?.rtt ?? device?.lastRtt ?? null;
  const loss = sample?.lossPct ?? device?.lossPct ?? null;
  const lastCheck = sample?.ts ?? device?.lastCheckAt ?? null;
  const ring = statusInfo && status !== 'unknown' ? statusInfo.chart : null;

  return (
    <div className={`${nodeFrame} ${linkSource}`} dir="rtl">
      <NodeResizer
        isVisible={!!active}
        minWidth={110}
        minHeight={64}
        color={color}
        lineClassName="diagram-resize-line"
        handleClassName="diagram-resize-handle"
      />
      <SideHandles />
      <CommentBadge comments={data.comments} />
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-2xl border bg-surface px-2 py-1 text-center shadow-soft transition-shadow"
        style={{
          borderColor: active ? color : ring ? `${ring}99` : 'rgb(var(--nw-ink-200))',
          boxShadow: active
            ? `0 0 0 2px ${color}33`
            : ring
              ? `0 0 0 2px ${ring}33`
              : undefined,
        }}
        onDoubleClick={() => {
          if (deviceId && !exporting) onOpenDevice(deviceId);
        }}
        title={
          deviceId
            ? `${data.label}${data.ip ? ` · ${data.ip}` : ''}${
                statusInfo ? ` · ${statusInfo.label}` : ''
              }${lastCheck ? ` · آخرین بررسی ${fmtRelative(lastCheck)}` : ''}`
            : undefined
        }
      >
        <span
          className="grid place-items-center rounded-lg p-1"
          style={{ background: `${color}18`, color }}
        >
          <DeviceGlyph icon={meta.icon} size={16} />
        </span>
        <p className="max-w-full truncate text-[12px] font-semibold leading-4 text-ink-800">
          {data.label || meta.label}
        </p>
        {deviceId && statusInfo && zoomLevel === 'far' ? (
          <span className="flex items-center" title={statusInfo.label}>
            <span className={`h-1.5 w-1.5 rounded-full ${statusInfo.dot}`} aria-hidden />
          </span>
        ) : null}
        {deviceId && statusInfo && zoomLevel !== 'far' ? (
          <span className="flex max-w-full items-center gap-1 text-[9.5px] leading-3">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusInfo.dot}`} aria-hidden />
            <span className={`truncate font-medium ${statusInfo.text}`}>{statusInfo.label}</span>
            {rtt != null ? <span className="num truncate text-ink-400">· {fmtMs(rtt)}</span> : null}
            {loss != null && loss > 0 ? <span className="num truncate text-ink-400">· {fmtPct(loss, 0)}</span> : null}
          </span>
        ) : null}
        {!statusInfo && zoomLevel !== 'far' ? (
          <p className="max-w-full truncate text-[9.5px] leading-3 text-ink-400">
            {data.model ? data.model : meta.label}
          </p>
        ) : null}
        {zoomLevel === 'near' && data.ip ? (
          <p className="ltr max-w-full truncate text-[9px] leading-3 text-ink-400">{String(data.ip)}</p>
        ) : null}
      </div>
    </div>
  );
}

/** تصویر/لوگوی پیوست‌شده؛ در حالت نمایش فقط نمایش داده می‌شود. */
function ImageNode({ id, data, selected }: NodeProps<DiagramFlowNode>) {
  const { editing, exporting, zoomLevel } = useContext(TOOL_CONTEXT);
  const linkSource = useLinkSourceClass(id);
  const active = editing && selected && !exporting;
  const src = typeof data.src === 'string' ? data.src : '';
  return (
    <div className={`${nodeFrame} ${linkSource}`} dir="rtl">
      <NodeResizer
        isVisible={!!active}
        minWidth={80}
        minHeight={60}
        color="#0ea5e9"
        lineClassName="diagram-resize-line"
        handleClassName="diagram-resize-handle"
      />
      <CommentBadge comments={data.comments} />
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-surface shadow-soft"
        style={{
          borderColor: active ? '#0ea5e9' : 'rgb(var(--nw-ink-200))',
          boxShadow: active ? '0 0 0 2px #0ea5e933' : undefined,
        }}
      >
        {src ? (
          <img
            src={src}
            alt={String(data.caption || data.label || 'تصویر دیاگرام')}
            className="min-h-0 w-full flex-1 object-contain"
            draggable={false}
          />
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center bg-ink-50 text-ink-300">
            <ImageOff size={22} />
          </div>
        )}
        {data.caption && zoomLevel !== 'far' ? (
          <p className="shrink-0 truncate border-t border-ink-100 px-1.5 py-1 text-center text-[9.5px] text-ink-500">
            {String(data.caption)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * کادر گروه: مستطیل رنگی کم‌رنگ و خط‌چین که پشت سایر اجزا می‌نشیند.
 * برچسب گروه در بالای کادر و توضیح اختیاری زیر آن نمایش داده می‌شود.
 */
function GroupNode({ id, data, selected }: NodeProps<DiagramFlowNode>) {
  const { editing, placing, exporting, onToggleGroup, zoomLevel } = useContext(TOOL_CONTEXT);
  const color = String(data.color || GROUP_DEFAULT_COLOR);
  const active = editing && selected && !exporting;
  const collapsed = !!data.collapsed;
  const childCount = Number(data.collapsedCount ?? 0);
  return (
    <div className={`${nodeFrame} ${placing ? 'pointer-events-none' : ''}`} dir="rtl">
      <NodeResizer
        isVisible={!!active && !collapsed}
        minWidth={160}
        minHeight={120}
        color={color}
        lineClassName="diagram-resize-line"
        handleClassName="diagram-resize-handle"
      />
      <CommentBadge comments={data.comments} />
      <div
        className={`flex h-full w-full flex-col overflow-hidden rounded-xl border-2 border-dashed ${
          collapsed ? 'shadow-soft' : ''
        }`}
        style={{
          background: `${color}14`,
          borderColor: `${color}aa`,
          boxShadow: active ? `0 0 0 2px ${color}55` : undefined,
        }}
      >
        <div className={`flex shrink-0 items-center gap-1.5 px-2.5 ${collapsed ? 'h-full' : 'pt-1.5'}`}>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate text-[11.5px] font-semibold text-ink-700">{data.label || 'گروه'}</span>
          {collapsed && childCount > 0 ? (
            <span className="shrink-0 text-[9.5px] font-medium text-ink-400">
              · {faDigits(childCount)} جزء
            </span>
          ) : null}
          {!exporting ? (
            <button
              type="button"
              className="nodrag nopan ms-auto grid h-5 w-5 shrink-0 place-items-center rounded-md text-ink-500 transition hover:bg-surface/80 hover:text-ink-800"
              onClick={(event) => {
                event.stopPropagation();
                onToggleGroup(id);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              title={collapsed ? 'باز کردن گروه و نمایش اجزا' : 'جمع کردن گروه و پنهان کردن اجزا'}
              aria-label={collapsed ? 'باز کردن گروه' : 'جمع کردن گروه'}
              aria-expanded={!collapsed}
            >
              <ChevronDown size={13} className={collapsed ? '-rotate-90' : ''} />
            </button>
          ) : null}
        </div>
        {!collapsed && data.text && zoomLevel !== 'far' ? (
          <p className="shrink-0 whitespace-pre-wrap break-words px-2.5 pt-0.5 text-[10px] leading-4 text-ink-500">
            {String(data.text)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ShapeNode({ id, data, selected }: NodeProps<DiagramFlowNode>) {
  const { editing, exporting } = useContext(TOOL_CONTEXT);
  const linkSource = useLinkSourceClass(id);
  const color = data.color || '#dbeafe';
  const circle = data.shape === 'circle';
  const text = String(data.text ?? '');
  const active = selected && !exporting;
  return (
    <div className={`${nodeFrame} ${linkSource}`} dir="rtl">
      <NodeResizer
        isVisible={editing && !!active}
        minWidth={60}
        minHeight={60}
        color="#64748b"
        lineClassName="diagram-resize-line"
        handleClassName="diagram-resize-handle"
      />
      <SideHandles />
      <CommentBadge comments={data.comments} />
      <div
        className={`flex h-full w-full items-center justify-center overflow-hidden border border-black/10 px-2 text-center ${
          circle ? 'rounded-full' : 'rounded-soft'
        }`}
        style={{
          background: color,
          color: contrastText(color),
          boxShadow: active ? '0 0 0 2px rgba(37,99,235,0.35)' : undefined,
          paddingInline: circle ? '18%' : undefined,
        }}
      >
        <span className="whitespace-pre-wrap break-words text-[12px] font-medium leading-5">
          {text || (circle ? 'دایره' : 'مستطیل')}
        </span>
      </div>
    </div>
  );
}

function NoteNode({ id, data, selected }: NodeProps<DiagramFlowNode>) {
  const { editing, exporting, zoomLevel } = useContext(TOOL_CONTEXT);
  const linkSource = useLinkSourceClass(id);
  const color = data.color || '#fef08a';
  const active = editing && selected && !exporting;
  return (
    <div className={`${nodeFrame} ${linkSource}`} dir="rtl">
      <NodeResizer
        isVisible={!!active}
        minWidth={120}
        minHeight={80}
        color="#ca8a04"
        lineClassName="diagram-resize-line"
        handleClassName="diagram-resize-handle"
      />
      <SideHandles />
      <CommentBadge comments={data.comments} />
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-amber-300/80 p-2 text-right shadow-soft"
        style={{ background: color, boxShadow: active ? '0 0 0 2px rgba(202,138,4,0.35)' : undefined }}
      >
        <span className="mb-1 flex shrink-0 items-center gap-1 text-[10px] font-medium text-ink-500">
          <StickyNote size={11} />
          <span className="truncate">{data.label || 'یادداشت'}</span>
        </span>
        {zoomLevel !== 'far' ? (
          <p className="min-h-0 flex-1 overflow-hidden whitespace-pre-wrap break-words text-[12px] leading-5 text-ink-700">
            {String(data.text ?? '') || 'متن یادداشت…'}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** گره پیوند به دیاگرام دیگر؛ دوبار کلیک، دیاگرام مقصد را باز می‌کند. */
function DiagramLinkNode({ id, data, selected }: NodeProps<DiagramFlowNode>) {
  const { editing, exporting, onOpenDiagram, zoomLevel } = useContext(TOOL_CONTEXT);
  const linkSource = useLinkSourceClass(id);
  const active = editing && selected && !exporting;
  const color = String(data.color || '#0369a1');
  const targetId = data.diagramId ? Number(data.diagramId) : null;
  return (
    <div className={`${nodeFrame} ${linkSource}`} dir="rtl">
      <NodeResizer
        isVisible={!!active}
        minWidth={140}
        minHeight={60}
        color={color}
        lineClassName="diagram-resize-line"
        handleClassName="diagram-resize-handle"
      />
      <SideHandles />
      <CommentBadge comments={data.comments} />
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-xl border-2 border-dashed bg-surface px-2 py-1 text-center shadow-soft"
        style={{ borderColor: `${color}99`, boxShadow: active ? `0 0 0 2px ${color}33` : undefined }}
        onDoubleClick={() => {
          if (targetId && !exporting) onOpenDiagram(targetId);
        }}
        title={targetId ? `باز کردن دیاگرام «${String(data.label)}» با دوبار کلیک` : 'دیاگرام مقصد تعیین نشده است'}
      >
        <span className="grid place-items-center rounded-lg p-1" style={{ background: `${color}18`, color }}>
          <Link2 size={16} />
        </span>
        <p className="max-w-full truncate text-[12px] font-semibold leading-4 text-ink-800">{String(data.label || 'دیاگرام مرتبط')}</p>
        {zoomLevel !== 'far' ? (
          <p className="max-w-full truncate text-[9.5px] leading-3 text-ink-400">
            {String(data.description || 'پیوند به دیاگرام دیگر')} · دوبار کلیک
          </p>
        ) : null}
      </div>
    </div>
  );
}


export const diagramNodeTypes = {
  device: DeviceNode,
  shape: ShapeNode,
  note: NoteNode,
  group: GroupNode,
  image: ImageNode,
  diagram: DiagramLinkNode,
} satisfies NodeTypes;
