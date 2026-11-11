/**
 * نقشهٔ ارتباط دیاگرام‌ها
 * ----------------------------------------------------------------
 * نمای کلی همهٔ فایل‌های دیاگرام روی یک بوم تعاملی.
 *
 * این بوم روی همان React Flow ساخته شده که بوم خود دیاگرام از آن استفاده
 * می‌کند؛ بنابراین جابه‌جایی کارت‌ها، کشیدن خط اتصال، پن/زوم و مینی‌مپ با
 * پیاده‌سازی آزموده‌شدهٔ کتابخانه انجام می‌شود و مشکلات مدیریت دستی pointer
 * (از دست رفتن pointer capture، هدف کهنه هنگام رها کردن و اختلاف مختصات
 * صفحه/بوم) دیگر وجود ندارد.
 *
 * • ساختار درختی (parentId) با خط‌چین و پیوندهای دستی با نوع/رنگ خودشان.
 * • کارت‌ها بیضی‌اند و خطوط از نقطهٔ برخورد با محیط بیضی، در هر زاویه‌ای که دو
 *   کارت نسبت به هم دارند، رسم می‌شوند؛ نه فقط از چهار سمت ثابت.
 * • اتصال: از نقطه‌های کنار کارت بکشید یا «حالت اتصال» را روشن و مبدأ/مقصد را
 *   کلیک کنید؛ اتصال تکراری پیش از ارسال به سرور رد می‌شود.
 * • جابه‌جایی: کشیدن کارت در حالت ویرایش؛ اولین کشیدن، چیدمان خودکار را
 *   «فریز» می‌کند تا بقیهٔ کارت‌ها سر جایشان بمانند. چیدمان آزاد در همین
 *   مرورگر ذخیره می‌شود.
 * • بوم: کشیدن پس‌زمینه برای پن، چرخ ماوس برای زوم، «جا دادن» برای برگشت به
 *   نمای کامل و مینی‌مپ برای پیمایش سریع.
 * • پیوند شکسته (مقصد حذف‌شده) در یک کارت جمع‌شدنی نمایش داده می‌شود و از
 *   همان‌جا با یک کلیک پاک می‌شود.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  GitBranch,
  Info,
  LayoutGrid,
  Link2,
  Maximize2,
  Minus,
  Move,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, EdgeTypes, NodeChange, NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api, ApiError } from '../../lib/api';
import { faDigits } from '../../lib/format';
import { CONNECTION_TYPES, connectionType } from '../../lib/diagrams';
import type { HandleSide } from '../../lib/diagrams';
import type { DiagramConnectionKind, DiagramGraph, DiagramGraphBrokenLink } from '../../lib/types';
import { DiagramCard } from './overview/DiagramCard';
import { OverviewLinkEdge } from './overview/OverviewLinkEdge';
import { asSide, automaticSides, layout, readLayoutPrefs, writeLayoutPrefs } from './overview/layout';
import { COMPACT_ZOOM, MAX_ZOOM, MIN_ZOOM, NODE_H, NODE_W, OverviewUi } from './overview/model';
import type { OverviewEdge, OverviewNode, Placed, PositionMap } from './overview/model';

/* ------------------------------------------------------------------ */
/* انواع و ثابت‌ها                                                     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */

const nodeTypes = { overview: DiagramCard } satisfies NodeTypes;
const edgeTypes = { overview: OverviewLinkEdge } satisfies EdgeTypes;

/* ------------------------------------------------------------------ */
/* بوم                                                                 */
/* ------------------------------------------------------------------ */
export interface DiagramOverviewProps {
  open: boolean;
  graph: DiagramGraph | null;
  loading: boolean;
  error?: string | null;
  currentId: number | null;
  canWrite: boolean;
  onClose: () => void;
  onOpen: (id: number, nodeId?: string) => void;
  onRefresh: () => void;
  /** پس از تغییر دادهٔ سرور؛ شناسهٔ دیاگرام مبدأ برای همگام‌سازی بوم */
  onMutated?: (sourceId?: number) => void;
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void;
}

function OverviewBoard({
  graph,
  loading,
  error,
  currentId,
  canWrite,
  onClose,
  onOpen,
  onRefresh,
  onMutated,
  onNotify,
}: DiagramOverviewProps) {
  const { fitView, zoomIn, zoomOut } = useReactFlow<OverviewNode, OverviewEdge>();
  const [initialPrefs] = useState(readLayoutPrefs);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<number | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');
  const [treeOnly, setTreeOnly] = useState(false);
  const [showEdgeLabels, setShowEdgeLabels] = useState(true);
  const [linkKind, setLinkKind] = useState<DiagramConnectionKind>('fiber');
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [brokenOpen, setBrokenOpen] = useState(false);
  const [sourceId, setSourceId] = useState<number | ''>('');
  const [targetId, setTargetId] = useState<number | ''>('');
  const [linkLabel, setLinkLabel] = useState('');
  const [manual, setManual] = useState<PositionMap>(initialPrefs.positions);
  const [autoLayout, setAutoLayout] = useState(initialPrefs.auto);
  const [zoom, setZoom] = useState(1);
  const [fitNonce, setFitNonce] = useState(0);

  const manualRef = useRef<PositionMap>(manual);
  const matchesRef = useRef<Set<number> | null>(null);
  const placedRef = useRef<Placed[]>([]);
  const autoRef = useRef(autoLayout);

  const canEdit = canWrite && mode === 'edit';
  const items = useMemo(() => graph?.items ?? [], [graph]);
  const links = useMemo(() => graph?.links ?? [], [graph]);
  const stats = graph?.stats;

  const autoPlaced = useMemo(() => layout(items, links), [items, links]);
  const placed = useMemo(
    () =>
      autoPlaced.map((item) => {
        const saved = autoLayout ? null : manual[item.id];
        return saved ? { ...item, x: saved.x, y: saved.y } : item;
      }),
    [autoPlaced, autoLayout, manual]
  );
  const positions = useMemo(() => new Map(placed.map((item) => [item.id, item])), [placed]);

  manualRef.current = manual;
  placedRef.current = placed;
  autoRef.current = autoLayout;

  const persist = useCallback((positionsToSave: PositionMap, auto: boolean) => {
    writeLayoutPrefs({ auto, positions: positionsToSave });
  }, []);

  const needle = query.trim();
  const matchedIds = useMemo(() => {
    if (!needle) return null;
    return new Set(
      placed.filter((item) => item.name.includes(needle) || item.description.includes(needle)).map((item) => item.id)
    );
  }, [needle, placed]);
  matchesRef.current = matchedIds;

  // همسایه‌ها از ساختار درختی و پیوندهای دستی ساخته می‌شوند تا هاور/انتخاب هر
  // کارت، مسیرهای مرتبطش را پررنگ و بقیه را محو کند.
  const neighbors = useMemo(() => {
    const map = new Map<number, Set<number>>();
    const add = (a: number, b: number) => {
      if (a === b) return;
      const set = map.get(a) ?? new Set<number>();
      set.add(b);
      map.set(a, set);
    };
    for (const item of items) {
      if (item.parentId == null) continue;
      add(item.id, item.parentId);
      add(item.parentId, item.id);
    }
    for (const link of links) {
      add(link.from, link.to);
      add(link.to, link.from);
    }
    return map;
  }, [items, links]);

  const focusId = hoverId ?? selectedItem;
  const focusSet = useMemo(() => {
    if (focusId == null) return null;
    const set = new Set<number>([focusId]);
    for (const id of neighbors.get(focusId) ?? []) set.add(id);
    return set;
  }, [focusId, neighbors]);
  const compact = zoom < COMPACT_ZOOM;

  /* ------------------------------ گره‌ها و یال‌ها ------------------------------ */
  const nodes = useMemo<OverviewNode[]>(() => {
    const height = compact ? 64 : NODE_H;
    return placed.map((item) => ({
      id: String(item.id),
      type: 'overview' as const,
      position: { x: item.x, y: item.y },
      width: NODE_W,
      height,
      style: { width: NODE_W, height },
      selected: item.id === selectedItem,
      data: {
        name: item.name,
        description: item.description,
        nodeCount: item.nodeCount,
        edgeCount: item.edgeCount,
        childCount: item.childCount,
        inLinks: item.inLinks,
        outLinks: item.outLinks,
        brokenLinks: item.brokenLinks,
        updatedAt: item.updatedAt,
        current: item.id === currentId,
        dimmed:
          (!!matchedIds && !matchedIds.has(item.id)) || (!!focusSet && !focusSet.has(item.id)),
        connectable: canEdit,
        compact,
        highlighted: !!focusSet && focusSet.has(item.id) && item.id !== focusId,
        matched: !!matchedIds && matchedIds.has(item.id),
        connectSource: connectSource === item.id,
      },
    }));
  }, [canEdit, compact, connectSource, currentId, focusId, focusSet, matchedIds, placed, selectedItem]);

  const edges = useMemo<OverviewEdge[]>(() => {
    const focusEdges = focusId != null;
    const treeEdges: OverviewEdge[] = [];
    for (const item of items) {
      if (item.parentId == null) continue;
      const from = positions.get(item.parentId);
      const to = positions.get(item.id);
      if (!from || !to) continue;
      const sides = automaticSides(from, to);
      const incident = focusId != null && (item.parentId === focusId || item.id === focusId);
      treeEdges.push({
        id: `tree-${item.id}`,
        source: String(item.parentId),
        target: String(item.id),
        sourceHandle: sides.fromSide,
        targetHandle: sides.toSide,
        type: 'overview',
        data: { tree: true, highlight: incident },
        selectable: false,
        focusable: false,
        // اندازهٔ نشانگر در SVG با ضخامت خط ضرب می‌شود؛ عدد کوچک می‌ماند تا فلش
        // در خطوط ضخیم هم بزرگ و آزاردهنده نشود.
        markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8', width: 4, height: 4 },
        style: {
          stroke: incident ? '#64748b' : '#94a3b8',
          strokeWidth: incident ? 2 : 1.5,
          strokeDasharray: '5 5',
          pointerEvents: 'none',
          opacity: focusEdges && !incident ? 0.12 : 1,
        },
      });
    }

    const linkEdges: OverviewEdge[] = [];
    for (const link of treeOnly ? [] : links) {
      const from = positions.get(link.from);
      const to = positions.get(link.to);
      if (!from || !to) continue;
      const meta = connectionType(link.kind);
      const sides = automaticSides(from, to);
      const active = selectedLink === `${link.from}:${link.nodeId}`;
      const incident = focusId != null && (link.from === focusId || link.to === focusId);
      linkEdges.push({
        id: `${link.from}:${link.nodeId}`,
        source: String(link.from),
        target: String(link.to),
        sourceHandle: link.fromSide ?? sides.fromSide,
        targetHandle: link.toSide ?? sides.toSide,
        type: 'overview',
        selected: active,
        markerEnd: { type: MarkerType.ArrowClosed, color: meta.color, width: 4.5, height: 4.5 },
        data: {
          kind: link.kind,
          label: link.label,
          nodeLabel: link.nodeLabel,
          highlight: active || incident,
          showLabel: showEdgeLabels && zoom >= 0.7,
        },
        style: {
          stroke: meta.color,
          strokeWidth: active ? meta.width + 1.2 : incident ? meta.width + 0.5 : meta.width,
          strokeDasharray: meta.dash || undefined,
          opacity: focusEdges && !incident ? 0.12 : 1,
        },
      });
    }
    return [...treeEdges, ...linkEdges];
  }, [focusId, items, links, positions, selectedLink, showEdgeLabels, treeOnly, zoom]);

  /* ------------------------------ اندازه/نما ------------------------------ */
  const fit = useCallback(() => {
    if (!items.length) return;
    void fitView({ padding: 0.22, maxZoom: 1.15, duration: 260 });
  }, [fitView, items.length]);

  // با باز شدن نقشه، رسیدن داده یا تغییر تعداد دیاگرام‌ها، بوم جا می‌شود.
  // ابعاد کارت‌ها از width/height خود گره می‌آید و به اندازه‌گیری DOM وابسته
  // نیست؛ فقط یک تیک صبر می‌کنیم تا React Flow گره‌ها را ثبت کند.
  // جابه‌جایی کارت‌ها عمداً این اثر را فعال نمی‌کند تا نمای کاربر نپرد.
  useEffect(() => {
    if (!items.length) return;
    const timer = window.setTimeout(fit, 60);
    return () => window.clearTimeout(timer);
  }, [fit, fitNonce, items.length]);

  const focusMatches = useCallback(() => {
    if (!matchedIds || !matchedIds.size) return;

    void fitView({
      nodes: [...matchedIds].map((id) => ({ id: String(id) })),
      padding: 0.6,
      maxZoom: 1.15,
      duration: 300,
    });
  }, [fitView, matchedIds]);

  // جست‌وجو پس از توقف تایپ، خودکار روی نتایج متمرکز می‌شود. این اثر فقط به
  // عبارت جست‌وجو وابسته است تا جابه‌جایی کارت‌ها (که matchedIds را عوض می‌کند)
  // وسط کار، نمای بوم را نپرد.
  useEffect(() => {
    if (!needle) return;
    const timer = window.setTimeout(() => {
      const ids = matchesRef.current;
      if (!ids?.size) return;
      void fitView({
        nodes: [...ids].map((id) => ({ id: String(id) })),
        padding: 0.6,
        maxZoom: 1.15,
        duration: 300,
      });
    }, 380);
    return () => window.clearTimeout(timer);
  }, [fitView, needle]);

  /* ------------------------------ چیدمان ------------------------------ */
  const onNodesChange = useCallback((changes: NodeChange<OverviewNode>[]) => {
    let next: PositionMap | null = null;
    for (const change of changes) {
      if (change.type !== 'position' || !change.position) continue;
      const id = Number(change.id);
      if (!Number.isInteger(id)) continue;
      next = {
        ...(next ?? manualRef.current),
        [id]: { x: Math.round(change.position.x), y: Math.round(change.position.y) },
      };
    }
    if (!next) return;
    manualRef.current = next;
    setManual(next);
  }, []);

  const onNodeDragStart = useCallback(() => {
    // اولین کشیدن در چیدمان خودکار: جای فعلی همهٔ کارت‌ها عکس گرفته و چیدمان
    // آزاد می‌شود تا بقیه سر جایشان بمانند.
    if (!autoRef.current) return;
    const snapshot: PositionMap = {};
    for (const item of placedRef.current) snapshot[item.id] = { x: item.x, y: item.y };
    manualRef.current = snapshot;
    setManual(snapshot);
    setAutoLayout(false);
  }, []);

  const onNodeDragStop = useCallback(() => {
    persist(manualRef.current, false);
  }, [persist]);

  const enableAuto = useCallback(() => {
    setAutoLayout(true);
    persist(manualRef.current, true);
    setFitNonce((value) => value + 1);
  }, [persist]);

  const enableManual = useCallback(() => {
    if (!autoRef.current) return;
    const snapshot: PositionMap = {};
    for (const item of placedRef.current) snapshot[item.id] = { x: item.x, y: item.y };
    manualRef.current = snapshot;
    setManual(snapshot);
    setAutoLayout(false);
    persist(snapshot, false);
  }, [persist]);

  const resetLayout = useCallback(() => {
    manualRef.current = {};
    setManual({});
    setAutoLayout(true);
    persist({}, true);
    setFitNonce((value) => value + 1);
  }, [persist]);

  /* ------------------------------ پیوندها ------------------------------ */
  const selectedLinkData = useMemo(
    () => (selectedLink ? links.find((link) => `${link.from}:${link.nodeId}` === selectedLink) ?? null : null),
    [links, selectedLink]
  );

  const addLinkBetween = useCallback(
    async (
      from: number,
      to: number,
      label: string | undefined,
      kind: DiagramConnectionKind,
      fromSide?: HandleSide,
      toSide?: HandleSide
    ): Promise<boolean> => {
      if (!canEdit || busy || from === to) return false;
      if (
        links.some(
          (link) => (link.from === from && link.to === to) || (link.from === to && link.to === from)
        )
      ) {
        onNotify?.('این ارتباط از قبل وجود دارد.', 'warning');
        return false;
      }
      setBusy(true);
      try {
        await api.diagramAddLink(from, {
          targetId: to,
          label: label?.trim() || undefined,
          kind,
          fromSide,
          toSide,
        });
        const fromName = items.find((item) => item.id === from)?.name ?? `#${from}`;
        const toName = items.find((item) => item.id === to)?.name ?? `#${to}`;
        onNotify?.(`«${fromName}» به «${toName}» متصل شد.`, 'success');
        onMutated?.(from);
        onRefresh();
        return true;
      } catch (e) {
        onNotify?.(e instanceof ApiError ? e.message : 'ساخت پیوند ناموفق بود.', 'error');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, canEdit, items, links, onMutated, onNotify, onRefresh]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      const from = Number(connection.source);
      const to = Number(connection.target);
      if (!from || !to) return;
      void addLinkBetween(
        from,
        to,
        undefined,
        linkKind,
        asSide(connection.sourceHandle),
        asSide(connection.targetHandle)
      ).then((created) => {
        if (created) {
          setConnectMode(false);
          setConnectSource(null);
        }
      });
    },
    [addLinkBetween, linkKind]
  );

  // اتصال به خود و اتصال تکراری پیش از رسیدن به سرور رد می‌شود؛ بنابراین
  // پیام خطای سرور برای این حالت‌ها نمایش داده نمی‌شود.
  const isValidConnection = useCallback(
    (connection: Connection | OverviewEdge) => {
      if (!canEdit || busy) return false;
      const from = Number(connection.source);
      const to = Number(connection.target);
      if (!from || !to || from === to) return false;
      return !links.some(
        (link) => (link.from === from && link.to === to) || (link.from === to && link.to === from)
      );
    },
    [busy, canEdit, links]
  );

  const createLink = useCallback(async () => {
    const source = Number(sourceId);
    const target = Number(targetId);
    if (!source || !target) {
      onNotify?.('دیاگرام مبدأ و مقصد را انتخاب کنید.', 'warning');
      return;
    }
    if (source === target) {
      onNotify?.('مبدأ و مقصد باید دو دیاگرام متفاوت باشند.', 'warning');
      return;
    }
    const created = await addLinkBetween(source, target, linkLabel, linkKind);
    // فقط وقتی سرور پیوند را پذیرفت فرم بسته می‌شود؛ در خطا (مثلاً تکرار)
    // فرم باز می‌ماند تا کاربر مقصد دیگری انتخاب کند.
    if (created) {
      setLinkLabel('');
      setShowCreate(false);
    }
  }, [addLinkBetween, linkKind, linkLabel, onNotify, sourceId, targetId]);

  const changeLinkKind = useCallback(
    async (kind: DiagramConnectionKind) => {
      if (!selectedLinkData || !canEdit || busy) return;
      setBusy(true);
      try {
        await api.diagramUpdateLink(selectedLinkData.from, selectedLinkData.nodeId, { kind });
        onNotify?.(`نوع پیوند به «${connectionType(kind).label}» تغییر کرد.`, 'success');
        onMutated?.(selectedLinkData.from);
        onRefresh();
      } catch (e) {
        onNotify?.(e instanceof ApiError ? e.message : 'تغییر نوع پیوند ناموفق بود.', 'error');
      } finally {
        setBusy(false);
      }
    },
    [busy, canEdit, onMutated, onNotify, onRefresh, selectedLinkData]
  );

  const updateLinkMeta = useCallback(
    async (patch: { label?: string; fromSide?: HandleSide | null; toSide?: HandleSide | null }) => {
      if (!selectedLinkData || !canEdit || busy) return;
      setBusy(true);
      try {
        await api.diagramUpdateLink(selectedLinkData.from, selectedLinkData.nodeId, patch);
        onNotify?.('جزئیات پیوند ذخیره شد.', 'success');
        onMutated?.(selectedLinkData.from);
        onRefresh();
      } catch (e) {
        onNotify?.(e instanceof ApiError ? e.message : 'ذخیرهٔ جزئیات پیوند ناموفق بود.', 'error');
      } finally {
        setBusy(false);
      }
    },
    [busy, canEdit, onMutated, onNotify, onRefresh, selectedLinkData]
  );

  const removeLink = useCallback(
    async (from: number, nodeId: string, title: string) => {
      if (!canEdit || busy) return;
      if (
        !window.confirm(
          `پیوند «${title}» حذف شود؟ چون پیوند دوطرفه است، جزء متناظر در هر دو دیاگرام برداشته می‌شود و به بقیهٔ اجزا کاری ندارد.`
        )
      ) {
        return;
      }
      setBusy(true);
      try {
        await api.diagramDeleteLink(from, nodeId);
        setSelectedLink(null);
        onNotify?.('پیوند حذف شد.', 'success');
        onMutated?.(from);
        onRefresh();
      } catch (e) {
        onNotify?.(e instanceof ApiError ? e.message : 'حذف پیوند ناموفق بود.', 'error');
      } finally {
        setBusy(false);
      }
    },
    [busy, canEdit, onMutated, onNotify, onRefresh]
  );

  /* ------------------------------ هم‌زمان‌سازی حالت ------------------------------ */
  useEffect(() => {
    if (selectedItem != null && !items.some((item) => item.id === selectedItem)) setSelectedItem(null);
  }, [items, selectedItem]);

  useEffect(() => {
    if (selectedLink && !selectedLinkData) setSelectedLink(null);
  }, [selectedLink, selectedLinkData]);

  // برچسب فرم بازرس با انتخاب پیوند دیگری دوباره مقدار می‌گیرد.
  useEffect(() => {
    setLabelDraft(selectedLinkData?.label ?? '');
  }, [selectedLinkData]);

  useEffect(() => {
    setSourceId((previous) => {
      if (previous && items.some((item) => item.id === previous)) return previous;
      if (currentId && items.some((item) => item.id === currentId)) return currentId;
      return items[0]?.id ?? '';
    });
  }, [currentId, items]);

  useEffect(() => {
    setTargetId((previous) => {
      if (previous && items.some((item) => item.id === previous) && previous !== sourceId) return previous;
      return items.find((item) => item.id !== sourceId)?.id ?? '';
    });
  }, [items, sourceId]);

  useEffect(() => {
    if (canEdit) return;
    setShowCreate(false);
    setConnectMode(false);
    setConnectSource(null);
  }, [canEdit]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (legendOpen) {
        setLegendOpen(false);
        return;
      }
      if (connectMode) {
        if (connectSource != null) setConnectSource(null);
        else setConnectMode(false);
        return;
      }
      if (showCreate) {
        setShowCreate(false);
        return;
      }
      if (selectedLink) {
        setSelectedLink(null);
        return;
      }
      if (selectedItem != null) {
        setSelectedItem(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connectMode, connectSource, legendOpen, onClose, selectedItem, selectedLink, showCreate]);

  /* ------------------------------ بازرس ------------------------------ */
  const cardLinks = useMemo(() => {
    const outgoing = selectedItem == null ? [] : links.filter((link) => link.from === selectedItem);
    const incoming = selectedItem == null ? [] : links.filter((link) => link.to === selectedItem);
    return { incoming, outgoing };
  }, [links, selectedItem]);

  const childItems = useMemo(
    () => (selectedItem == null ? [] : items.filter((item) => item.parentId === selectedItem)),
    [items, selectedItem]
  );

  const nameOf = (id: number) => positions.get(id)?.name ?? `#${id}`;

  const inspector = (() => {
    if (!selectedLinkData && selectedItem == null) return null;

    if (selectedLinkData) {
      const link = selectedLinkData;
      const meta = connectionType(link.kind);
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[12.5px] font-semibold text-ink-800">جزئیات ارتباط</h3>
            <button
              type="button"
              className="btn-ghost btn-xs !px-1.5"
              onClick={() => setSelectedLink(null)}
              aria-label="بستن جزئیات ارتباط"
            >
              <X size={13} />
            </button>
          </div>

          <div className="rounded-soft border border-ink-100 bg-ink-50/50 p-2.5">
            <p className="flex flex-wrap items-center gap-1 text-[12px] leading-5 text-ink-700">
              <strong className="font-semibold">{nameOf(link.from)}</strong>
              <span className="text-ink-400">↔</span>
              <strong className="font-semibold">{nameOf(link.to)}</strong>
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span
                className="rounded-pill px-1.5 py-0.5 text-[10px] font-medium"
                style={{ color: meta.color, background: `${meta.color}14` }}
              >
                {meta.label}
              </span>
              {link.nodeLabel ? <span className="text-[10px] text-ink-400">{link.nodeLabel}</span> : null}
            </div>
          </div>

          {canEdit ? (
            <>
              <label className="block">
                <span className="label mb-1">برچسب ارتباط</span>
                <input
                  className="field"
                  value={labelDraft}
                  maxLength={120}
                  onChange={(event) => setLabelDraft(event.target.value)}
                  placeholder="مثلاً اتصال به مرکز مخابرات"
                />
              </label>
              <button
                type="button"
                className="btn-primary btn-xs w-full justify-center"
                disabled={busy || labelDraft.trim() === (link.label ?? '')}
                onClick={() => void updateLinkMeta({ label: labelDraft.trim() })}
              >
                <Pencil size={12} />
                ذخیرهٔ برچسب
              </button>

              <label className="block">
                <span className="label mb-1">نوع ارتباط</span>
                <select
                  className="field !py-1.5 text-[11.5px]"
                  value={link.kind}
                  disabled={busy}
                  onChange={(event) => void changeLinkKind(event.target.value as DiagramConnectionKind)}
                >
                  {CONNECTION_TYPES.map((type) => (
                    <option key={type.kind} value={type.kind}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <p className="text-[10.5px] text-ink-400">برای ویرایش پیوند، حالت ویرایش را فعال کنید.</p>
          )}

          <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-2">
            <button
              type="button"
              className="btn-soft btn-xs flex-1 justify-center"
              onClick={() => onOpen(link.from, link.nodeId)}
            >
              <ExternalLink size={12} />
              باز کردن مبدأ
            </button>
            {canEdit ? (
              <button
                type="button"
                className="btn-ghost btn-xs text-danger hover:!border-red-200 hover:!text-danger"
                disabled={busy}
                onClick={() => void removeLink(link.from, link.nodeId, link.nodeLabel || link.label || 'پیوند')}
              >
                <Trash2 size={12} />
                حذف
              </button>
            ) : null}
          </div>
          <p className="text-[10px] leading-4 text-ink-400">
            این ارتباط دوطرفه نمایش داده می‌شود؛ حذف آن جزء متناظر در دیاگرام مقصد را هم برمی‌دارد.
          </p>
        </div>
      );
    }

    const card = items.find((item) => item.id === selectedItem);
    if (!card) return null;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[12.5px] font-semibold text-ink-800">جزئیات دیاگرام</h3>
          <button
            type="button"
            className="btn-ghost btn-xs !px-1.5"
            onClick={() => setSelectedItem(null)}
            aria-label="بستن جزئیات دیاگرام"
          >
            <X size={13} />
          </button>
        </div>

        <div className="rounded-soft border border-ink-100 bg-ink-50/50 p-2.5">
          <p className="truncate text-[13px] font-semibold text-ink-800">{card.name}</p>
          <p className="num mt-1 text-[10.5px] text-ink-400">
            {faDigits(card.nodeCount)} جزء · {faDigits(card.edgeCount)} ارتباط · {faDigits(card.childCount)}{' '}
            زیرمجموعه
          </p>
          {card.description ? (
            <p className="mt-1 text-[10.5px] leading-5 text-ink-500">{card.description}</p>
          ) : null}
        </div>

        <div className="flex gap-1.5">
          <button type="button" className="btn-soft btn-xs flex-1 justify-center" onClick={() => onOpen(card.id)}>
            <ExternalLink size={12} />
            باز کردن
          </button>
          {canEdit ? (
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => {
                setConnectMode(true);
                setConnectSource(card.id);
                setSelectedItem(null);
              }}
              title="اتصال از این دیاگرام به دیاگرام دیگر"
            >
              <Link2 size={12} />
              اتصال
            </button>
          ) : null}
        </div>

        <div>
          <p className="label mb-1">ارتباط‌های خروجی ({faDigits(cardLinks.outgoing.length)})</p>
          {cardLinks.outgoing.length ? (
            <div className="space-y-1">
              {cardLinks.outgoing.map((link) => (
                <button
                  key={`${link.from}:${link.nodeId}`}
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded-lg border border-ink-100 px-2 py-1.5 text-right text-[10.5px] text-ink-600 transition hover:border-brand-200 hover:bg-brand-50/30"
                  onClick={() => {
                    setSelectedItem(null);
                    setSelectedLink(`${link.from}:${link.nodeId}`);
                  }}
                >
                  <span
                    className="h-0.5 w-4 shrink-0 rounded"
                    style={{ background: connectionType(link.kind).color }}
                    aria-hidden
                  />
                  <span className="truncate">{nameOf(link.to)}</span>
                  <span className="ms-auto shrink-0 text-[9px] text-ink-400">
                    {connectionType(link.kind).label}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-ink-400">—</p>
          )}
        </div>

        <div>
          <p className="label mb-1">ارتباط‌های ورودی ({faDigits(cardLinks.incoming.length)})</p>
          {cardLinks.incoming.length ? (
            <div className="space-y-1">
              {cardLinks.incoming.map((link) => (
                <button
                  key={`${link.from}:${link.nodeId}`}
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded-lg border border-ink-100 px-2 py-1.5 text-right text-[10.5px] text-ink-600 transition hover:border-brand-200 hover:bg-brand-50/30"
                  onClick={() => {
                    setSelectedItem(null);
                    setSelectedLink(`${link.from}:${link.nodeId}`);
                  }}
                >
                  <span
                    className="h-0.5 w-4 shrink-0 rounded"
                    style={{ background: connectionType(link.kind).color }}
                    aria-hidden
                  />
                  <span className="truncate">{nameOf(link.from)}</span>
                  <span className="ms-auto shrink-0 text-[9px] text-ink-400">
                    {connectionType(link.kind).label}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-ink-400">—</p>
          )}
        </div>

        {childItems.length ? (
          <div>
            <p className="label mb-1">زیرمجموعه‌ها ({faDigits(childItems.length)})</p>
            <div className="flex flex-wrap gap-1">
              {childItems.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  className="rounded-pill border border-ink-200 px-2 py-0.5 text-[10px] text-ink-600 transition hover:border-brand-300 hover:text-accent"
                  onClick={() => setSelectedItem(child.id)}
                >
                  {child.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  })();

  /* ------------------------------ رندر ------------------------------ */
  const matchCount = matchedIds ? matchedIds.size : items.length;
  const broken = graph?.broken ?? [];

  return (
    <OverviewUi.Provider value={{ open: (id: number) => onOpen(id) }}>
      <div
        className="fixed inset-0 z-[1200] flex items-center justify-center bg-scrim/40 p-2 backdrop-blur-sm sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label="نقشهٔ ارتباط دیاگرام‌ها"
        onClick={onClose}
      >
        <div
          className="flex h-full max-h-[95vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-ink-200/70 bg-surface shadow-pop"
          onClick={(event) => event.stopPropagation()}
        >
          {/* سربرگ */}
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-50 text-accent">
              <GitBranch size={16} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[13.5px] font-semibold text-ink-800">نقشهٔ ارتباط دیاگرام‌ها</h2>
              <p className="num text-[10px] text-ink-400">
                {faDigits(stats?.diagrams ?? items.length)} دیاگرام · {faDigits(stats?.links ?? 0)} پیوند ·{' '}
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
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="جست‌وجوی دیاگرام در نقشهٔ ارتباط"
                />
              </div>
              {needle ? (
                <button
                  type="button"
                  className="btn-ghost btn-xs"
                  onClick={focusMatches}
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
                  onClick={() => setMode('view')}
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
                  onClick={() => setMode('edit')}
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

          {/* نوار ابزار */}
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
                onClick={() => setLegendOpen((value) => !value)}
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
                onClick={() => setBrokenOpen((value) => !value)}
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
                    onChange={(event) => setLinkKind(event.target.value as DiagramConnectionKind)}
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
                  onClick={() => {
                    setConnectMode((value) => !value);
                    setConnectSource(null);
                    setSelectedItem(null);
                    setSelectedLink(null);
                  }}
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
                  onClick={() => setShowCreate((value) => !value)}
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
                    onClick={enableAuto}
                    title="چیدمان خودکار بر اساس ساختار درخت و جهت پیوندها"
                    aria-pressed={autoLayout}
                  >
                    <LayoutGrid size={12} />
                    خودکار
                  </button>
                  <button
                    type="button"
                    className={`btn-ghost btn-xs ${!autoLayout ? '!border-sky-300 !text-info shadow-soft' : ''}`}
                    onClick={enableManual}
                    title="چیدمان آزاد: کارت‌ها را با کشیدن جابه‌جا کنید"
                    aria-pressed={!autoLayout}
                  >
                    <Move size={12} />
                    آزاد
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-xs"
                    onClick={resetLayout}
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
              onClick={() => {
                const next = !treeOnly;
                setTreeOnly(next);
                // با پنهان‌شدن پیوندهای دستی، جزئیات پیوند انتخاب‌شده هم بسته شود.
                if (next) setSelectedLink(null);
              }}
              aria-pressed={treeOnly}
              title="فقط ساختار درختی؛ پیوندهای دستی پنهان می‌شوند"
            >
              <GitBranch size={11} />
              فقط درخت
            </button>
            <button
              type="button"
              className={`btn-ghost btn-xs ${showEdgeLabels ? '' : '!text-ink-400'}`}
              onClick={() => setShowEdgeLabels((value) => !value)}
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
                onClick={() => void zoomOut({ duration: 160 })}
                title="کوچک‌نمایی"
                aria-label="کوچک‌نمایی"
              >
                <Minus size={12} />
              </button>
              <span className="num w-9 text-center text-[10px] text-ink-400">{faDigits(Math.round(zoom * 100))}٪</span>
              <button
                type="button"
                className="btn-ghost btn-xs"
                onClick={() => void zoomIn({ duration: 160 })}
                title="بزرگ‌نمایی"
                aria-label="بزرگ‌نمایی"
              >
                <Plus size={12} />
              </button>
              <button
                type="button"
                className="btn-ghost btn-xs"
                onClick={() => setFitNonce((value) => value + 1)}
                title="جا دادن همهٔ کارت‌ها در کادر"
              >
                <Maximize2 size={12} />
                جا دادن
              </button>
            </span>
          </div>

          {/* فرم ساخت پیوند */}
          {showCreate && canEdit ? (
            <div
              className="flex flex-wrap items-end gap-2 border-b border-ink-100 bg-brand-50/40 px-3 py-2"
              dir="rtl"
            >
              <label className="flex min-w-[140px] flex-1 flex-col gap-0.5 text-[10px] text-ink-500">
                دیاگرام مبدأ
                <select
                  className="field !py-1 text-[11.5px]"
                  value={sourceId}
                  onChange={(event) => setSourceId(Number(event.target.value))}
                >
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[140px] flex-1 flex-col gap-0.5 text-[10px] text-ink-500">
                دیاگرام مقصد
                <select
                  className="field !py-1 text-[11.5px]"
                  value={targetId}
                  onChange={(event) => setTargetId(Number(event.target.value))}
                >
                  {items
                    .filter((item) => item.id !== sourceId)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="flex min-w-[150px] flex-[1.4] flex-col gap-0.5 text-[10px] text-ink-500">
                برچسب (اختیاری)
                <input
                  className="field !py-1 text-[11.5px]"
                  value={linkLabel}
                  placeholder="مثلاً اتصال به مرکز مخابرات"
                  maxLength={120}
                  onChange={(event) => setLinkLabel(event.target.value)}
                />
              </label>
              <label className="flex min-w-[110px] flex-col gap-0.5 text-[10px] text-ink-500">
                نوع ارتباط
                <select
                  className="field !py-1 text-[11.5px]"
                  value={linkKind}
                  onChange={(event) => setLinkKind(event.target.value as DiagramConnectionKind)}
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
                className="btn-primary btn-xs"
                onClick={() => void createLink()}
                disabled={busy || !targetId}
              >
                <Plus size={12} />
                {busy ? 'در حال ساخت…' : 'ساخت پیوند'}
              </button>
              <button type="button" className="btn-ghost btn-xs" onClick={() => setShowCreate(false)}>
                انصراف
              </button>
            </div>
          ) : null}

          {/* بوم + بازرس ارتباط */}
          <div className="flex min-h-0 flex-1">
            <div className="relative min-h-0 flex-1 bg-surface" dir="ltr">
            {loading && !graph ? (
              <div className="grid h-full place-items-center">
                <p className="text-[12px] text-ink-400">در حال خواندن ارتباط دیاگرام‌ها…</p>
              </div>
            ) : error && !graph ? (
              <div className="grid h-full place-items-center p-6 text-center">
                <div>
                  <AlertTriangle size={26} className="mx-auto text-danger" />
                  <p className="mt-2 text-[12.5px] text-ink-600">{error}</p>
                  <button type="button" className="btn-ghost btn-xs mt-3" onClick={onRefresh}>
                    <RefreshCw size={12} />
                    تلاش دوباره
                  </button>
                </div>
              </div>
            ) : (
              <>
                <ReactFlow<OverviewNode, OverviewEdge>
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onNodesChange={onNodesChange}
                  onNodeDragStart={onNodeDragStart}
                  onNodeDragStop={onNodeDragStop}
                  onNodeClick={(_event, node) => {
                    const id = Number(node.id);
                    setHoverId(null);
                    if (connectMode) {
                      if (connectSource == null) {
                        setConnectSource(id);
                        return;
                      }
                      if (connectSource === id) {
                        setConnectSource(null);
                        return;
                      }
                      const from = connectSource;
                      setConnectSource(null);
                      void addLinkBetween(from, id, undefined, linkKind).then((created) => {
                        if (created) {
                          setConnectMode(false);
                          setSelectedItem(null);
                        }
                      });
                      return;
                    }
                    setSelectedLink(null);
                    setSelectedItem(id);
                  }}
                  onNodeMouseEnter={(_event, node) => setHoverId(Number(node.id))}
                  onNodeMouseLeave={() => setHoverId(null)}
                  onNodeDoubleClick={(_event, node) => onOpen(Number(node.id))}
                  onEdgeClick={(event, edge) => {
                    if (edge.data?.tree) return;
                    event.stopPropagation();
                    setSelectedItem(null);
                    setSelectedLink(edge.id);
                  }}
                  onPaneClick={() => {
                    setHoverId(null);
                    setSelectedItem(null);
                    setSelectedLink(null);
                    setLegendOpen(false);
                  }}
                  onConnect={handleConnect}
                  isValidConnection={isValidConnection}
                  nodesDraggable={canEdit}
                  nodesConnectable={canEdit}
                  elementsSelectable
                  edgesFocusable={false}
                  edgesReconnectable={false}
                  deleteKeyCode={null}
                  multiSelectionKeyCode={null}
                  connectionMode={ConnectionMode.Loose}
                  // شعاع بزرگ‌تر از نیم‌عرض/نیم‌ارتفاع کارت: رها کردن هر جای کارت
                  // مقصد، به نزدیک‌ترین نقطهٔ اتصال وصل می‌شود.
                  connectionRadius={80}
                  zoomOnDoubleClick={false}
                  minZoom={MIN_ZOOM}
                  maxZoom={MAX_ZOOM}
                  panOnDrag
                  zoomOnScroll
                  autoPanOnNodeDrag
                  autoPanOnConnect
                  onMove={(_event, viewport) => setZoom(viewport.zoom)}
                  className={connectMode ? 'cursor-crosshair' : canEdit ? 'cursor-grab' : ''}
                >
                  <Background variant={BackgroundVariant.Dots} gap={22} size={1.15} color="rgb(var(--nw-ink-300))" />
                  <Controls position="bottom-left" showInteractive={false} />
                  <MiniMap
                    pannable
                    zoomable
                    position="bottom-right"
                    className="!m-2.5 !hidden overflow-hidden !rounded-xl !border !border-ink-200 !bg-surface sm:!block"
                    style={{ width: 148, height: 92 }}
                    nodeColor={(node) => (node.id === String(currentId) ? 'rgb(var(--nw-brand-300))' : 'rgb(var(--nw-ink-200))')}
                    nodeStrokeColor="rgb(var(--nw-ink-400))"
                    nodeStrokeWidth={2}
                    nodeBorderRadius={59}
                    maskColor="rgb(var(--nw-ink-100) / 0.55)"
                  />
                </ReactFlow>

                {/* وضعیت خالی */}
                {!items.length ? (
                  <div className="pointer-events-none absolute inset-0 grid place-items-center p-6" dir="rtl">
                    <div className="max-w-sm rounded-2xl border border-dashed border-ink-200 bg-surface/85 px-6 py-5 text-center backdrop-blur">
                      <p className="text-sm font-semibold text-ink-700">هنوز دیاگرامی ساخته نشده است</p>
                      <p className="mt-1 text-[11.5px] leading-5 text-ink-500">
                        پس از ساخت دیاگرام در بخش دیاگرام‌ها، همهٔ فایل‌ها و ارتباط‌هایشان روی این بوم دیده می‌شود.
                      </p>
                    </div>
                  </div>
                ) : null}

                {/* شمارش نتایج جست‌وجو */}
                {needle && matchedIds ? (
                  <div
                    className="pointer-events-none absolute left-1/2 top-2.5 z-10 -translate-x-1/2 rounded-pill border border-ink-200 bg-surface/95 px-2.5 py-1 text-[10.5px] text-ink-600 shadow-soft"
                    dir="rtl"
                  >
                    {faDigits(matchCount)} از {faDigits(items.length)} دیاگرام با «{needle}» مطابق است
                  </div>
                ) : null}

                {/* پیوندهای شکسته */}
                {brokenOpen && broken.length ? (
                  <div
                    className="absolute right-2.5 top-2.5 z-20 max-h-[45%] w-[min(340px,calc(100%-20px))] overflow-auto rounded-xl border border-sun-200 bg-sun-50/97 p-2 shadow-pop"
                    dir="rtl"
                  >
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle size={12} className="shrink-0 text-warning" />
                      <p className="flex-1 text-[10.5px] font-semibold text-warning">
                        پیوند به دیاگرام حذف‌شده ({faDigits(broken.length)})
                      </p>
                      <button
                        type="button"
                        className="grid h-5 w-5 place-items-center rounded-md text-warning transition hover:bg-surface/70"
                        onClick={() => setBrokenOpen(false)}
                        aria-label="بستن فهرست پیوندهای شکسته"
                      >
                        <X size={11} />
                      </button>
                    </div>
                    <ul className="mt-1 space-y-1">
                      {broken.map((link: DiagramGraphBrokenLink) => (
                        <li
                          key={`${link.from}:${link.nodeId}`}
                          className="flex flex-wrap items-center gap-1.5 rounded-lg bg-surface/70 px-1.5 py-1 text-[10px] text-warning"
                        >
                          <span className="font-semibold">{link.fromName}</span>
                          <span className="text-warning">→ دیاگرام #{faDigits(link.to)}</span>
                          {link.nodeLabel ? <span className="text-warning">({link.nodeLabel})</span> : null}
                          <button
                            type="button"
                            className="btn-ghost btn-xs ms-auto !py-0.5 hover:!border-red-200 hover:!text-danger"
                            disabled={!canEdit || busy}
                            onClick={() => void removeLink(link.from, link.nodeId, link.nodeLabel || link.fromName)}
                            title={canEdit ? 'پاک کردن این پیوند از بوم مبدأ' : 'برای پاک کردن، حالت ویرایش را فعال کنید'}
                          >
                            <Trash2 size={10} />
                            پاک کردن
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* مدیریت پیوند انتخاب‌شده */}
                {selectedLinkData ? (
                  <div
                    className="absolute bottom-3 left-1/2 z-20 flex w-[min(620px,calc(100%-24px))] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border bg-surface/97 px-2.5 py-1.5 shadow-pop lg:hidden"
                    dir="rtl"
                    style={{ borderColor: `${connectionType(selectedLinkData.kind).color}66` }}
                  >
                    <span className="flex min-w-0 items-center gap-1 text-[11px] text-ink-600">
                      <Link2 size={12} className="shrink-0 text-info" />
                      <strong className="truncate font-semibold text-ink-800">
                        {positions.get(selectedLinkData.from)?.name ?? `#${selectedLinkData.from}`}
                      </strong>
                      <span className="shrink-0 text-ink-400">به</span>
                      <strong className="truncate font-semibold text-ink-800">
                        {positions.get(selectedLinkData.to)?.name ?? `#${selectedLinkData.to}`}
                      </strong>
                      {selectedLinkData.nodeLabel ? (
                        <span className="hidden truncate text-ink-400 sm:inline">({selectedLinkData.nodeLabel})</span>
                      ) : null}
                    </span>
                    {canEdit ? (
                      <label className="inline-flex items-center gap-1 rounded-pill border border-ink-200 bg-surface px-1.5 py-0.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: connectionType(selectedLinkData.kind).color }}
                          aria-hidden
                        />
                        <span className="text-[9.5px] text-ink-400">نوع</span>
                        <select
                          className="bg-transparent text-[10.5px] font-medium text-ink-700 outline-none"
                          value={selectedLinkData.kind}
                          disabled={busy}
                          onChange={(event) => void changeLinkKind(event.target.value as DiagramConnectionKind)}
                          aria-label="نوع ارتباط این پیوند"
                        >
                          {CONNECTION_TYPES.map((type) => (
                            <option key={type.kind} value={type.kind}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <span
                        className="rounded-pill px-2 py-0.5 text-[10px] font-medium"
                        style={{
                          color: connectionType(selectedLinkData.kind).color,
                          background: `${connectionType(selectedLinkData.kind).color}12`,
                        }}
                      >
                        {connectionType(selectedLinkData.kind).label}
                      </span>
                    )}
                    <span className="ms-auto flex items-center gap-1">
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        onClick={() => onOpen(selectedLinkData.from, selectedLinkData.nodeId)}
                        title="باز کردن دیاگرام مبدأ روی همین جزء پیوند"
                      >
                        <ExternalLink size={12} />
                        <span className="hidden sm:inline">باز کردن مبدأ</span>
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-xs hover:!border-red-200 hover:!text-danger"
                        disabled={!canEdit || busy}
                        onClick={() =>
                          void removeLink(
                            selectedLinkData.from,
                            selectedLinkData.nodeId,
                            selectedLinkData.nodeLabel || selectedLinkData.label || 'پیوند'
                          )
                        }
                        title={canEdit ? 'حذف پیوند' : 'برای حذف، حالت ویرایش را فعال کنید'}
                      >
                        <Trash2 size={12} />
                        <span className="hidden sm:inline">حذف پیوند</span>
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        onClick={() => setSelectedLink(null)}
                        aria-label="بستن جزئیات پیوند"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  </div>
                ) : null}

                {/* راهنمای حالت اتصال کلیک‌به‌کلیک */}
                {connectMode ? (
                  <div
                    className="absolute bottom-3 left-1/2 z-30 flex max-w-[calc(100%-20px)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-pill border border-brand-200 bg-surface/97 px-3 py-1 text-[10.5px] text-ink-600 shadow-pop"
                    dir="rtl"
                  >
                    <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand-500" aria-hidden />
                    {connectSource != null ? (
                      <span>
                        مبدأ:{' '}
                        <strong className="font-semibold text-ink-800">
                          {positions.get(connectSource)?.name ?? `#${connectSource}`}
                        </strong>{' '}
                        — روی کارت مقصد کلیک کنید
                      </span>
                    ) : (
                      <span>روی کارت مبدأ کلیک کنید، سپس کارت مقصد</span>
                    )}
                    <button
                      type="button"
                      className="btn-ghost btn-xs !py-0.5"
                      onClick={() => {
                        setConnectSource(null);
                        setConnectMode(false);
                      }}
                    >
                      انصراف
                    </button>
                  </div>
                ) : null}

                {/* بازرس موبایل برای کارت انتخاب‌شده؛ جزئیات پیوند در نوار پایین است */}
                {inspector && selectedItem != null && !selectedLinkData ? (
                  <div
                    className="absolute inset-x-0 bottom-0 z-30 max-h-[60%] overflow-y-auto rounded-t-2xl border-t border-ink-200 bg-surface/98 p-3 shadow-pop lg:hidden"
                    dir="rtl"
                  >
                    {inspector}
                  </div>
                ) : null}

                {/* راهنمای تعاملی حالت ویرایش */}
                {canEdit && !connectMode && !selectedLinkData ? (
                  <div
                    className="pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 rounded-pill border border-ink-200 bg-surface/95 px-3 py-1 text-[10.5px] text-ink-500 shadow-soft md:block"
                    dir="rtl"
                  >
                    کارت را بکشید تا جابه‌جا شود · برای اتصال، «حالت اتصال» را روشن کنید یا از نقطه‌های کنار کارت بکشید
                  </div>
                ) : null}

                {error && graph ? (
                  <div
                    className="absolute left-2.5 top-2.5 z-10 flex items-center gap-1 rounded-pill border border-sun-200 bg-sun-50 px-2 py-1 text-[10px] text-warning"
                    dir="rtl"
                  >
                    <AlertTriangle size={11} />
                    {error}
                  </div>
                ) : null}
              </>
            )}
            </div>
            {inspector ? (
              <aside
                className="hidden w-[300px] shrink-0 overflow-y-auto border-s border-ink-100 bg-surface p-3 lg:block"
                dir="rtl"
                aria-label="بازرس ارتباط"
              >
                {inspector}
              </aside>
            ) : null}
          </div>

          {/* پابرگ */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-3 py-1.5 text-[10.5px] text-ink-400">
            <span>
              {mode === 'edit'
                ? 'جابه‌جایی: کشیدن کارت · اتصال: حالت اتصال و کلیک مبدأ/مقصد یا کشیدن از نقطه‌ها · خطوط از هر زاویه به محیط بیضی وصل می‌شوند'
                : 'هاور یا کلیک روی کارت: پررنگ‌شدن ارتباط‌ها · دوبار کلیک: باز کردن · کلیک روی خط: جزئیات · کشیدن پس‌زمینه: جابه‌جایی بوم'}
            </span>
            <span className="num">
              {faDigits(items.length)} کارت · {faDigits(links.length)} پیوند · {autoLayout ? 'چیدمان خودکار' : 'چیدمان آزاد'}
            </span>
          </div>
        </div>
      </div>
    </OverviewUi.Provider>
  );
}

export default function DiagramOverview(props: DiagramOverviewProps) {
  if (!props.open) return null;
  return (
    <ReactFlowProvider>
      <OverviewBoard {...props} />
    </ReactFlowProvider>
  );
}
