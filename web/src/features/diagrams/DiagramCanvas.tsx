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
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  getNodesBounds,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import type { Connection, OnEdgesChange, OnNodesChange } from '@xyflow/react';
import { Link2, Maximize2, Minimize2, Minus, Plus } from 'lucide-react';
import { toPng } from 'html-to-image';
import '@xyflow/react/dist/style.css';
import { CONNECTION_TYPES, DEVICE_DRAG_MIME, GRID_SIZE, parseDeviceDragPayload } from '../../lib/diagrams';
import { composeExportSheet, downloadDataUrl, downloadDiagramPdf, safeFileName } from '../../lib/diagram-export';
import type { ExportMeta } from '../../lib/diagram-export';
import type { DiagramDeviceDragPayload, DiagramFlowEdge, DiagramFlowNode } from '../../lib/diagrams';
import type { Device } from '../../lib/types';
import { diagramEdgeTypes } from './canvas/DiagramEdges';
import { diagramNodeTypes } from './canvas/DiagramNodes';
import { EMPTY_DEVICES, TOOL_CONTEXT } from './canvas/toolContext';
import type { ZoomLevel } from './canvas/toolContext';


export type DiagramExportFormat = 'png' | 'pdf';

export interface DiagramCanvasHandle {
  /** خروجی گرفتن از کل بوم (همهٔ اجزا، نه فقط بخش دیده‌شده) */
  exportImage: (format: DiagramExportFormat) => Promise<void>;
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
  /** در حالت اتصال، کلیک روی هر گره آن را به‌عنوان مبدأ/مقصد انتخاب می‌کند */
  onPickLinkNode?: (nodeId: string) => void;
  /** گرهٔ مبدأ اتصال (برای نمایش خط‌چین) */
  linkSourceId?: string | null;
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
  onDragStart?: () => void;
  onDragStop?: () => void;
  /** رها کردن تجهیزی که از نوار ابزار کشیده شده است */
  onDropDevice?: (payload: DiagramDeviceDragPayload, position: { x: number; y: number }) => void;
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
  onPickLinkNode,
  linkSourceId = null,
  pendingHint,
  onCancelPending,
  devices,
  onOpenDevice,
  onOpenDiagram,
  onToggleGroup,
  exportMeta,
  titleBlock = true,
  snapToGrid = false,
  onDragStart,
  onDragStop,
  onDropDevice,
}: DiagramCanvasProps, ref) {
  const { screenToFlowPosition, flowToScreenPosition, getNodes } = useReactFlow();
  // فقط تغییر زوم باعث رندر دوباره می‌شود؛ جابه‌جایی بوم نباید کل گره‌ها را
  // دوباره رندر کند.
  const zoom = useStore((state) => state.transform[2]);
  const hostRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
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
    if (!collapsedGroups.length) {
      return {
        displayNodes: nodes.map((node) =>
          node.type === 'group' && node.data.collapsed ? { ...node, data: { ...node.data, collapsed: false } } : node
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
        if (hidden.has(node.id)) return { ...node, hidden: true };
        if (collapsedIds.has(node.id)) {
          return {
            ...node,
            height: 44,
            style: { ...node.style, height: 44 },
            data: { ...node.data, collapsed: true, collapsedCount: counts.get(node.id) ?? 0 },
          };
        }
        return node.type === 'group' ? { ...node, data: { ...node.data, collapsed: false } } : node;
      }),
      displayEdges: edges.filter((edge) => !hidden.has(edge.source) && !hidden.has(edge.target)),
    };
  }, [collapsedGroups, edges, nodes]);

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

  useImperativeHandle(ref, () => ({ exportImage }), [exportImage]);

  return (
    <TOOL_CONTEXT.Provider
      value={{
        editing,
        connectable,
        placing,
        exporting,
        zoomLevel,
        highlightNodeId: hoveredNode,
        devices: devices ?? EMPTY_DEVICES,
        onOpenDevice: onOpenDevice ?? (() => {}),
        onOpenDiagram: onOpenDiagram ?? (() => {}),
        onToggleGroup: handleToggleGroup,
        linkSourceId,
      }}
    >
      <div
        ref={hostRef}
        className={`${fullscreen ? 'fixed inset-0 z-[1300]' : 'relative'} h-full w-full overflow-hidden bg-surface ${
          fullscreen ? 'rounded-none border-0' : 'rounded-2xl border border-ink-200/70'
        } ${connectable ? 'diagram-picking' : ''}`}
        dir="ltr"
        onDragOver={(event) => {
          if (!editing || !onDropDevice) return;
          if (!Array.from(event.dataTransfer.types).includes(DEVICE_DRAG_MIME)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          if (!dropActive) setDropActive(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDropActive(false);
        }}
        onDrop={(event) => {
          if (!editing || !onDropDevice) return;
          setDropActive(false);
          // فقط دادهٔ تجهیز پذیرفته می‌شود؛ متن یا فایل کشیده‌شده روی بوم نادیده می‌ماند.
          if (!Array.from(event.dataTransfer.types).includes(DEVICE_DRAG_MIME)) return;
          const raw =
            event.dataTransfer.getData(DEVICE_DRAG_MIME) || event.dataTransfer.getData('text/plain');
          const payload = parseDeviceDragPayload(raw);
          if (!payload) return;
          event.preventDefault();
          onDropDevice(payload, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        }}
      >
        <ReactFlow<DiagramFlowNode, DiagramFlowEdge>
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={diagramNodeTypes}
          edgeTypes={diagramEdgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          onNodeClick={(_event, node) => {
            if (connectable) {
              // کادر گروه نقطهٔ اتصال ندارد و فقط ظرف است.
              if (node.type === 'group') return;
              onPickLinkNode?.(node.id);
              return;
            }
            onInspect();
          }}
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
          nodesDraggable={editing && !connectable}
          // اتصال فقط با کلیک روی تجهیز اول و دوم انجام می‌شود؛ دستهٔ کشیدنی نداریم.
          nodesConnectable={false}
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

        {dropActive ? (
          <div className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-xl border-2 border-dashed border-brand-400 bg-brand-50/70">
            <span className="rounded-full border border-brand-200 bg-surface px-3 py-1 text-[11.5px] font-medium text-accent shadow-soft">
              تجهیز را همین‌جا رها کنید
            </span>
          </div>
        ) : null}

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
                  ? 'از نوار ابزار، تجهیز یا شکل اضافه کنید؛ سپس با ابزار اتصال، یک تجهیز و بعد تجهیز دیگر را انتخاب کنید.'
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
      </div>
    </TOOL_CONTEXT.Provider>
  );
});

export default DiagramCanvas;
