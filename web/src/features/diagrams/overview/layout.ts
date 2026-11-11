import { HANDLE_SIDES } from '../../../lib/diagrams';
import type { HandleSide } from '../../../lib/diagrams';
import type { DiagramGraphItem } from '../../../lib/types';
import {
  COL_GAP,
  LAYOUT_KEY,
  NODE_H,
  NODE_W,
  ORPHAN_GAP,
  ROW_GAP,
  type LayoutPrefs,
  type Placed,
  type PositionMap,
} from './model';

export function readLayoutPrefs(): LayoutPrefs {
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
          positions[id] = { x: Math.round(x), y: Math.round(y) };
        }
      }
    }
    return { auto: parsed?.auto !== false, positions };
  } catch {
    return { auto: true, positions: {} };
  }
}

export function writeLayoutPrefs(prefs: LayoutPrefs) {
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
 * چیدمان لایه‌ای با ترتیب‌دهی barycenter:
 * ۱) عمق از ساختار درختی و پیوندهای دستی ساخته می‌شود.
 * ۲) هر ستون چند بار بر اساس میانگین جایگاه والدها/فرزندان مرتب می‌شود تا
 *    خطوط کمتر روی هم بیفتند.
 * ۳) ستون‌ها عمودی وسط‌چین و راست‌به‌چپ مرتب می‌شوند (ریشه در راست).
 */
export function layout(items: DiagramGraphItem[], links: { from: number; to: number }[]): Placed[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const next = new Map<number, Set<number>>();
  const previous = new Map<number, Set<number>>();
  const indegree = new Map<number, number>(items.map((item) => [item.id, 0]));

  /** آیا از start با یال‌های پذیرفته‌شده می‌توان به goal رسید؟ */
  const reaches = (start: number, goal: number): boolean => {
    if (start === goal) return true;
    const stack = [start];
    const seen = new Set<number>([start]);
    while (stack.length) {
      const id = stack.pop() as number;
      for (const to of next.get(id) ?? []) {
        if (to === goal) return true;
        if (seen.has(to)) continue;
        seen.add(to);
        stack.push(to);
      }
    }
    return false;
  };

  // یال فقط وقتی در چیدمان شرکت می‌کند که دور نسازد. پیوندهای متقابل در
  // نقشهٔ ارتباط عادی‌اند؛ اگر همهٔ یال‌ها در عمق‌دهی وارد شوند، مرتب‌سازی
  // توپولوژیک ناقص می‌ماند و همهٔ گره‌ها در یک ستون روی هم می‌افتند.
  const addEdge = (from: number, to: number) => {
    if (from === to || !byId.has(from) || !byId.has(to)) return;
    if (next.get(from)?.has(to)) return;
    if (reaches(to, from)) return;
    const children = next.get(from) ?? new Set<number>();
    children.add(to);
    next.set(from, children);
    const parents = previous.get(to) ?? new Set<number>();
    parents.add(from);
    previous.set(to, parents);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  };

  // اول ساختار درختی تا سلسله‌مراتب اصلی حفظ شود، بعد پیوندهای دستی.
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

  // گراف چیدمان دور ندارد؛ این حلقه فقط برای دادهٔ ناسازگار باقی می‌ماند.
  for (const item of items) {
    if (processed.has(item.id)) continue;
    const known = [...(previous.get(item.id) ?? [])].filter((id) => processed.has(id)).map((id) => depth.get(id) ?? 0);
    depth.set(item.id, known.length ? Math.max(...known) + 1 : 0);
  }

  // دیاگرام‌های بدون هیچ ارتباطی از ستون ریشه‌ها جدا می‌شوند تا با ریشه‌های
  // واقعی قاطی نشوند؛ بعداً در نواری زیر گراف قرار می‌گیرند.
  const linked = new Set<number>();
  for (const [from, targets] of next) {
    for (const to of targets) {
      linked.add(from);
      linked.add(to);
    }
  }

  const columns = new Map<number, DiagramGraphItem[]>();
  for (const item of items) {
    if (!linked.has(item.id)) continue;
    const value = depth.get(item.id) ?? 0;
    const list = columns.get(value) ?? [];
    list.push(item);
    columns.set(value, list);
  }
  const orderedColumns = [...columns.entries()].sort((a, b) => a[0] - b[0]);
  const maxDepth = Math.max(0, ...orderedColumns.map(([value]) => value));

  const positionInColumn = new Map<number, number>();
  for (const [, list] of orderedColumns) {
    list.sort((a, b) => {
      if (a.parentId !== b.parentId) return (a.parentId ?? 0) - (b.parentId ?? 0);
      return a.name.localeCompare(b.name, 'fa');
    });
    list.forEach((item, index) => positionInColumn.set(item.id, index));
  }

  const barycenter = (item: DiagramGraphItem, neighbors: Map<number, Set<number>>) => {
    let sum = 0;
    let count = 0;
    for (const id of neighbors.get(item.id) ?? []) {
      const position = positionInColumn.get(id);
      if (position == null) continue;
      sum += position;
      count += 1;
    }
    return count ? sum / count : (positionInColumn.get(item.id) ?? 0);
  };

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
      // راست‌به‌چپ: ریشه در راست و فرزندان/مقصد پیوندها به سمت چپ.
      placed.push({
        ...item,
        x: (maxDepth - value) * (NODE_W + COL_GAP),
        y: offsetY + index * rowStep,
      });
    });
  }

  const orphans = items.filter((item) => !linked.has(item.id));
  if (orphans.length) {
    const bottom = placed.reduce((max, item) => Math.max(max, item.y + NODE_H), 0);
    const step = NODE_W + COL_GAP;
    orphans.forEach((item, index) => {
      placed.push({
        ...item,
        x: (orphans.length - 1 - index) * step,
        y: bottom + (placed.length ? ORPHAN_GAP : 0),
      });
    });
  }
  return placed;
}

/** سمت‌های طبیعی اتصال بر اساس موقعیت دو کارت. */
export function automaticSides(
  from: { x: number; y: number },
  to: { x: number; y: number }
): { fromSide: HandleSide; toSide: HandleSide } {
  const dx = to.x + NODE_W / 2 - (from.x + NODE_W / 2);
  const dy = to.y + NODE_H / 2 - (from.y + NODE_H / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx < 0 ? { fromSide: 'left', toSide: 'right' } : { fromSide: 'right', toSide: 'left' };
  }
  return dy < 0 ? { fromSide: 'top', toSide: 'bottom' } : { fromSide: 'bottom', toSide: 'top' };
}

export function asSide(value: string | null | undefined): HandleSide | undefined {
  return (HANDLE_SIDES as readonly string[]).includes(String(value)) ? (value as HandleSide) : undefined;
}
