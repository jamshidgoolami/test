/**
 * بوم دیاگرام — React Flow با گره‌های تجهیز/شکل/یادداشت و یال‌های نوع‌دار.
 *
 * • در هر چهار سمت هر جزء نقطهٔ اتصال وجود دارد؛ با ConnectionMode.Loose
 *   می‌توان از هر سمت به هر سمت دیگر کشید.
 * • یال به شناسهٔ نقطهٔ اتصال بسته است، پس با جابه‌جایی یا تغییر اندازهٔ
 *   تجهیز، ارتباط خودبه‌خود روی همان نقطه می‌ماند.
 * • در حالت نمایش، جابه‌جایی و نقاط اتصال غیرفعال‌اند و فقط انتخاب/مشاهده
 *   انجام می‌شود.
 * • «گروه» کادر کم‌رنگ پشت همهٔ اجزاست و نقطهٔ اتصال ندارد؛ هنگام افزودن
 *   جزء تازه، کلیک از روی گروه عبور می‌کند تا افزودن روی بوم مختل نشود.
 * • خروجی تصویر/PDF از نمای بوم با همان چیدمان و ظاهر گرفته می‌شود.
 */
import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  Controls,
  Handle,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  getNodesBounds,
  getBezierPath,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import type {
  Connection,
  EdgeProps,
  EdgeTypes,
  NodeProps,
  NodeTypes,
  OnEdgesChange,
  OnNodesChange,
} from '@xyflow/react';
import { ChevronDown, ImageOff, Link2, Lock, Maximize2, MessageSquare, Minimize2, Minus, Plus, StickyNote } from 'lucide-react';
import { toPng } from 'html-to-image';
import '@xyflow/react/dist/style.css';
import {
  CONNECTION_TYPES,
  GRID_SIZE,
  GROUP_DEFAULT_COLOR,
  HANDLE_SIDES,
  connectionType,
  contrastText,
  deviceType,
} from '../../lib/diagrams';
import { composeExportSheet, downloadDataUrl, downloadDiagramPdf, safeFileName } from '../../lib/diagram-export';
import type { ExportMeta } from '../../lib/diagram-export';
import type { DiagramFlowEdge, DiagramFlowNode, DiagramStatusFilter, HandleSide } from '../../lib/diagrams';
import type { Device, DiagramComment, DiagramConnectionKind } from '../../lib/types';
import { faDigits, fmtMs, fmtPct, fmtRelative, statusMeta } from '../../lib/format';
import { useDeviceLive } from '../../lib/store';
import { DeviceGlyph } from './DeviceGlyph';

const EMPTY_DEVICES = new Map<number, Device>();
const EMPTY_COUNTS = new Map<string, number>();
const EMPTY_IDS = new Set<string>();

type ZoomLevel = 'far' | 'mid' | 'near';

const TOOL_CONTEXT = createContext({
  editing: false,
  connectable: false,
  placing: false,
  exporting: false,
  zoomLevel: 'mid' as ZoomLevel,
  highlightNodeId: null as string | null,
  showIp: true,
  showConnectionInfo: true,
  connectionCounts: EMPTY_COUNTS,
  fadedNodeIds: EMPTY_IDS,
  devices: EMPTY_DEVICES,
  onOpenDevice: (_id: number) => {},
  onOpenDiagram: (_id: number) => {},
  onToggleGroup: (_id: string) => {},
});

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

function SideHandles({ color, selected }: { color: string; selected?: boolean }) {
  const { connectable, exporting } = useContext(TOOL_CONTEXT);
  // نقاط اتصال در خروجی تصویر دیده نمی‌شوند.
  if (exporting) return null;
  return (
    <>
      {HANDLE_SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={POSITIONS[side]}
          isConnectable={connectable}
          className={`diagram-handle ${connectable || selected ? 'is-active' : ''}`}
          style={{ borderColor: color }}
        />
      ))}
    </>
  );
}

const nodeFrame = 'relative h-full w-full';

function DeviceNode({ id, data, selected }: NodeProps<DiagramFlowNode>) {
  const { editing, exporting, devices, onOpenDevice, zoomLevel, showIp, showConnectionInfo, connectionCounts } =
    useContext(TOOL_CONTEXT);
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
  const statusColor = statusInfo && status !== 'unknown' ? statusInfo.chart : null;
  const links = connectionCounts.get(id) ?? 0;
  const showStatus = !!deviceId && !!statusInfo && status !== 'unknown';

  return (
    <div className={nodeFrame} dir="rtl">
      <NodeResizer
        isVisible={!!active}
        minWidth={110}
        minHeight={64}
        color={color}
        lineClassName="diagram-resize-line"
        handleClassName="diagram-resize-handle"
      />
      <SideHandles color={color} selected={selected} />
      <CommentBadge comments={data.comments} />
      {data.locked ? (
        <span
          className="absolute -bottom-1.5 -end-1.5 z-20 grid h-5 w-5 place-items-center rounded-full border border-ink-200 bg-surface text-ink-500 shadow-xs"
          title="موقعیت این گره قفل است"
        >
          <Lock size={10} />
        </span>
      ) : null}
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-xl border-2 bg-surface px-2 py-1.5 text-right shadow-soft transition-shadow"
        style={{
          borderColor: active ? '#2563eb' : statusColor ? `${statusColor}cc` : `${color}55`,
          background: statusColor ? `${statusColor}0a` : undefined,
          boxShadow: active
            ? '0 0 0 3px rgba(37,99,235,0.18)'
            : statusColor
              ? `0 1px 2px ${statusColor}1f`
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
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md"
            style={{ background: `${color}18`, color }}
          >
            <DeviceGlyph icon={meta.icon} size={13} />
          </span>
          <p className="min-w-0 flex-1 truncate text-[11.5px] font-semibold leading-4 text-ink-800">
            {data.label || meta.label}
          </p>
          {showStatus && statusInfo ? (
            <span
              className={`h-2 w-2 shrink-0 rounded-full ring-2 ring-surface ${statusInfo.dot}`}
              title={statusInfo.label}
              aria-label={statusInfo.label}
            />
          ) : null}
        </div>
        {zoomLevel !== 'far' ? (
          <div className="mt-auto flex min-w-0 flex-col gap-px">
            <div className="flex min-w-0 items-center gap-1 text-[9px] leading-3">
              {showStatus && statusInfo ? (
                <span className={`truncate font-medium ${statusInfo.text}`}>{statusInfo.label}</span>
              ) : (
                <span className="truncate text-ink-400">{data.model || meta.label}</span>
              )}
              {showConnectionInfo && rtt != null ? (
                <span className="num shrink-0 text-ink-400">· {fmtMs(rtt)}</span>
              ) : null}
              {showConnectionInfo && loss != null && loss > 0 ? (
                <span className="num shrink-0 text-danger">· {fmtPct(loss, 0)}</span>
              ) : null}
            </div>
            <div className="flex min-w-0 items-center justify-between gap-1 text-[9px] leading-3 text-ink-400">
              {showIp && data.ip ? (
                <span className="ltr truncate">{String(data.ip)}</span>
              ) : (
                <span className="truncate">{data.model || (deviceId ? 'متصل به پایش' : 'بدون پایش')}</span>
              )}
              {showConnectionInfo && links > 0 ? (
                <span className="inline-flex shrink-0 items-center gap-0.5" title={`${faDigits(links)} ارتباط`}>
                  <Link2 size={8} />
                  {faDigits(links)}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** تصویر/لوگوی پیوست‌شده؛ در حالت نمایش فقط نمایش داده می‌شود. */
function ImageNode({ data, selected }: NodeProps<DiagramFlowNode>) {
  const { editing, exporting, zoomLevel } = useContext(TOOL_CONTEXT);
  const active = editing && selected && !exporting;
  const src = typeof data.src === 'string' ? data.src : '';
  return (
    <div className={nodeFrame} dir="rtl">
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

function ShapeNode({ data, selected }: NodeProps<DiagramFlowNode>) {
  const { editing, exporting } = useContext(TOOL_CONTEXT);
  const color = data.color || '#dbeafe';
  const circle = data.shape === 'circle';
  const text = String(data.text ?? '');
  const active = selected && !exporting;
  return (
    <div className={nodeFrame} dir="rtl">
      <NodeResizer
        isVisible={editing && !!active}
        minWidth={60}
        minHeight={60}
        color="#64748b"
        lineClassName="diagram-resize-line"
        handleClassName="diagram-resize-handle"
      />
      <SideHandles color="#64748b" />
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

function NoteNode({ data, selected }: NodeProps<DiagramFlowNode>) {
  const { editing, exporting, zoomLevel } = useContext(TOOL_CONTEXT);
  const color = data.color || '#fef08a';
  const active = editing && selected && !exporting;
  return (
    <div className={nodeFrame} dir="rtl">
      <NodeResizer
        isVisible={!!active}
        minWidth={120}
        minHeight={80}
        color="#ca8a04"
        lineClassName="diagram-resize-line"
        handleClassName="diagram-resize-handle"
      />
      <SideHandles color="#ca8a04" selected={selected} />
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
function DiagramLinkNode({ data, selected }: NodeProps<DiagramFlowNode>) {
  const { editing, exporting, onOpenDiagram, zoomLevel } = useContext(TOOL_CONTEXT);
  const active = editing && selected && !exporting;
  const color = String(data.color || '#0369a1');
  const targetId = data.diagramId ? Number(data.diagramId) : null;
  return (
    <div className={nodeFrame} dir="rtl">
      <NodeResizer
        isVisible={!!active}
        minWidth={140}
        minHeight={60}
        color={color}
        lineClassName="diagram-resize-line"
        handleClassName="diagram-resize-handle"
      />
      <SideHandles color={color} selected={selected} />
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

function ConnectionEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<DiagramFlowEdge>) {
  const { exporting, highlightNodeId, fadedNodeIds } = useContext(TOOL_CONTEXT);
  const active = selected && !exporting;
  const meta = connectionType(data?.kind as DiagramConnectionKind | undefined);
  // مسیر خمیدهٔ بزیه از هر سمتی به هر سمت دیگر (حتی مورب) روان رسم می‌شود.
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.32,
  });
  const faded = fadedNodeIds.has(source) || fadedNodeIds.has(target);
  const dimmed = faded || (!!highlightNodeId && highlightNodeId !== source && highlightNodeId !== target);
  const width = active ? meta.width + 1.5 : meta.width;
  return (
    <>
      {/* هالهٔ سفید زیر خط، ارتباط را روی پس‌زمینهٔ شلوغ خوانا نگه می‌دارد. */}
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={26}
        style={{
          stroke: 'rgb(var(--nw-surface))',
          strokeWidth: width + (dimmed ? 2.5 : 3.5),
          opacity: faded ? 0.1 : dimmed ? 0.3 : 0.94,
        }}
      />
      {/* بدون برچسب و فلش: نوع ارتباط فقط با رنگ/الگوی خط و راهنمای رنگ خوانده می‌شود. */}
      <path
        d={path}
        fill="none"
        stroke={meta.color}
        strokeWidth={width}
        strokeDasharray={meta.dash || undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="none"
        opacity={faded ? 0.05 : dimmed ? 0.16 : 1}
        style={{
          filter: active ? `drop-shadow(0 0 3px ${meta.color}66)` : undefined,
          transition: 'opacity 120ms ease',
        }}
      />
    </>
  );
}

const nodeTypes = {
  device: DeviceNode,
  shape: ShapeNode,
  note: NoteNode,
  group: GroupNode,
  image: ImageNode,
  diagram: DiagramLinkNode,
} satisfies NodeTypes;

const edgeTypes = {
  diagram: ConnectionEdge,
} satisfies EdgeTypes;

export type DiagramExportFormat = 'png' | 'pdf';

export interface DiagramCanvasHandle {
  /** خروجی گرفتن از کل بوم (همهٔ اجزا، نه فقط بخش دیده‌شده) */
  exportImage: (format: DiagramExportFormat) => Promise<void>;
  fitView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

export interface DiagramCanvasProps {
  nodes: DiagramFlowNode[];
  edges: DiagramFlowEdge[];
  editing: boolean;
  connectable: boolean;
  /** نام دیاگرام برای نام فایل خروجی */
  diagramName: string;
  /** جزئی برای افزودن روی بوم مسلح شده است (گروه‌ها کلیک را نمی‌گیرند) */
  placing?: boolean;
  onNodesChange: OnNodesChange<DiagramFlowNode>;
  onEdgesChange: OnEdgesChange<DiagramFlowEdge>;
  onConnect: (connection: Connection) => void;
  onNodesDelete: (nodes: DiagramFlowNode[]) => void;
  onEdgesDelete: (edges: DiagramFlowEdge[]) => void;
  onPaneClick: (position: { x: number; y: number }) => void;
  onInspect: () => void;
  onEdgeInspect: () => void;
  pendingHint: string | null;
  onCancelPending: () => void;
  /** تجهیزات مانیتورینگ برای نمایش وضعیت زنده روی گره‌ها */
  devices?: Map<number, Device>;
  /** باز کردن صفحهٔ تجهیز با دوبار کلیک روی گره */
  onOpenDevice?: (deviceId: number) => void;
  /** باز کردن دیاگرام مقصد با دوبار کلیک روی گرهٔ پیوند */
  onOpenDiagram?: (diagramId: number) => void;
  /** جمع/باز کردن گروه؛ تغییر در داده‌های دیاگرام ذخیره می‌شود. */
  onToggleGroup?: (nodeId: string) => void;
  /** فرادادهٔ کادر عنوان در خروجی */
  exportMeta: Omit<ExportMeta, 'nodeCount' | 'edgeCount'>;
  /** درج کادر عنوان/متادیتا در تصویر و PDF */
  titleBlock?: boolean;
  /** چسبیدن به شبکه */
  snapToGrid?: boolean;
  /** نمایش/مخفی کردن IP روی گره‌های تجهیز */
  showIp?: boolean;
  /** نمایش/مخفی کردن تأخیر، افت بسته و تعداد ارتباط */
  showConnectionInfo?: boolean;
  /** جست‌وجوی تجهیز؛ گره‌های نامرتبط کم‌رنگ می‌شوند */
  searchQuery?: string;
  /** فیلتر وضعیت واقعی تجهیزات */
  statusFilter?: DiagramStatusFilter;
  /** رها کردن تجهیز کشیده‌شده از پنل روی بوم */
  onDropDevice?: (deviceId: number, position: { x: number; y: number }) => void;
  onDragStart?: () => void;
  onDragStop?: () => void;
}

const DiagramCanvas = forwardRef<DiagramCanvasHandle, DiagramCanvasProps>(function DiagramCanvas({
  nodes,
  edges,
  editing,
  connectable,
  diagramName,
  placing = false,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodesDelete,
  onEdgesDelete,
  onPaneClick,
  onInspect,
  onEdgeInspect,
  pendingHint,
  onCancelPending,
  devices,
  onOpenDevice,
  onOpenDiagram,
  onToggleGroup,
  exportMeta,
  titleBlock = true,
  snapToGrid = false,
  showIp = true,
  showConnectionInfo = true,
  searchQuery = '',
  statusFilter = 'all',
  onDropDevice,
  onDragStart,
  onDragStop,
}: DiagramCanvasProps, ref) {
  const { screenToFlowPosition, flowToScreenPosition, getNodes, fitView, zoomIn, zoomOut } = useReactFlow();
  // فقط تغییر زوم باعث رندر دوباره می‌شود؛ جابه‌جایی بوم نباید کل گره‌ها را
  // دوباره رندر کند.
  const zoom = useStore((state) => state.transform[2]);
  const hostRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  // در حالت نمایش، باز کردن موقت گروه‌های جمع‌شده نباید دادهٔ دیاگرام را تغییر دهد.
  const [localExpanded, setLocalExpanded] = useState<Set<string>>(() => new Set());
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const zoomLevel: ZoomLevel = zoom < 0.55 ? 'far' : zoom < 1.2 ? 'mid' : 'near';

  useEffect(() => {
    if (!editing) return;
    setLocalExpanded(new Set());
  }, [editing]);

  const exitFullscreen = useCallback(() => {
    setFullscreen(false);
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (fullscreen) {
      exitFullscreen();
      return;
    }
    setFullscreen(true);
    // کلاس fixed پشتیبان است؛ Fullscreen API روی مرورگرهایی که از آن پشتیبانی
    // می‌کنند بوم را از هر جداد دارای transform/overflow هم جدا می‌کند.
    const host = hostRef.current;
    if (host?.requestFullscreen) {
      try {
        await host.requestFullscreen();
      } catch {
        /* در iframe یا بدون اجازهٔ مرورگر، حالت fixed باقی می‌ماند. */
      }
    }
  }, [exitFullscreen, fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const fullscreenHost = hostRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exitFullscreen();
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    // React Flow با تغییر اندازهٔ میزبان خود را هماهنگ می‌کند؛ یک تیک بعد از
    // چسبیدن به کل صفحه هم دوباره ابعاد را می‌سنجیم.
    const resizeTimer = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.clearTimeout(resizeTimer);
      if (fullscreenHost && document.fullscreenElement === fullscreenHost) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, [exitFullscreen, fullscreen]);

  const handleToggleGroup = useCallback(
    (groupId: string) => {
      if (editing) {
        onToggleGroup?.(groupId);
        return;
      }
      // در حالت نمایش، جمع/باز کردن فقط ظاهری است و داده‌ای را تغییر نمی‌دهد.
      setLocalExpanded((previous) => {
        const next = new Set(previous);
        if (next.has(groupId)) next.delete(groupId);
        else next.add(groupId);
        return next;
      });
    },
    [editing, onToggleGroup]
  );

  /** تعداد ارتباط هر گره؛ فقط برای نمایش روی گره، در داده ذخیره نمی‌شود. */
  const connectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of edges) {
      counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
      counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
    }
    return counts;
  }, [edges]);

  /** جست‌وجو و فیلتر وضعیت: فقط گره‌های تجهیز نامرتبط کم‌رنگ می‌شوند. */
  const fadedNodeIds = useMemo(() => {
    const faded = new Set<string>();
    if (exporting) return faded;
    const needle = searchQuery.trim().toLowerCase();
    if (!needle && statusFilter === 'all') return faded;
    const deviceMap = devices ?? EMPTY_DEVICES;
    for (const node of nodes) {
      if (node.type !== 'device') continue;
      if (needle) {
        const haystack = [node.data.label, node.data.ip, node.data.model, node.data.deviceType]
          .map((value) => String(value ?? ''))
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(needle)) {
          faded.add(node.id);
          continue;
        }
      }
      if (statusFilter !== 'all') {
        const device = node.data.deviceId ? deviceMap.get(Number(node.data.deviceId)) : null;
        if (!device || device.status !== statusFilter) faded.add(node.id);
      }
    }
    return faded;
  }, [devices, exporting, nodes, searchQuery, statusFilter]);

  /** گروه‌های جمع‌شده و اجزای داخل آن‌ها؛ `hidden` فقط برای رندر است. */
  const collapsedGroups = useMemo(
    () =>
      nodes.filter((node) => {
        if (node.type !== 'group' || !node.data.collapsed) return false;
        return editing || !localExpanded.has(node.id);
      }),
    [editing, localExpanded, nodes]
  );

  const { displayNodes, displayEdges } = useMemo(() => {
    const decorate = (node: DiagramFlowNode): DiagramFlowNode => {
      const faded = fadedNodeIds.has(node.id);
      const locked = node.data.locked === true;
      if (!faded && !locked) return node;
      return {
        ...node,
        ...(locked ? { draggable: false } : {}),
        ...(faded ? { style: { ...node.style, opacity: 0.18 } } : {}),
      };
    };
    if (!collapsedGroups.length) {
      return {
        displayNodes: nodes.map((node) =>
          decorate(
            node.type === 'group' && node.data.collapsed
              ? { ...node, data: { ...node.data, collapsed: false } }
              : node
          )
        ),
        displayEdges: edges,
      };
    }

    const collapsedIds = new Set(collapsedGroups.map((group) => group.id));
    const hidden = new Set<string>();
    const counts = new Map<string, number>();
    for (const group of collapsedGroups) {
      const groupWidth = group.width ?? group.measured?.width ?? 360;
      const groupHeight = group.height ?? group.measured?.height ?? 260;
      let count = 0;
      for (const node of nodes) {
        if (node.id === group.id) continue;
        const nodeWidth = node.width ?? node.measured?.width ?? 190;
        const nodeHeight = node.height ?? node.measured?.height ?? 86;
        const centerX = node.position.x + nodeWidth / 2;
        const centerY = node.position.y + nodeHeight / 2;
        if (
          centerX >= group.position.x &&
          centerX <= group.position.x + groupWidth &&
          centerY >= group.position.y &&
          centerY <= group.position.y + groupHeight
        ) {
          hidden.add(node.id);
          count += 1;
        }
      }
      counts.set(group.id, count);
    }

    return {
      displayNodes: nodes.map((node) => {
        if (hidden.has(node.id)) return decorate({ ...node, hidden: true });
        if (collapsedIds.has(node.id)) {
          return decorate({
            ...node,
            height: 44,
            style: { ...node.style, height: 44 },
            data: { ...node.data, collapsed: true, collapsedCount: counts.get(node.id) ?? 0 },
          });
        }
        return decorate(
          node.type === 'group' ? { ...node, data: { ...node.data, collapsed: false } } : node
        );
      }),
      displayEdges: edges.filter((edge) => !hidden.has(edge.source) && !hidden.has(edge.target)),
    };
  }, [collapsedGroups, edges, fadedNodeIds, nodes]);

  /**
   * خطوط راهنمای تراز: اگر لبه/مرکز جزء در حرکت با لبه/مرکز جزء دیگری در
   * فاصلهٔ کمتر از ۶ پیکسل باشد، خط راهنما نمایش داده می‌شود.
   */
  const computeGuides = useCallback(
    (dragged: DiagramFlowNode) => {
      const width = dragged.width ?? dragged.measured?.width ?? 190;
      const height = dragged.height ?? dragged.measured?.height ?? 86;
      const tolerance = 6;
      const vertical: number[] = [];
      const horizontal: number[] = [];
      const mineX = [dragged.position.x, dragged.position.x + width / 2, dragged.position.x + width];
      const mineY = [dragged.position.y, dragged.position.y + height / 2, dragged.position.y + height];
      for (const other of getNodes()) {
        if (other.id === dragged.id) continue;
        const ow = other.width ?? other.measured?.width ?? 190;
        const oh = other.height ?? other.measured?.height ?? 86;
        const otherX = [other.position.x, other.position.x + ow / 2, other.position.x + ow];
        const otherY = [other.position.y, other.position.y + oh / 2, other.position.y + oh];
        for (const edge of otherX) {
          if (mineX.some((value) => Math.abs(value - edge) <= tolerance) && !vertical.includes(edge)) {
            vertical.push(edge);
          }
        }
        for (const edge of otherY) {
          if (mineY.some((value) => Math.abs(value - edge) <= tolerance) && !horizontal.includes(edge)) {
            horizontal.push(edge);
          }
        }
      }
      setGuides({ v: vertical, h: horizontal });
    },
    [getNodes]
  );

  // برای گرفتن خروجی، همهٔ اجزا باید در DOM باشند؛ در حالت عادی فقط اجزای
  // دیدنی رندر می‌شوند. یک تیک صبر می‌کنیم تا رندر کامل شود و بعد عکس می‌گیریم.
  const exportImage = useCallback(
    async (format: DiagramExportFormat) => {
      const host = hostRef.current;
      if (!host) throw new Error('بوم دیاگرام در دسترس نیست.');
      setExporting(true);
      try {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        await new Promise((resolve) => setTimeout(resolve, 120));
        const current = getNodes();
        // اجزای گروه جمع‌شده در خروجی هم پنهان می‌مانند و کادرشان فضای خالی نمی‌سازد.
        const drawable = current.filter((node) => !node.hidden);
        if (!drawable.length) throw new Error('این دیاگرام هیچ جزئی برای خروجی ندارد.');
        const viewport = host.querySelector<HTMLElement>('.react-flow__viewport');
        if (!viewport) throw new Error('نمای بوم پیدا نشد.');

        const bounds = getNodesBounds(drawable);
        const padding = 48;
        const width = Math.max(360, Math.ceil(bounds.width + padding * 2));
        const height = Math.max(240, Math.ceil(bounds.height + padding * 2));
        const longest = Math.max(width, height);
        // برای بوم‌های بزرگ، مقیاس را پایین می‌آوریم تا حجم تصویر مهار شود.
        const pixelRatio = Math.min(2, Math.max(0.6, 2600 / longest));

        const png = await toPng(viewport, {
          width,
          height,
          backgroundColor: '#ffffff',
          pixelRatio,
          style: {
            width: `${width}px`,
            height: `${height}px`,
            transform: `translate(${(-bounds.x + padding).toFixed(2)}px, ${(-bounds.y + padding).toFixed(2)}px) scale(1)`,
            transformOrigin: '0 0',
          },
        });

        // کادر عنوان/متادیتا در یک برگهٔ واحد با تصویر ترکیب می‌شود تا خروجی
        // برای چاپ و بایگانی شناسنامه داشته باشد.
        const sheet = titleBlock
          ? await composeExportSheet(png, {
              ...exportMeta,
              nodeCount: current.length,
              edgeCount: displayEdges.length,
            })
          : png;

        if (format === 'png') downloadDataUrl(sheet, safeFileName(diagramName, 'png'));
        else await downloadDiagramPdf(sheet, safeFileName(diagramName, 'pdf'));
      } finally {
        setExporting(false);
      }
    },
    [diagramName, displayEdges.length, exportMeta, getNodes, titleBlock]
  );

  useImperativeHandle(
    ref,
    () => ({
      exportImage,
      fitView: () => {
        void fitView({ padding: 0.22, duration: 260, maxZoom: 1.15 });
      },
      zoomIn: () => {
        void zoomIn({ duration: 160 });
      },
      zoomOut: () => {
        void zoomOut({ duration: 160 });
      },
    }),
    [exportImage, fitView, zoomIn, zoomOut]
  );

  return (
    <TOOL_CONTEXT.Provider
      value={{
        editing,
        connectable,
        placing,
        exporting,
        zoomLevel,
        highlightNodeId: hoveredNode,
        showIp,
        showConnectionInfo,
        connectionCounts,
        fadedNodeIds,
        devices: devices ?? EMPTY_DEVICES,
        onOpenDevice: onOpenDevice ?? (() => {}),
        onOpenDiagram: onOpenDiagram ?? (() => {}),
        onToggleGroup: handleToggleGroup,
      }}
    >
      <div
        ref={hostRef}
        className={`${fullscreen ? 'fixed inset-0 z-[1300]' : 'relative'} h-full w-full overflow-hidden bg-surface ${
          fullscreen ? 'rounded-none border-0' : 'rounded-2xl border border-ink-200/70'
        }`}
        dir="ltr"
        onDragOver={(event) => {
          if (!editing || !onDropDevice) return;
          if (!Array.from(event.dataTransfer.types).includes('application/x-netwatch-device')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          if (!dropActive) setDropActive(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDropActive(false);
        }}
        onDrop={(event) => {
          setDropActive(false);
          if (!editing || !onDropDevice) return;
          const deviceId = Number(event.dataTransfer.getData('application/x-netwatch-device'));
          if (!deviceId) return;
          event.preventDefault();
          onDropDevice(deviceId, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        }}
      >
        <ReactFlow<DiagramFlowNode, DiagramFlowEdge>
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={(connection) => {
            if (!editing || !connectable) return false;
            if (!connection.source || !connection.target || connection.source === connection.target) return false;
            return !edges.some(
              (edge) =>
                (edge.source === connection.source && edge.target === connection.target) ||
                (edge.source === connection.target && edge.target === connection.source)
            );
          }}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          onNodeClick={onInspect}
          onEdgeClick={onEdgeInspect}
          onNodeMouseEnter={(_event, node) => setHoveredNode(node.id)}
          onNodeMouseLeave={() => setHoveredNode(null)}
          onPaneMouseMove={() => {
            if (hoveredNode) setHoveredNode(null);
          }}
          onNodeDragStart={() => {
            onDragStart?.();
          }}
          onNodeDrag={(_event, node) => {
            if (editing) computeGuides(node);
          }}
          onNodeDragStop={() => {
            setGuides({ v: [], h: [] });
            onDragStop?.();
          }}
          snapToGrid={snapToGrid}
          snapGrid={[GRID_SIZE, GRID_SIZE]}
          onPaneClick={(event) => {
            if (!editing) return;
            const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
            if (position) onPaneClick(position);
          }}
          nodesDraggable={editing}
          nodesConnectable={editing && connectable}
          // انتخاب یک جزء نباید ترتیب لایه‌ها را عوض کند؛ وگرنه گروه انتخاب‌شده
          // روی تجهیزات می‌آید و کلیک آن‌ها را می‌گیرد.
          elevateNodesOnSelect={false}
          elementsSelectable
          connectionMode={ConnectionMode.Loose}
          deleteKeyCode={editing ? ['Backspace', 'Delete'] : null}
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          zoomOnDoubleClick={false}
          minZoom={0.2}
          maxZoom={2.5}
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
          onlyRenderVisibleElements={!exporting}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgb(var(--nw-ink-300))" />
          <Controls position="bottom-left" showInteractive={false} />
          <div className="absolute left-2.5 top-2.5 z-30" dir="rtl">
            {minimapOpen ? (
              <div className="w-[168px] overflow-hidden rounded-xl border border-ink-200 bg-surface/95 shadow-soft">
                <div className="flex items-center justify-between border-b border-ink-100 px-2 py-1">
                  <span className="text-[10px] font-medium text-ink-500">مینی‌مپ</span>
                  <button
                    type="button"
                    onClick={() => setMinimapOpen(false)}
                    className="grid h-5 w-5 place-items-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-800"
                    title="جمع کردن مینی‌مپ"
                    aria-label="جمع کردن مینی‌مپ"
                    aria-expanded={true}
                  >
                    <Minus size={12} />
                  </button>
                </div>
                <MiniMap
                  pannable
                  zoomable
                  className="!m-0 !border-0 !bg-transparent !shadow-none"
                  style={{ position: 'static', width: 166, height: 96, margin: 0 }}
                  nodeColor={(node) => {
                    const color = typeof node.data?.color === 'string' ? node.data.color : null;
                    return node.type === 'group' ? '#bfdbfe' : color ?? '#94a3b8';
                  }}
                  nodeStrokeColor="rgb(var(--nw-surface))"
                  nodeStrokeWidth={3}
                  nodeBorderRadius={5}
                  maskColor="rgba(248, 250, 252, 0.55)"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setMinimapOpen(true)}
                className="grid h-8 w-8 place-items-center rounded-lg border border-ink-200 bg-surface/95 text-ink-500 shadow-soft transition hover:bg-surface hover:text-ink-800"
                title="باز کردن مینی‌مپ"
                aria-label="باز کردن مینی‌مپ"
                aria-expanded={false}
              >
                <Plus size={15} />
              </button>
            )}
          </div>
        </ReactFlow>

        {/* راهنمای رنگ: تنها مرجع نوع ارتباط، چون برچسب متنی روی خطوط حذف شده است. */}
        <div className="absolute bottom-3 right-3 z-20" dir="rtl">
          {legendOpen ? (
            <div className="w-[142px] rounded-xl border border-ink-200 bg-surface/95 px-2 py-1.5 shadow-soft backdrop-blur">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-ink-600">راهنمای رنگ ارتباط</span>
                <button
                  type="button"
                  onClick={() => setLegendOpen(false)}
                  className="grid h-5 w-5 place-items-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-800"
                  title="جمع کردن راهنمای رنگ"
                  aria-label="جمع کردن راهنمای رنگ"
                  aria-expanded={true}
                >
                  <Minus size={12} />
                </button>
              </div>
              <ul className="mt-1 grid gap-0.5">
                {CONNECTION_TYPES.map((type) => (
                  <li key={type.kind} className="flex items-center gap-1.5 text-[9.5px] leading-4 text-ink-500">
                    <span
                      className="w-4 shrink-0"
                      style={{ borderTop: `2px ${type.dash ? 'dashed' : 'solid'} ${type.color}` }}
                    />
                    <span className="truncate">{type.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setLegendOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-surface/95 px-2 py-1 text-[10px] text-ink-500 shadow-soft transition hover:text-ink-800"
              title="نمایش راهنمای رنگ ارتباط"
              aria-label="نمایش راهنمای رنگ ارتباط"
              aria-expanded={false}
            >
              <span className="flex -space-x-0.5">
                {CONNECTION_TYPES.slice(0, 4).map((type) => (
                  <span
                    key={type.kind}
                    className="h-2 w-2 rounded-full ring-1 ring-surface"
                    style={{ background: type.color }}
                  />
                ))}
              </span>
              راهنمای رنگ
            </button>
          )}
        </div>

        <button
          type="button"
          className="absolute right-2.5 top-2.5 z-30 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ink-200 bg-surface/95 text-ink-500 shadow-soft transition hover:bg-surface hover:text-ink-800"
          onClick={() => void toggleFullscreen()}
          title={fullscreen ? 'خروج از تمام‌صفحه (Esc)' : 'نمایش تمام‌صفحه'}
          aria-label={fullscreen ? 'خروج از تمام‌صفحه' : 'نمایش تمام‌صفحه'}
          aria-pressed={fullscreen}
        >
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>

        {/* خطوط راهنمای تراز (فقط زمان جابه‌جایی) */}
        {editing && (guides.v.length > 0 || guides.h.length > 0) ? (
          <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" dir="ltr" aria-hidden>
            {guides.v.map((x) => {
              const screen = flowToScreenPosition({ x, y: 0 });
              return (
                <span
                  key={`v-${x}`}
                  className="absolute top-0 h-full w-px bg-brand-400/80"
                  style={{ left: Math.round(screen.x) }}
                />
              );
            })}
            {guides.h.map((y) => {
              const screen = flowToScreenPosition({ x: 0, y });
              return (
                <span
                  key={`h-${y}`}
                  className="absolute start-0 w-full h-px bg-brand-400/80"
                  style={{ top: Math.round(screen.y) }}
                />
              );
            })}
          </div>
        ) : null}

        {pendingHint ? (
          <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2" dir="rtl">
            <div className="pointer-events-auto flex items-center gap-2 rounded-pill border border-brand-200 bg-surface/95 px-3 py-1.5 text-[11.5px] font-medium text-accent shadow-pop">
              <Link2 size={13} />
              {pendingHint}
              <button type="button" className="btn-ghost btn-xs" onClick={onCancelPending}>
                لغو
              </button>
            </div>
          </div>
        ) : null}

        {!nodes.length ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6" dir="rtl">
            <div className="max-w-sm rounded-2xl border border-dashed border-ink-200 bg-surface/80 px-6 py-5 text-center backdrop-blur">
              <p className="text-sm font-semibold text-ink-700">بوم این دیاگرام خالی است</p>
              <p className="mt-1 text-[11.5px] leading-5 text-ink-500">
                {editing
                  ? 'از نوار ابزار، تجهیز یا شکل اضافه کنید؛ سپس با ابزار اتصال، نقاط کنار اجزا را به هم وصل کنید.'
                  : 'برای افزودن تجهیز و ارتباط، حالت ویرایش را فعال کنید.'}
              </p>
            </div>
          </div>
        ) : null}

        {editing && connectable ? (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-pill border border-ink-200 bg-surface/95 px-3 py-1 text-[10.5px] text-ink-500 shadow-soft" dir="rtl">
            از نقطهٔ اتصال یک جزء بکشید و روی نقطهٔ اتصال جزء دیگر رها کنید.
          </div>
        ) : null}

        {dropActive ? (
          <div
            className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-2xl border-2 border-dashed border-brand-400 bg-brand-50/40 backdrop-blur-[1px]"
            dir="rtl"
          >
            <div className="flex items-center gap-2 rounded-xl border border-brand-200 bg-surface px-3 py-2 text-[12px] font-medium text-accent shadow-pop">
              <Link2 size={14} />
              تجهیز را برای افزودن روی بوم رها کنید
            </div>
          </div>
        ) : null}
      </div>
    </TOOL_CONTEXT.Provider>
  );
});

export default DiagramCanvas;
