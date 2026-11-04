/**
 * نقشهٔ ارتباط دیاگرام‌ها
 * ----------------------------------------------------------------
 * نمای کلی همهٔ فایل‌های دیاگرام در یک صفحه:
 * • ساختار درختی (زیرمجموعه‌ها) و پیوندهای دستی، با خطوط منحنی خواناتر
 * • ساخت پیوند با کشیدن از نقطهٔ کنار هر کارت روی کارت مقصد
 * • جابه‌جایی کارت‌ها با کشیدن و انتخاب بین «چیدمان خودکار» و «چیدمان آزاد»
 * • پیوندهای شکسته (مقصد حذف‌شده) با امکان پاک کردن از بوم مبدأ
 *
 * چیدمان آزاد در همان مرورگر ذخیره می‌شود؛ چیدمان خودکار از عمق درخت و
 * جهت پیوندها ساخته می‌شود. با چرخ ماوس بزرگ‌نمایی و با کشیدن پس‌زمینه
 * جابه‌جا می‌شود. برای باز کردن هر دیاگرام روی آن کلیک کنید.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  Eye,
  GitBranch,
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
  Workflow,
  X,
} from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { faDigits, fmtRelative } from '../../lib/format';
import { CONNECTION_TYPES, HANDLE_SIDES, connectionType } from '../../lib/diagrams';
import type { HandleSide } from '../../lib/diagrams';
import type {
  DiagramConnectionKind,
  DiagramGraph,
  DiagramGraphBrokenLink,
  DiagramGraphItem,
} from '../../lib/types';

interface Placed extends DiagramGraphItem {
  depth: number;
  x: number;
  y: number;
}

type PositionMap = Record<number, { x: number; y: number }>;

interface LayoutPrefs {
  auto: boolean;
  positions: PositionMap;
}

interface DragState {
  id: number;
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  moved: boolean;
}

interface ConnectState {
  from: number;
  fromSide: HandleSide;
  x: number;
  y: number;
  target: number | null;
  targetSide: HandleSide | null;
}

// اندازهٔ کارت‌ها با حداقل اندازهٔ متن رابط (۱۲px) هماهنگ است؛ ارتفاع ۶۸
// پیکسلی قبلی باعث بریده‌شدن ردیف شمارش/برچسب‌ها می‌شد.
const NODE_W = 232;
const NODE_H = 96;
const COL_GAP = 104;
const ROW_GAP = 32;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
const LAYOUT_KEY = 'nw.diagrams.overview.layout';
const HANDLE_SIZE = 16;

/* ------------------------------------------------------------------ */
/* ذخیرهٔ چیدمان دستی                                                  */
/* ------------------------------------------------------------------ */
function readLayoutPrefs(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return { auto: true, positions: {} };
    const parsed = JSON.parse(raw) as { auto?: unknown; positions?: unknown } | null;
    const positions: PositionMap = {};
    if (parsed?.positions && typeof parsed.positions === 'object') {
      for (const [key, value] of Object.entries(parsed.positions as Record<string, unknown>)) {
        const id = Number(key);
        const x = Number((value as { x?: unknown } | null)?.x);
        const y = Number((value as { y?: unknown } | null)?.y);
        if (Number.isInteger(id) && id > 0 && Number.isFinite(x) && Number.isFinite(y)) {
          positions[id] = { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
        }
      }
    }
    return { auto: parsed?.auto !== false, positions };
  } catch {
    return { auto: true, positions: {} };
  }
}

function writeLayoutPrefs(prefs: LayoutPrefs) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(prefs));
  } catch {
    /* ذخیرهٔ محلی بی‌اثر */
  }
}

/* ------------------------------------------------------------------ */
/* چیدمان خودکار                                                       */
/* ------------------------------------------------------------------ */
/**
 * چیدمان لایه‌ای با ترتیب‌دهی barycenter.
 *
 * ۱) عمق از ساختار درختی و پیوندهای دستی (مرتب‌سازی توپولوژیک) ساخته می‌شود.
 * ۲) گره‌های هر ستون چند بار بر اساس میانگین جایگاه والدها/فرزندان مرتب
 *    می‌شوند تا خطوط کمتر روی هم بیفتند و فرزندان نزدیک والدشان بمانند.
 * ۳) ستون‌ها از نظر عمودی وسط‌چین می‌شوند و فاصلهٔ ثابت دارند؛ نتیجه هم برای
 *    درخت‌های نامتقارن و هم برای چند ریشهٔ مستقل خواناست.
 */
function layout(
  items: DiagramGraphItem[],
  links: { from: number; to: number }[]
): { placed: Placed[]; width: number; height: number } {
  const byId = new Map(items.map((item) => [item.id, item]));
  const next = new Map<number, Set<number>>();
  const previous = new Map<number, Set<number>>();
  const indegree = new Map<number, number>(items.map((item) => [item.id, 0]));

  const addEdge = (from: number, to: number) => {
    if (from === to || !byId.has(from) || !byId.has(to)) return;
    const children = next.get(from) ?? new Set<number>();
    if (children.has(to)) return;
    children.add(to);
    next.set(from, children);
    const parents = previous.get(to) ?? new Set<number>();
    parents.add(from);
    previous.set(to, parents);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  };

  for (const item of items) {
    if (item.parentId != null && byId.has(item.parentId)) addEdge(item.parentId, item.id);
  }
  for (const link of links) addEdge(link.from, link.to);

  const depth = new Map<number, number>(items.map((item) => [item.id, 0]));
  const remaining = new Map(indegree);
  const queue = items.filter((item) => (remaining.get(item.id) ?? 0) === 0).map((item) => item.id);
  const processed = new Set<number>();
  let guard = items.length * 6 + 16;
  while (queue.length && guard-- > 0) {
    const id = queue.shift() as number;
    processed.add(id);
    for (const to of next.get(id) ?? []) {
      depth.set(to, Math.max(depth.get(to) ?? 0, (depth.get(id) ?? 0) + 1));
      const left = (remaining.get(to) ?? 0) - 1;
      remaining.set(to, left);
      if (left === 0) queue.push(to);
    }
  }

  // چرخه‌ها در مرتب‌سازی توپولوژیک خارج می‌مانند؛ به آن‌ها یک لایه بعد از
  // والدهای شناخته‌شده می‌دهیم تا از ستون ریشه جدا شوند.
  for (const item of items) {
    if (processed.has(item.id)) continue;
    const known = [...(previous.get(item.id) ?? [])]
      .filter((id) => processed.has(id))
      .map((id) => depth.get(id) ?? 0);
    depth.set(item.id, known.length ? Math.max(...known) + 1 : 1);
  }

  const columns = new Map<number, DiagramGraphItem[]>();
  for (const item of items) {
    const value = depth.get(item.id) ?? 0;
    const list = columns.get(value) ?? [];
    list.push(item);
    columns.set(value, list);
  }
  const orderedColumns = [...columns.entries()].sort((a, b) => a[0] - b[0]);
  const maxDepth = Math.max(0, ...orderedColumns.map(([value]) => value));

  // جایگاه هر گره در ستون خودش؛ برای میانگین‌گیری در رفت‌وبرگشت‌ها.
  const positionInColumn = new Map<number, number>();
  const setOrder = () => {
    for (const [, list] of orderedColumns) {
      list.forEach((item, index) => positionInColumn.set(item.id, index));
    }
  };
  for (const [, list] of orderedColumns) {
    list.sort((a, b) => {
      if (a.parentId !== b.parentId) return (a.parentId ?? 0) - (b.parentId ?? 0);
      return a.name.localeCompare(b.name, 'fa');
    });
  }
  setOrder();

  const barycenter = (item: DiagramGraphItem, neighbors: Map<number, Set<number>>) => {
    let sum = 0;
    let count = 0;
    for (const id of neighbors.get(item.id) ?? []) {
      const position = positionInColumn.get(id);
      if (position == null) continue;
      sum += position;
      count += 1;
    }
    return count ? sum / count : positionInColumn.get(item.id) ?? 0;
  };

  // چند رفت‌وبرگشت برای کاهش تقاطع‌ها و نزدیک‌کردن فرزند به والد.
  for (let pass = 0; pass < 6; pass += 1) {
    for (let index = 1; index < orderedColumns.length; index += 1) {
      orderedColumns[index][1].sort(
        (a, b) => barycenter(a, previous) - barycenter(b, previous) || a.name.localeCompare(b.name, 'fa')
      );
      orderedColumns[index][1].forEach((item, position) => positionInColumn.set(item.id, position));
    }
    for (let index = orderedColumns.length - 2; index >= 0; index -= 1) {
      orderedColumns[index][1].sort(
        (a, b) => barycenter(a, next) - barycenter(b, next) || a.name.localeCompare(b.name, 'fa')
      );
      orderedColumns[index][1].forEach((item, position) => positionInColumn.set(item.id, position));
    }
  }

  const maxRows = Math.max(1, ...orderedColumns.map(([, list]) => list.length));
  const rowStep = NODE_H + ROW_GAP;
  const placed: Placed[] = [];
  for (const [value, list] of orderedColumns) {
    const offsetY = ((maxRows - list.length) * rowStep) / 2;
    list.forEach((item, index) => {
      // چیدمان راست‌به‌چپ: ریشه در راست و زیرمجموعه/مقصد پیوندها به سمت چپ.
      placed.push({
        ...item,
        depth: value,
        x: (maxDepth - value) * (NODE_W + COL_GAP),
        y: offsetY + index * rowStep,
      });
    });
  }

  return {
    placed,
    width: Math.max(NODE_W, (maxDepth + 1) * (NODE_W + COL_GAP)) + 16,
    height: Math.max(NODE_H, maxRows * rowStep) + 16,
  };
}

/* ------------------------------------------------------------------ */
/* هندسهٔ خطوط                                                        */
/* ------------------------------------------------------------------ */
const SIDE_VECTOR: Record<HandleSide, { x: number; y: number }> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

function sidePoint(item: Placed, side: HandleSide): { x: number; y: number } {
  if (side === 'top') return { x: item.x + NODE_W / 2, y: item.y };
  if (side === 'bottom') return { x: item.x + NODE_W / 2, y: item.y + NODE_H };
  if (side === 'left') return { x: item.x, y: item.y + NODE_H / 2 };
  return { x: item.x + NODE_W, y: item.y + NODE_H / 2 };
}

function automaticSides(from: Placed, to: Placed): { fromSide: HandleSide; toSide: HandleSide } {
  const dx = to.x + NODE_W / 2 - (from.x + NODE_W / 2);
  const dy = to.y + NODE_H / 2 - (from.y + NODE_H / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx < 0
      ? { fromSide: 'left', toSide: 'right' }
      : { fromSide: 'right', toSide: 'left' };
  }
  return dy < 0
    ? { fromSide: 'top', toSide: 'bottom' }
    : { fromSide: 'bottom', toSide: 'top' };
}

/** نزدیک‌ترین لبهٔ کارت به نشانگر؛ برای انتخاب سمت مقصد هنگام رها کردن. */
function nearestSide(item: Placed, x: number, y: number): HandleSide {
  const distances: Record<HandleSide, number> = {
    top: Math.abs(y - item.y),
    bottom: Math.abs(y - (item.y + NODE_H)),
    left: Math.abs(x - item.x),
    right: Math.abs(x - (item.x + NODE_W)),
  };
  return HANDLE_SIDES.reduce((best, side) => (distances[side] < distances[best] ? side : best), 'top');
}

/**
 * خط منحنی بین دو کارت. اگر سمت‌های اتصال ذخیره شده باشند از همان لبه‌ها
 * خارج می‌شوند؛ پیوندهای قدیمی همچنان سمت خودکار و کوتاه‌ترین مسیر را دارند.
 * `offset` برای جدا کردن چند پیوند هم‌مبدأ/هم‌مقصد است.
 */
function linkGeometry(
  from: Placed,
  to: Placed,
  offset = 0,
  fromSide?: HandleSide,
  toSide?: HandleSide
) {
  if (fromSide || toSide) {
    const auto = automaticSides(from, to);
    const startSide = fromSide ?? auto.fromSide;
    const endSide = toSide ?? auto.toSide;
    const start = sidePoint(from, startSide);
    const end = sidePoint(to, endSide);
    const startNormal = SIDE_VECTOR[startSide];
    const endNormal = SIDE_VECTOR[endSide];
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const bend = Math.max(42, Math.min(180, distance * 0.35));
    const startPerp = { x: -startNormal.y, y: startNormal.x };
    const endPerp = { x: -endNormal.y, y: endNormal.x };
    const c1x = start.x + startNormal.x * bend + startPerp.x * offset;
    const c1y = start.y + startNormal.y * bend + startPerp.y * offset;
    const c2x = end.x + endNormal.x * bend + endPerp.x * offset;
    const c2y = end.y + endNormal.y * bend + endPerp.y * offset;
    return {
      d: `M ${start.x} ${start.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`,
      mx: (start.x + 3 * c1x + 3 * c2x + end.x) / 8,
      my: (start.y + 3 * c1y + 3 * c2y + end.y) / 8,
    };
  }

  const fromCx = from.x + NODE_W / 2;
  const fromCy = from.y + NODE_H / 2;
  const toCx = to.x + NODE_W / 2;
  const toCy = to.y + NODE_H / 2;
  const dx = toCx - fromCx;
  const dy = toCy - fromCy;

  let x1: number;
  let y1: number;
  let x2: number;
  let y2: number;
  let c1x: number;
  let c1y: number;
  let c2x: number;
  let c2y: number;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const goingLeft = dx < 0;
    x1 = goingLeft ? from.x : from.x + NODE_W;
    x2 = goingLeft ? to.x + NODE_W : to.x;
    y1 = fromCy;
    y2 = toCy;
    const dir = x2 >= x1 ? 1 : -1;
    const bend = Math.max(46, Math.abs(x2 - x1) * 0.5);
    c1x = x1 + dir * bend;
    c1y = y1 + offset;
    c2x = x2 - dir * bend;
    c2y = y2 + offset;
  } else {
    const goingUp = dy < 0;
    x1 = fromCx;
    x2 = toCx;
    y1 = goingUp ? from.y : from.y + NODE_H;
    y2 = goingUp ? to.y + NODE_H : to.y;
    const dir = y2 >= y1 ? 1 : -1;
    const bend = Math.max(40, Math.abs(y2 - y1) * 0.5);
    c1x = x1 + offset;
    c1y = y1 + dir * bend;
    c2x = x2 + offset;
    c2y = y2 - dir * bend;
  }

  return {
    d: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`,
    mx: (x1 + 3 * c1x + 3 * c2x + x2) / 8,
    my: (y1 + 3 * c1y + 3 * c2y + y2) / 8,
  };
}

/** خط پیش‌نمایش از لبهٔ انتخاب‌شدهٔ کارت مبدأ تا نشانگر ماوس */
function previewGeometry(from: Placed, wx: number, wy: number, fromSide?: HandleSide) {
  if (fromSide) {
    const start = sidePoint(from, fromSide);
    const normal = SIDE_VECTOR[fromSide];
    const distance = Math.hypot(wx - start.x, wy - start.y);
    const bend = Math.max(38, Math.min(150, distance * 0.35));
    return `M ${start.x} ${start.y} C ${start.x + normal.x * bend} ${start.y + normal.y * bend}, ${wx - (wx - start.x) * 0.18} ${wy - (wy - start.y) * 0.18}, ${wx} ${wy}`;
  }
  const cx = from.x + NODE_W / 2;
  const cy = from.y + NODE_H / 2;
  const dx = wx - cx;
  const dy = wy - cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const x1 = dx < 0 ? from.x : from.x + NODE_W;
    const y1 = cy;
    const dir = wx >= x1 ? 1 : -1;
    const bend = Math.max(40, Math.abs(wx - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dir * bend} ${y1}, ${wx - dir * 36} ${wy}, ${wx} ${wy}`;
  }
  const x1 = cx;
  const y1 = dy < 0 ? from.y : from.y + NODE_H;
  const dir = wy >= y1 ? 1 : -1;
  const bend = Math.max(36, Math.abs(wy - y1) * 0.5);
  return `M ${x1} ${y1} C ${x1} ${y1 + dir * bend}, ${wx} ${wy - dir * 36}, ${wx} ${wy}`;
}

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

export default function DiagramOverview({
  open,
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
  const [initialPrefs] = useState(readLayoutPrefs);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [hovered, setHovered] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [linkKind, setLinkKind] = useState<DiagramConnectionKind>('fiber');
  const [cam, setCam] = useState({ x: 24, y: 24, k: 1 });
  const [size, setSize] = useState({ w: 900, h: 480 });
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [sourceId, setSourceId] = useState<number | ''>('');
  const [targetId, setTargetId] = useState<number | ''>('');
  const [linkLabel, setLinkLabel] = useState('');
  const [manual, setManual] = useState<PositionMap>(initialPrefs.positions);
  const [autoLayout, setAutoLayout] = useState(initialPrefs.auto);
  const [dragging, setDragging] = useState<number | null>(null);
  const [panning, setPanning] = useState(false);
  const [connect, setConnect] = useState<ConnectState | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const canEdit = canWrite && mode === 'edit';

  const stageRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const camRef = useRef(cam);
  const manualRef = useRef<PositionMap>(manual);
  const dragRef = useRef<DragState | null>(null);
  const connectRef = useRef<ConnectState | null>(null);
  const boardRef = useRef<{ placed: Placed[]; width: number; height: number }>({
    placed: [],
    width: 0,
    height: 0,
  });
  const placedRef = useRef<Placed[]>([]);

  const items = useMemo(() => graph?.items ?? [], [graph]);
  const links = useMemo(() => graph?.links ?? [], [graph]);
  const autoBoard = useMemo(() => layout(items, links), [items, links]);

  const placed = useMemo(() => {
    if (autoLayout) return autoBoard.placed;
    return autoBoard.placed.map((item) => {
      const saved = manual[item.id];
      return saved ? { ...item, x: saved.x, y: saved.y } : item;
    });
  }, [autoBoard, autoLayout, manual]);

  const board = useMemo(() => {
    const maxX = placed.reduce((max, item) => Math.max(max, item.x + NODE_W), 0);
    const maxY = placed.reduce((max, item) => Math.max(max, item.y + NODE_H), 0);
    return {
      placed,
      width: Math.max(autoBoard.width, maxX + 44),
      height: Math.max(autoBoard.height, maxY + 44),
    };
  }, [autoBoard.height, autoBoard.width, placed]);

  const positions = useMemo(() => new Map(board.placed.map((item) => [item.id, item])), [board]);
  const selectedLinkData = useMemo(() => {
    if (!selectedLink) return null;
    return links.find((link) => `${link.from}:${link.nodeId}` === selectedLink) ?? null;
  }, [links, selectedLink]);

  // پیوندهای هم‌مبدأ/هم‌مقصد با فاصلهٔ عمودی/افقی جدا رسم می‌شوند تا روی
  // هم نیفتند و برچسب هرکدام جدا دیده شود.
  const linkRows = useMemo(() => {
    const totals = new Map<string, number>();
    for (const link of links) {
      const key = `${link.from}:${link.to}`;
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    return links.map((link) => {
      const key = `${link.from}:${link.to}`;
      const index = seen.get(key) ?? 0;
      seen.set(key, index + 1);
      const count = totals.get(key) ?? 1;
      return { link, offset: (index - (count - 1) / 2) * 20 };
    });
  }, [links]);

  // هندلرهای pointer همیشه آخرین مقادیر را می‌خوانند.
  manualRef.current = manual;
  camRef.current = cam;
  placedRef.current = placed;
  boardRef.current = board;

  const persist = useCallback((positions: PositionMap, auto: boolean) => {
    writeLayoutPrefs({ auto, positions });
  }, []);

  const replaceManual = useCallback((next: PositionMap) => {
    manualRef.current = next;
    setManual(next);
  }, []);

  /* ------------------------------ اندازه و زوم ------------------------------ */
  useEffect(() => {
    const el = stageRef.current;
    if (!open || !el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  const fit = useCallback(() => {
    const target = boardRef.current;
    if (!target.placed.length || !size.w || !size.h) return;
    const k = Math.max(
      MIN_ZOOM,
      Math.min((size.w - 40) / target.width, (size.h - 40) / target.height, 1.25)
    );
    setCam({
      k,
      x: (size.w - target.width * k) / 2,
      y: (size.h - target.height * k) / 2,
    });
  }, [size.h, size.w]);

  // با باز شدن نقشه، تغییر اندازهٔ کادر یا اضافه/حذف شدن دیاگرام، نقشه جا می‌شود.
  // جابه‌جایی کارت‌ها عمداً این اثر را فعال نمی‌کند تا نمای کاربر نپرد.
  useEffect(() => {
    if (!open) return;
    fit();
  }, [board.placed.length, fit, open, size.h, size.w]);

  useEffect(() => {
    if (!open || !fitNonce) return;
    fit();
  }, [fit, fitNonce, open]);

  const zoomAt = useCallback(
    (factor: number, mx?: number, my?: number) => {
      setCam((current) => {
        const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.k * factor));
        const px = mx ?? size.w / 2;
        const py = my ?? size.h / 2;
        const ratio = next / current.k;
        return { k: next, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
      });
    },
    [size.h, size.w]
  );

  useEffect(() => {
    const el = stageRef.current;
    if (!open || !el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open, zoomAt]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  // بستن وسط کشیدن/اتصال نباید حالت نیمه‌کاره باقی بگذارد.
  useEffect(() => {
    if (open) return;
    panRef.current = null;
    dragRef.current = null;
    connectRef.current = null;
    setPanning(false);
    setDragging(null);
    setConnect(null);
  }, [open]);

  // خروج از حالت ویرایش نباید اتصال یا کشیدن نیمه‌کاره باقی بگذارد.
  useEffect(() => {
    if (mode === 'edit') return;
    dragRef.current = null;
    connectRef.current = null;
    setDragging(null);
    setConnect(null);
  }, [mode]);

  useEffect(() => {
    if (selectedItem != null && !items.some((item) => item.id === selectedItem)) setSelectedItem(null);
  }, [items, selectedItem]);

  useEffect(() => {
    if (!open) return;
    setSourceId((prev) => {
      if (prev && items.some((item) => item.id === prev)) return prev;
      if (currentId && items.some((item) => item.id === currentId)) return currentId;
      return items[0]?.id ?? '';
    });
  }, [currentId, items, open]);

  useEffect(() => {
    setTargetId((prev) => {
      if (prev && items.some((item) => item.id === prev) && prev !== sourceId) return prev;
      return items.find((item) => item.id !== sourceId)?.id ?? '';
    });
  }, [items, sourceId]);

  /* ------------------------------ پیوندها ------------------------------ */
  const relatedIds = useMemo(() => {
    const set = new Set<number>();
    if (hovered == null) return set;
    set.add(hovered);
    for (const item of items) {
      if (item.parentId === hovered) set.add(item.id);
      if (item.id === hovered && item.parentId != null) set.add(item.parentId);
    }
    for (const link of links) {
      if (link.from === hovered) set.add(link.to);
      if (link.to === hovered) set.add(link.from);
    }
    return set;
  }, [hovered, items, links]);

  const removeLink = useCallback(
    async (from: number, nodeId: string, title: string) => {
      if (!canEdit || busy) return;
      if (
        !window.confirm(
          `پیوند «${title}» حذف شود؟ فقط همین جزء پیوند از بوم دیاگرام مبدأ برداشته می‌شود و به بقیهٔ اجزا کاری ندارد.`
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
    [busy, canEdit, items, onMutated, onNotify, onRefresh]
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
    // فقط وقتی سرور پیوند را پذیرفته فرم بسته می‌شود؛ در خطا (مثلاً تکرار)
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

  /* --------------------------- جابه‌جایی کارت‌ها --------------------------- */
  const beginCardDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, item: Placed) => {
      if (!canEdit || event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      setSelectedItem(item.id);
      setSelectedLink(null);
      const origin = autoLayout
        ? { x: item.x, y: item.y }
        : manualRef.current[item.id] ?? { x: item.x, y: item.y };
      dragRef.current = {
        id: item.id,
        sx: event.clientX,
        sy: event.clientY,
        ox: origin.x,
        oy: origin.y,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(item.id);
    },
    [autoLayout, canEdit]
  );

  const moveCard = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const k = camRef.current.k || 1;
    const dx = (event.clientX - drag.sx) / k;
    const dy = (event.clientY - drag.sy) / k;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    if (!drag.moved) {
      drag.moved = true;
      // اولین حرکت واقعی: چیدمان خودکار «فریز» و به حالت آزاد تبدیل می‌شود
      // تا بقیهٔ کارت‌ها سر جایشان بمانند.
      if (autoLayout) {
        const frozen: PositionMap = {};
        for (const place of placedRef.current) frozen[place.id] = { x: place.x, y: place.y };
        manualRef.current = frozen;
        setAutoLayout(false);
      }
    }
    const next = {
      ...manualRef.current,
      [drag.id]: {
        x: Math.max(0, Math.round(drag.ox + dx)),
        y: Math.max(0, Math.round(drag.oy + dy)),
      },
    };
    manualRef.current = next;
    setManual(next);
  }, [autoLayout]);

  const endCardDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, item: Placed) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDragging(null);
      if (drag.moved) {
        persist(manualRef.current, false);
      } else {
        setSelectedItem(item.id);
        setSelectedLink(null);
      }
    },
    [persist]
  );

  const cancelCardDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(null);
    if (drag?.moved) persist(manualRef.current, false);
  }, [persist]);

  /* --------------------------- اتصال با کشیدن --------------------------- */
  const beginConnect = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, item: Placed, side: HandleSide) => {
      if (!canEdit || busy || event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      const start = sidePoint(item, side);
      const next: ConnectState = {
        from: item.id,
        fromSide: side,
        x: start.x,
        y: start.y,
        target: null,
        targetSide: null,
      };
      connectRef.current = next;
      setConnect(next);
      setSelectedItem(item.id);
      setSelectedLink(null);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [busy, canEdit]
  );

  const moveConnect = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const state = connectRef.current;
    const stage = stageRef.current;
    if (!state || !stage) return;
    const rect = stage.getBoundingClientRect();
    const k = camRef.current.k || 1;
    const wx = (event.clientX - rect.left - camRef.current.x) / k;
    const wy = (event.clientY - rect.top - camRef.current.y) / k;
    const target = placedRef.current.find(
      (place) =>
        place.id !== state.from &&
        wx >= place.x &&
        wx <= place.x + NODE_W &&
        wy >= place.y &&
        wy <= place.y + NODE_H
    );
    const next = {
      ...state,
      x: wx,
      y: wy,
      target: target?.id ?? null,
      targetSide: target ? nearestSide(target, wx, wy) : null,
    };
    connectRef.current = next;
    setConnect(next);
  }, []);

  const endConnect = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const state = connectRef.current;
      connectRef.current = null;
      setConnect(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (state?.target != null) {
        void addLinkBetween(
          state.from,
          state.target,
          undefined,
          linkKind,
          state.fromSide,
          state.targetSide ?? undefined
        );
      }
    },
    [addLinkBetween, linkKind]
  );

  const cancelConnect = useCallback((event?: React.PointerEvent<HTMLButtonElement>) => {
    connectRef.current = null;
    setConnect(null);
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  /* ------------------------------ چیدمان ------------------------------ */
  const enableAuto = useCallback(() => {
    setAutoLayout(true);
    persist(manualRef.current, true);
    setFitNonce((value) => value + 1);
  }, [persist]);

  const enableManual = useCallback(() => {
    if (!autoLayout && Object.keys(manualRef.current).length) return;
    if (!Object.keys(manualRef.current).length) {
      const snapshot: PositionMap = {};
      for (const place of placedRef.current) snapshot[place.id] = { x: place.x, y: place.y };
      manualRef.current = snapshot;
      setManual(snapshot);
      persist(snapshot, false);
    }
    setAutoLayout(false);
    setFitNonce((value) => value + 1);
  }, [autoLayout, persist]);

  const resetLayout = useCallback(() => {
    manualRef.current = {};
    setManual({});
    setAutoLayout(true);
    persist({}, true);
    setFitNonce((value) => value + 1);
  }, [persist]);

  if (!open) return null;

  const needle = query.trim();
  const matches = (item: Placed) =>
    !needle || item.name.includes(needle) || item.description.includes(needle);
  const stats = graph?.stats;
  const matchCount = board.placed.filter(matches).length;
  const connectFrom = connect ? positions.get(connect.from) : null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink-900/30 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="نقشهٔ ارتباط دیاگرام‌ها"
      onClick={onClose}
    >
      <div
        className="flex h-full max-h-[94vh] w-full max-w-[1280px] flex-col overflow-hidden rounded-card border border-white/70 bg-white/97 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* سربرگ */}
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <GitBranch size={16} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-ink-800">نقشهٔ ارتباط دیاگرام‌ها</h2>
            <p className="num text-[10.5px] text-ink-400">
              {faDigits(stats?.diagrams ?? items.length)} دیاگرام · {faDigits(stats?.links ?? 0)} پیوند ·{' '}
              {faDigits(stats?.children ?? 0)} زیرمجموعه · {faDigits(stats?.orphans ?? 0)} بدون ارتباط
            </p>
          </div>
          <div
            className="inline-flex items-center rounded-pill border border-ink-200 bg-white/80 p-0.5"
            role="group"
            aria-label="حالت نقشهٔ ارتباط"
          >
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-pill px-2 py-1 text-[10.5px] font-medium transition ${
                mode === 'view' ? 'bg-white text-brand-700 shadow-soft' : 'text-ink-500'
              }`}
              onClick={() => setMode('view')}
              aria-pressed={mode === 'view'}
              title="فقط مشاهده و انتخاب کارت‌ها؛ بدون تغییر چیدمان یا پیوند"
            >
              <Eye size={11} />
              نمایش
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-pill px-2 py-1 text-[10.5px] font-medium transition ${
                mode === 'edit' ? 'bg-white text-brand-700 shadow-soft' : 'text-ink-500'
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
          <div className="relative ms-auto min-w-[170px]">
            <Search size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="field !rounded-pill !py-1.5 pr-7 text-[11.5px]"
              placeholder="جست‌وجوی نام یا توضیح…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="جست‌وجوی دیاگرام در نقشهٔ ارتباط"
            />
          </div>
          {needle ? (
            <span className="num rounded-pill bg-ink-100 px-2 py-0.5 text-[10px] text-ink-600">
              {faDigits(matchCount)} نتیجه
            </span>
          ) : null}
          <button
            type="button"
            className={`btn-ghost btn-xs ${showCreate ? '!border-brand-300 !bg-brand-50 !text-brand-700' : ''}`}
            onClick={() => setShowCreate((value) => !value)}
            disabled={!canEdit || items.length < 2}
            title={
              canEdit
                ? 'ساخت پیوند جدید بین دو دیاگرام'
                : 'برای ساخت پیوند، حالت ویرایش را فعال کنید'
            }
          >
            <Link2 size={13} />
            پیوند تازه
          </button>
          <button type="button" className="btn-ghost btn-xs" onClick={onRefresh} disabled={loading} title="بازخوانی ارتباط‌ها">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button type="button" className="btn-ghost btn-xs" onClick={onClose} aria-label="بستن">
            <X size={15} />
          </button>
        </div>

        {/* ساخت پیوند با فرم (علاوه بر کشیدن از دستگیرهٔ کارت‌ها) */}
        {showCreate && canEdit ? (
          <div className="flex flex-wrap items-end gap-2 border-b border-ink-100 bg-brand-50/40 px-4 py-2" dir="rtl">
            <label className="flex min-w-[150px] flex-1 flex-col gap-0.5 text-[10px] text-ink-500">
              دیاگرام مبدأ
              <select
                className="field !py-1 text-[11.5px]"
                value={sourceId}
                onChange={(e) => setSourceId(Number(e.target.value))}
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[150px] flex-1 flex-col gap-0.5 text-[10px] text-ink-500">
              دیاگرام مقصد
              <select
                className="field !py-1 text-[11.5px]"
                value={targetId}
                onChange={(e) => setTargetId(Number(e.target.value))}
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
            <label className="flex min-w-[160px] flex-[1.4] flex-col gap-0.5 text-[10px] text-ink-500">
              برچسب روی بوم (اختیاری)
              <input
                className="field !py-1 text-[11.5px]"
                value={linkLabel}
                placeholder="مثلاً اتصال به مرکز مخابرات"
                maxLength={120}
                onChange={(e) => setLinkLabel(e.target.value)}
              />
            </label>
            <label className="flex min-w-[125px] flex-col gap-0.5 text-[10px] text-ink-500">
              نوع ارتباط
              <select
                className="field !py-1 text-[11.5px]"
                value={linkKind}
                onChange={(e) => setLinkKind(e.target.value as DiagramConnectionKind)}
              >
                {CONNECTION_TYPES.map((type) => (
                  <option key={type.kind} value={type.kind}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-primary btn-xs" onClick={() => void createLink()} disabled={busy || !targetId}>
              <Plus size={12} />
              {busy ? 'در حال ساخت…' : 'ساخت پیوند'}
            </button>
            <p className="w-full text-[10px] leading-4 text-ink-400">
              سریع‌تر: از هر یک از چهار نقطهٔ کنار کارت به سمت کارت مقصد بکشید. نوع ارتباط بعدی از همین فهرست انتخاب
              می‌شود و پیوند به‌صورت یک جزء مستقل روی بوم مبدأ ساخته می‌شود.
            </p>
          </div>
        ) : null}

        {/* راهنما و ابزار چیدمان/زوم */}
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-4 py-1.5 text-[10.5px] text-ink-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0 w-5 border-t-2 border-dashed border-ink-400" aria-hidden />
            زیرمجموعه
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-0.5 w-5"
              style={{ background: connectionType(linkKind).color }}
              aria-hidden
            />
            {connectionType(linkKind).label}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-brand-500 bg-brand-100" aria-hidden />
            دیاگرام جاری
          </span>
          {stats?.broken ? (
            <span className="inline-flex items-center gap-1 text-sun-700">
              <AlertTriangle size={12} />
              {faDigits(stats.broken)} پیوند شکسته
            </span>
          ) : null}
          {canEdit ? (
            <label className="inline-flex items-center gap-1 rounded-pill border border-ink-200 bg-white/80 px-2 py-1">
              <span className="text-[10px] text-ink-400">نوع پیوند</span>
              <select
                className="bg-transparent text-[10.5px] font-medium text-ink-700 outline-none"
                value={linkKind}
                onChange={(e) => setLinkKind(e.target.value as DiagramConnectionKind)}
                aria-label="نوع ارتباط پیوند جدید"
              >
                {CONNECTION_TYPES.map((type) => (
                  <option key={type.kind} value={type.kind}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canEdit ? <span className="flex items-center gap-0.5 rounded-pill bg-ink-50 p-0.5" dir="rtl">
            <button
              type="button"
              className={`btn-ghost btn-xs ${autoLayout ? '!border-brand-300 !bg-white !text-brand-700 shadow-soft' : ''}`}
              onClick={enableAuto}
              title="چیدمان خودکار بر اساس ساختار درخت و جهت پیوندها"
              aria-pressed={autoLayout}
            >
              <LayoutGrid size={12} />
              خودکار
            </button>
            <button
              type="button"
              className={`btn-ghost btn-xs ${!autoLayout ? '!border-sky-300 !bg-white !text-sky-700 shadow-soft' : ''}`}
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
          </span> : null}
          <span className="ms-auto flex items-center gap-1">
            <button type="button" className="btn-ghost btn-xs" onClick={() => zoomAt(1.2)} title="بزرگ‌نمایی" aria-label="بزرگ‌نمایی">
              <Plus size={12} />
            </button>
            <button type="button" className="btn-ghost btn-xs" onClick={() => zoomAt(1 / 1.2)} title="کوچک‌نمایی" aria-label="کوچک‌نمایی">
              <Minus size={12} />
            </button>
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => setFitNonce((value) => value + 1)}
              title="جا دادن نقشه در کادر"
            >
              <Maximize2 size={12} />
              جا دادن
            </button>
            <span className="num ms-1 text-[10px] text-ink-400">{faDigits(Math.round(cam.k * 100))}٪</span>
          </span>
        </div>

        {/* بوم */}
        <div
          ref={stageRef}
          className="relative min-h-0 flex-1 touch-none overflow-hidden bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:22px_22px]"
          style={{ cursor: panning ? 'grabbing' : connect ? 'crosshair' : 'grab' }}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('[data-no-pan]')) return;
            setSelectedItem(null);
            setSelectedLink(null);
            panRef.current = { x: e.clientX, y: e.clientY, vx: camRef.current.x, vy: camRef.current.y };
            setPanning(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const pan = panRef.current;
            if (!pan) return;
            setCam((current) => ({ ...current, x: pan.vx + (e.clientX - pan.x), y: pan.vy + (e.clientY - pan.y) }));
          }}
          onPointerUp={() => {
            panRef.current = null;
            setPanning(false);
          }}
          onPointerCancel={() => {
            panRef.current = null;
            setPanning(false);
          }}
        >
          {loading && !graph ? (
            <p className="py-20 text-center text-[12px] text-ink-400">در حال خواندن ارتباط دیاگرام‌ها…</p>
          ) : error && !graph ? (
            <div className="grid h-full place-items-center p-6 text-center">
              <div>
                <AlertTriangle size={26} className="mx-auto text-red-500" />
                <p className="mt-2 text-[12.5px] text-ink-600">{error}</p>
                <button type="button" className="btn-ghost btn-xs mt-3" onClick={onRefresh}>
                  <RefreshCw size={12} />
                  تلاش دوباره
                </button>
              </div>
            </div>
          ) : board.placed.length === 0 ? (
            <p className="py-20 text-center text-[12px] text-ink-400">هنوز دیاگرامی ساخته نشده است.</p>
          ) : (
            <div
              className="absolute origin-top-left"
              style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`, width: board.width, height: board.height }}
              dir="rtl"
            >
              <svg width={board.width} height={board.height} className="absolute inset-0 overflow-visible" aria-hidden>
                <defs>
                  {CONNECTION_TYPES.map((type) => (
                    <marker
                      key={type.kind}
                      id={`nw-diagram-arrow-${type.kind}`}
                      markerWidth="9"
                      markerHeight="9"
                      refX="8"
                      refY="4.5"
                      orient="auto"
                    >
                      <path d="M0,0 L9,4.5 L0,9 z" fill={type.color} />
                    </marker>
                  ))}
                </defs>

                {/* ساختار درختی */}
                {board.placed.map((item) => {
                  const parent = item.parentId != null ? positions.get(item.parentId) : null;
                  if (!parent) return null;
                  const dim = hovered != null && !(relatedIds.has(item.id) && relatedIds.has(parent.id));
                  return (
                    <path
                      key={`p-${item.id}`}
                      d={linkGeometry(parent, item).d}
                      fill="none"
                      stroke="#94a3b8"
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      strokeLinecap="round"
                      opacity={dim ? 0.18 : 0.9}
                    />
                  );
                })}

                {/* پیوندهای دستی */}
                {linkRows.map(({ link, offset }) => {
                  const from = positions.get(link.from);
                  const to = positions.get(link.to);
                  if (!from || !to) return null;
                  const meta = connectionType(link.kind);
                  const geo = linkGeometry(from, to, offset, link.fromSide, link.toSide);
                  const active = selectedLink === `${link.from}:${link.nodeId}`;
                  const dim = hovered != null && !(relatedIds.has(link.from) && relatedIds.has(link.to));
                  return (
                    <g key={`l-${link.from}-${link.nodeId}`} opacity={dim ? 0.15 : 1}>
                      {/* هالهٔ سفید برای خوانایی روی شبکهٔ نقطه‌چین */}
                      <path d={geo.d} fill="none" stroke="#ffffff" strokeWidth={active ? 8 : 5.5} strokeLinecap="round" />
                      <path
                        d={geo.d}
                        fill="none"
                        stroke={meta.color}
                        strokeWidth={active ? meta.width + 1.2 : meta.width}
                        strokeDasharray={meta.dash || undefined}
                        strokeLinecap="round"
                        markerEnd={`url(#nw-diagram-arrow-${meta.kind})`}
                      />
                      <path
                        d={geo.d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={18}
                        style={{ cursor: 'pointer' }}
                        data-no-pan
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedItem(null);
                          setSelectedLink(`${link.from}:${link.nodeId}`);
                        }}
                      />
                    </g>
                  );
                })}

                {/* پیش‌نمایش اتصال در حال کشیدن */}
                {connect && connectFrom ? (
                  <g className="pointer-events-none">
                    <path
                      d={previewGeometry(connectFrom, connect.x, connect.y, connect.fromSide)}
                      fill="none"
                      stroke={connectionType(linkKind).color}
                      strokeWidth={2.4}
                      strokeDasharray={connectionType(linkKind).dash || '7 5'}
                      strokeLinecap="round"
                      markerEnd={`url(#nw-diagram-arrow-${connectionType(linkKind).kind})`}
                    />
                    <circle
                      cx={connect.x}
                      cy={connect.y}
                      r={connect.target != null ? 7 : 5}
                      fill={connect.target != null ? '#059669' : '#0ea5e9'}
                      stroke="#ffffff"
                      strokeWidth={2.5}
                    />
                  </g>
                ) : null}
              </svg>

              {/* کارت دیاگرام‌ها */}
              {board.placed.map((item) => {
                const active = item.id === currentId;
                const selectedCard = item.id === selectedItem;
                const dim = !matches(item) || (hovered != null && !relatedIds.has(item.id));
                const isTarget = connect?.target === item.id;
                return (
                  <React.Fragment key={item.id}>
                    <button
                      type="button"
                      data-no-pan
                      onPointerDown={(event) => beginCardDrag(event, item)}
                      onPointerMove={moveCard}
                      onPointerUp={(event) => endCardDrag(event, item)}
                      onPointerCancel={cancelCardDrag}
                      onMouseEnter={() => setHovered(item.id)}
                      onMouseLeave={() => setHovered((value) => (value === item.id ? null : value))}
                      onClick={(event) => {
                        // در حالت ویرایش، کلیک ماوس در pointerup مدیریت می‌شود؛
                        // فقط کلیک صفحه‌کلید یا حالت نمایش باید انتخاب کند.
                        if (event.detail === 0 || !canEdit) {
                          setSelectedItem(item.id);
                          setSelectedLink(null);
                        }
                      }}
                      className={`absolute flex flex-col items-start justify-center gap-1 overflow-hidden rounded-xl border bg-white px-3 pe-12 py-2 text-right transition ${
                        active ? 'border-brand-400 ring-2 ring-brand-200' : 'border-ink-200'
                      } ${selectedCard ? '!border-sky-500 ring-2 ring-sky-200' : ''} ${
                        isTarget ? '!border-emerald-500 ring-2 ring-emerald-300' : ''
                      } ${
                        dragging === item.id
                          ? 'z-20 cursor-grabbing shadow-pop'
                          : canEdit
                            ? 'cursor-grab shadow-soft hover:shadow-pop'
                            : 'cursor-pointer shadow-soft hover:shadow-pop'
                      } ${dim ? 'opacity-30' : ''}`}
                      style={{ left: item.x, top: item.y, width: NODE_W, height: NODE_H }}
                      title={`${item.name} — کلیک برای انتخاب${
                        canEdit ? ' · برای جابه‌جایی بکشید' : ' · برای ورود از دکمهٔ ورود استفاده کنید'
                      }`}
                      aria-label={`انتخاب دیاگرام ${item.name}`}
                      aria-pressed={selectedCard}
                    >
                      <span className="flex w-full items-center gap-1">
                        <Workflow size={12} className={active ? 'text-brand-600' : 'text-ink-400'} />
                        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-800">{item.name}</span>
                        {item.brokenLinks ? <AlertTriangle size={11} className="shrink-0 text-sun-600" /> : null}
                      </span>
                      <span className="num flex w-full items-center gap-1.5 text-[9.5px] text-ink-400">
                        <span>{faDigits(item.nodeCount)} جزء</span>
                        <span aria-hidden>·</span>
                        <span>{faDigits(item.edgeCount)} ارتباط</span>
                        <span className="ms-auto truncate">{fmtRelative(item.updatedAt)}</span>
                      </span>
                      <span className="flex w-full items-center gap-1 text-[9px]">
                        {item.childCount ? (
                          <span className="rounded-pill bg-ink-100 px-1.5 text-ink-500">{faDigits(item.childCount)} زیرمجموعه</span>
                        ) : null}
                        {item.outLinks ? (
                          <span className="rounded-pill bg-sky-50 px-1.5 text-sky-700">{faDigits(item.outLinks)} خروجی</span>
                        ) : null}
                        {item.inLinks ? (
                          <span className="rounded-pill bg-emerald-50 px-1.5 text-emerald-700">{faDigits(item.inLinks)} ورودی</span>
                        ) : null}
                        {!item.childCount && !item.inLinks && !item.outLinks && item.parentId == null ? (
                          <span className="rounded-pill bg-ink-50 px-1.5 text-ink-400">بدون ارتباط</span>
                        ) : null}
                      </span>
                    </button>

                    {/* دکمهٔ ورود مستقل از انتخاب کارت؛ کلیک روی بدنه فقط انتخاب می‌کند. */}
                    <button
                      type="button"
                      data-no-pan
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(item.id);
                      }}
                      className="absolute z-20 inline-flex items-center gap-0.5 rounded-md border border-sky-200 bg-white/95 px-1 py-0.5 text-[9px] font-medium text-sky-700 shadow-soft transition hover:border-sky-400 hover:bg-sky-50"
                      style={{ left: item.x + 5, top: item.y + 5 }}
                      title={`ورود به دیاگرام «${item.name}»`}
                      aria-label={`ورود به دیاگرام ${item.name}`}
                    >
                      <ExternalLink size={9} />
                      ورود
                    </button>

                    {/* چهار دستگیرهٔ اتصال؛ هر سمت را می‌توان به کارت مقصد کشید. */}
                    {canEdit && items.length > 1
                      ? HANDLE_SIDES.map((side) => {
                          const point = sidePoint(item, side);
                          const sourceActive = connect?.from === item.id && connect.fromSide === side;
                          return (
                            <button
                              key={`${item.id}-${side}`}
                              type="button"
                              data-no-pan
                              title={`اتصال از سمت ${side === 'top' ? 'بالا' : side === 'right' ? 'راست' : side === 'bottom' ? 'پایین' : 'چپ'} به دیاگرام دیگر`}
                              aria-label={`اتصال دیاگرام ${item.name} از سمت ${side} به دیاگرام دیگر`}
                              onPointerDown={(event) => beginConnect(event, item, side)}
                              onPointerMove={moveConnect}
                              onPointerUp={endConnect}
                              onPointerCancel={cancelConnect}
                              onClick={(event) => event.stopPropagation()}
                              className={`absolute z-10 grid place-items-center rounded-full border-2 border-white shadow-soft transition hover:scale-125 ${
                                sourceActive ? 'ring-2 ring-sky-300' : ''
                              }`}
                              style={{
                                left: point.x - HANDLE_SIZE / 2,
                                top: point.y - HANDLE_SIZE / 2,
                                width: HANDLE_SIZE,
                                height: HANDLE_SIZE,
                                background: connectionType(linkKind).color,
                              }}
                            >
                              <span className="h-1 w-1 rounded-full bg-white" aria-hidden />
                            </button>
                          );
                        })
                      : null}
                  </React.Fragment>
                );
              })}

              {/* برچسب روی پیوندها */}
              {linkRows.map(({ link, offset }) => {
                const from = positions.get(link.from);
                const to = positions.get(link.to);
                if (!from || !to) return null;
                const meta = connectionType(link.kind);
                const geo = linkGeometry(from, to, offset, link.fromSide, link.toSide);
                const active = selectedLink === `${link.from}:${link.nodeId}`;
                const dim = hovered != null && !(relatedIds.has(link.from) && relatedIds.has(link.to));
                return (
                  <button
                    key={`label-${link.from}:${link.nodeId}`}
                    type="button"
                    data-no-pan
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedItem(null);
                      setSelectedLink(`${link.from}:${link.nodeId}`);
                    }}
                    className={`absolute max-w-[210px] truncate rounded-pill border px-2 py-0.5 text-[10px] shadow-soft transition ${
                      active ? 'text-white' : 'bg-white hover:brightness-[0.98]'
                    } ${dim ? 'opacity-30' : ''}`}
                    style={{
                      left: geo.mx,
                      top: geo.my,
                      transform: 'translate(-50%, -50%)',
                      ...(active
                        ? { background: meta.color, borderColor: meta.color }
                        : { borderColor: `${meta.color}66`, color: meta.color }),
                    }}
                    title={`${meta.label} · ${link.nodeLabel || 'پیوند'} — برای مدیریت کلیک کنید`}
                  >
                    {meta.label} · {link.nodeLabel || 'پیوند'}
                  </button>
                );
              })}
            </div>
          )}

          {/* مدیریت پیوند انتخاب‌شده */}
          {selectedLinkData ? (
            <div
              data-no-pan
              className="absolute inset-x-2 bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-white/97 px-2.5 py-1.5 shadow-pop"
              style={{ borderColor: `${connectionType(selectedLinkData.kind).color}66` }}
            >
              <span className="flex items-center gap-1 text-[11px] text-ink-600">
                <Link2 size={12} className="text-sky-600" />
                <strong className="font-semibold text-ink-800">
                  {positions.get(selectedLinkData.from)?.name ?? `#${selectedLinkData.from}`}
                </strong>
                به
                <strong className="font-semibold text-ink-800">
                  {positions.get(selectedLinkData.to)?.name ?? `#${selectedLinkData.to}`}
                </strong>
                {selectedLinkData.nodeLabel ? (
                  <span className="text-ink-400">({selectedLinkData.nodeLabel})</span>
                ) : null}
              </span>
              {canEdit ? (
                <label className="inline-flex items-center gap-1 rounded-pill border border-ink-200 bg-white px-1.5 py-0.5">
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
                    onChange={(e) => void changeLinkKind(e.target.value as DiagramConnectionKind)}
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
                  باز کردن مبدأ
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-xs hover:!border-red-200 hover:!text-red-600"
                  disabled={!canEdit || busy}
                  onClick={() =>
                    void removeLink(
                      selectedLinkData.from,
                      selectedLinkData.nodeId,
                      selectedLinkData.nodeLabel || selectedLinkData.label || 'پیوند'
                    )
                  }
                >
                  <Trash2 size={12} />
                  حذف پیوند
                </button>
                <button type="button" className="btn-ghost btn-xs" onClick={() => setSelectedLink(null)} aria-label="بستن">
                  <X size={12} />
                </button>
              </span>
            </div>
          ) : null}

          {/* پیوندهای شکسته */}
          {(graph?.broken?.length ?? 0) > 0 ? (
            <div
              data-no-pan
              className="absolute inset-x-2 top-2 z-10 max-h-28 overflow-auto rounded-xl border border-sun-200 bg-sun-50/95 px-2.5 py-1.5 shadow-soft"
            >
              <p className="flex items-center gap-1 text-[10.5px] font-semibold text-sun-800">
                <AlertTriangle size={12} />
                پیوند به دیاگرام حذف‌شده
              </p>
              <ul className="mt-1 space-y-1">
                {(graph?.broken ?? []).map((link: DiagramGraphBrokenLink) => (
                  <li key={`${link.from}:${link.nodeId}`} className="flex flex-wrap items-center gap-1.5 text-[10px] text-sun-900">
                    <span className="font-semibold">{link.fromName}</span>
                    <span className="text-sun-700">→ دیاگرام #{faDigits(link.to)}</span>
                    {link.nodeLabel ? <span className="text-sun-600">({link.nodeLabel})</span> : null}
                    <button
                      type="button"
                      className="btn-ghost btn-xs ms-auto !py-0.5 hover:!border-red-200 hover:!text-red-600"
                      disabled={!canEdit || busy}
                      onClick={() => void removeLink(link.from, link.nodeId, link.nodeLabel || link.fromName)}
                    >
                      <Trash2 size={10} />
                      پاک کردن
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* پابرگ */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-4 py-2 text-[10.5px] text-ink-400">
          <span>
            {connect
              ? 'نشانگر را روی کارت مقصد رها کنید تا پیوند ساخته شود.'
              : canEdit
                ? 'کلیک روی کارت: انتخاب · دکمهٔ ورود: باز کردن دیاگرام · کشیدن از چهار نقطه: اتصال · چرخ ماوس: بزرگ‌نمایی'
                : 'کلیک روی کارت: انتخاب · دکمهٔ ورود: باز کردن دیاگرام · کشیدن پس‌زمینه: جابه‌جایی · چرخ ماوس: بزرگ‌نمایی'}
          </span>
          <span className="num">
            حالت: {mode === 'edit' ? 'ویرایش' : 'نمایش'} · چیدمان: {autoLayout ? 'خودکار' : 'آزاد'} ·{' '}
            {faDigits(items.length)} کارت
          </span>
          <button type="button" className="btn-ghost btn-xs" onClick={onClose}>
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}

