/**
 * NetWatch — چیدمان خودکار بوم دیاگرام
 * ----------------------------------------------------------------
 * این ماژول فقط هندسه را تغییر می‌دهد: شناسه، نوع، داده و ارتباط‌ها دست‌نخورده
 * می‌مانند و هیچ یالی بر اساس مجاورت ساخته نمی‌شود. چیدمان روی یال‌های واقعی
 * ثبت‌شده انجام می‌شود و گره‌های قفل‌شده (و اعضای گروه قفل‌شده) سر جای خود
 * می‌مانند.
 *
 * سه حالت:
 *  • hierarchical — لایه‌ها از بالا به پایین
 *  • horizontal   — لایه‌ها از راست به چپ
 *  • grouped      — هر گروه یک خوشهٔ مستقل است و خوشه‌ها کنار هم می‌نشینند
 */
import type { DiagramFlowEdge, DiagramFlowNode } from './diagrams';

export type AutoLayoutMode = 'hierarchical' | 'horizontal' | 'grouped';

export interface AutoLayoutOptions {
  mode: AutoLayoutMode;
  /** فاصلهٔ افقی بین گره‌های یک لایه */
  gap?: number;
  /** فاصلهٔ بین لایه‌ها */
  layerGap?: number;
  /** حاشیهٔ داخلی کادر گروه */
  padding?: number;
}

interface Size {
  width: number;
  height: number;
}

interface Rect extends Size {
  x: number;
  y: number;
}

interface Packed {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

const DEFAULT_GAP = 48;
const DEFAULT_LAYER_GAP = 86;
const GROUP_PADDING = 24;
const GROUP_TITLE = 34;
const MAX_ROW_WIDTH = 1600;

function sizeOf(node: DiagramFlowNode): Size {
  return {
    width: node.width ?? node.measured?.width ?? (node.type === 'group' ? 360 : 190),
    height: node.height ?? node.measured?.height ?? (node.type === 'group' ? 260 : 86),
  };
}

function rectOf(node: DiagramFlowNode): Rect {
  const size = sizeOf(node);
  return { x: node.position.x, y: node.position.y, ...size };
}

function isGroup(node: DiagramFlowNode): boolean {
  return node.type === 'group';
}

/** یال‌های یکتا بین گره‌های موجود؛ ترتیب مبدأ→مقصد برای لایه‌بندی حفظ می‌شود. */
function uniquePairs(nodes: DiagramFlowNode[], edges: DiagramFlowEdge[]): { source: string; target: string }[] {
  const ids = new Set(nodes.map((node) => node.id));
  const seen = new Set<string>();
  const pairs: { source: string; target: string }[] = [];
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue;
    const key = `${edge.source}\u0000${edge.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ source: edge.source, target: edge.target });
  }
  return pairs;
}

/**
 * لایهٔ هر گره با مرتب‌سازی توپولوژیک. گره‌های درون حلقه به‌جای تولید لایهٔ
 * بی‌پایان، بعد از آخرین پیش‌نیاز شناخته‌شده قرار می‌گیرند.
 */
function computeLayers(nodes: DiagramFlowNode[], pairs: { source: string; target: string }[]): Map<string, number> {
  const ids = nodes.map((node) => node.id);
  const idSet = new Set(ids);
  const indegree = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  for (const pair of pairs) {
    if (!idSet.has(pair.source) || !idSet.has(pair.target)) continue;
    outgoing.get(pair.source)!.push(pair.target);
    indegree.set(pair.target, (indegree.get(pair.target) ?? 0) + 1);
  }

  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0).sort();
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
    queue.sort();
  }

  const layer = new Map(ids.map((id) => [id, 0]));
  for (const id of order) {
    for (const next of outgoing.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, (layer.get(id) ?? 0) + 1));
    }
  }

  const ordered = new Set(order);
  const incoming = new Map(ids.map((id) => [id, [] as string[]]));
  for (const pair of pairs) incoming.get(pair.target)?.push(pair.source);
  for (const id of ids) {
    if (ordered.has(id)) continue;
    const known = (incoming.get(id) ?? [])
      .map((source) => layer.get(source))
      .filter((value): value is number => typeof value === 'number');
    layer.set(id, known.length ? Math.max(...known) + 1 : 0);
  }
  return layer;
}

/** مرتب‌سازی درون لایه‌ها با میانگین جایگاه همسایه‌ها برای کاهش تقاطع. */
function orderLayers(
  nodes: DiagramFlowNode[],
  pairs: { source: string; target: string }[]
): Map<number, DiagramFlowNode[]> {
  const layers = computeLayers(nodes, pairs);
  const byLayer = new Map<number, DiagramFlowNode[]>();
  const index = new Map(nodes.map((node, position) => [node.id, position]));
  for (const node of nodes) {
    const key = layers.get(node.id) ?? 0;
    const list = byLayer.get(key) ?? [];
    list.push(node);
    byLayer.set(key, list);
  }
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const pair of pairs) {
    incoming.set(pair.target, [...(incoming.get(pair.target) ?? []), pair.source]);
    outgoing.set(pair.source, [...(outgoing.get(pair.source) ?? []), pair.target]);
  }
  const keys = [...byLayer.keys()].sort((a, b) => a - b);
  for (const list of byLayer.values()) list.sort((a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0));

  const orderPass = (keyList: number[], neighborMap: Map<string, string[]>) => {
    for (const key of keyList) {
      const list = byLayer.get(key) ?? [];
      const positionsInRow = new Map(list.map((node, position) => [node.id, position]));
      const score = new Map<string, number>();
      for (const node of list) {
        const neighbors = (neighborMap.get(node.id) ?? [])
          .filter((id) => layers.get(id) === key + (neighborMap === incoming ? -1 : 1))
          .map((id) => positionsInRow.get(id))
          .filter((value): value is number => typeof value === 'number');
        score.set(node.id, neighbors.length ? neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length : Number.POSITIVE_INFINITY);
      }
      list.sort((a, b) => (score.get(a.id) ?? 0) - (score.get(b.id) ?? 0));
    }
  };
  orderPass(keys.slice(1), incoming);
  orderPass([...keys].reverse().slice(1), outgoing);

  return byLayer;
}

/** چیدمان لایه‌ای؛ محور اصلی عمودی یا افقی و هر لایه یک ردیف/ستون است. */
function packLayered(
  nodes: DiagramFlowNode[],
  pairs: { source: string; target: string }[],
  vertical: boolean,
  gap: number,
  layerGap: number
): Packed {
  if (!nodes.length) return { positions: new Map(), width: 0, height: 0 };
  if (!pairs.length) return packGrid(nodes, gap);

  const byLayer = orderLayers(nodes, pairs);
  const keys = [...byLayer.keys()].sort((a, b) => a - b);
  const positions = new Map<string, { x: number; y: number }>();

  const layerSpans = new Map<number, number>();
  for (const key of keys) {
    const list = byLayer.get(key) ?? [];
    layerSpans.set(
      key,
      list.reduce((sum, node, position) => {
        const size = sizeOf(node);
        return sum + (vertical ? size.width : size.height) + (position ? gap : 0);
      }, 0)
    );
  }
  const widest = Math.max(...layerSpans.values(), 0);
  let cursor = 0;
  let cross = 0;
  for (const key of keys) {
    const list = byLayer.get(key) ?? [];
    const span = layerSpans.get(key) ?? 0;
    const thickness = Math.max(...list.map((node) => (vertical ? sizeOf(node).height : sizeOf(node).width)), 0);
    let offset = (vertical ? 0 : 0) + (widest - span) / 2;
    for (const node of list) {
      const size = sizeOf(node);
      positions.set(
        node.id,
        vertical
          ? { x: Math.round(offset), y: Math.round(cursor + (thickness - size.height) / 2) }
          : { x: Math.round(cursor + (thickness - size.width) / 2), y: Math.round(offset) }
      );
      offset += (vertical ? size.width : size.height) + gap;
    }
    cursor += thickness + layerGap;
    cross = Math.max(cross, span);
  }
  return vertical
    ? { positions, width: widest, height: Math.max(0, cursor - layerGap) }
    : { positions, width: Math.max(0, cursor - layerGap), height: widest };
}

/** چیدمان شبکه‌ای برای بوم بدون ارتباط یا خوشهٔ بدون یال. */
function packGrid(nodes: DiagramFlowNode[], gap: number): Packed {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const positions = new Map<string, { x: number; y: number }>();
  const columnWidths: number[] = [];
  const rowHeights: number[] = [];
  nodes.forEach((node, position) => {
    const column = position % columns;
    const row = Math.floor(position / columns);
    const size = sizeOf(node);
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, size.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, size.height);
  });
  const columnOffsets: number[] = [];
  columnWidths.reduce((sum, width, column) => {
    columnOffsets[column] = sum;
    return sum + width + gap;
  }, 0);
  const rowOffsets: number[] = [];
  rowHeights.reduce((sum, height, row) => {
    rowOffsets[row] = sum;
    return sum + height + gap;
  }, 0);

  nodes.forEach((node, position) => {
    const column = position % columns;
    const row = Math.floor(position / columns);
    const size = sizeOf(node);
    positions.set(node.id, {
      x: Math.round((columnOffsets[column] ?? 0) + (columnWidths[column] - size.width) / 2),
      y: Math.round((rowOffsets[row] ?? 0) + (rowHeights[row] - size.height) / 2),
    });
  });
  return {
    positions,
    width: Math.max(0, columnOffsets.reduce((sum, value, column) => sum + columnWidths[column], 0) + (columns - 1) * gap),
    height: Math.max(0, rowOffsets.reduce((sum, value, row) => sum + rowHeights[row], 0) + (rowHeights.length - 1) * gap),
  };
}

function overlaps(a: Rect, b: Rect, margin = 12): boolean {
  return (
    a.x < b.x + b.width + margin &&
    a.x + a.width + margin > b.x &&
    a.y < b.y + b.height + margin &&
    a.y + a.height + margin > b.y
  );
}

/** گره‌های قفل‌شده را سر جایشان نگه می‌دارد و از هم‌پوشانی با آن‌ها دوری می‌کند. */
function applyPositions(
  nodes: DiagramFlowNode[],
  positions: Map<string, { x: number; y: number }>,
  fixedIds: Set<string>,
  vertical: boolean,
  gap: number
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  const occupied: Rect[] = [];
  for (const node of nodes) {
    if (fixedIds.has(node.id)) {
      result.set(node.id, { ...node.position });
      occupied.push({ ...rectOf(node) });
    }
  }
  for (const node of nodes) {
    if (fixedIds.has(node.id)) continue;
    const size = sizeOf(node);
    const proposed = positions.get(node.id) ?? node.position;
    const box: Rect = { x: proposed.x, y: proposed.y, ...size };
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const hit = occupied.find((other) => overlaps(box, other));
      if (!hit) break;
      if (vertical) box.x += size.width + gap;
      else box.y += size.height + gap;
    }
    result.set(node.id, { x: Math.round(box.x), y: Math.round(box.y) });
    occupied.push(box);
  }
  return result;
}

/** کوچک‌ترین گروهی که مرکز گره را در بر می‌گیرد (برای گروه‌های تودرتو). */
function findGroup(node: DiagramFlowNode, groups: DiagramFlowNode[]): DiagramFlowNode | null {
  const size = sizeOf(node);
  const cx = node.position.x + size.width / 2;
  const cy = node.position.y + size.height / 2;
  let best: DiagramFlowNode | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const group of groups) {
    const box = rectOf(group);
    if (cx >= box.x && cx <= box.x + box.width && cy >= box.y && cy <= box.y + box.height) {
      const area = box.width * box.height;
      if (area < bestArea) {
        best = group;
        bestArea = area;
      }
    }
  }
  return best;
}

/** کادر گروه را دقیقاً دور اعضایش می‌کشد؛ گروه قفل‌شده جابه‌جا نمی‌شود. */
function fitGroups(
  groups: DiagramFlowNode[],
  members: Map<string, DiagramFlowNode[]>,
  positions: Map<string, { x: number; y: number }>
): Map<string, { x: number; y: number }> {
  const groupPositions = new Map<string, { x: number; y: number }>();
  for (const group of groups) {
    groupPositions.set(group.id, { ...group.position });
    if (group.data.locked) continue;
    const children = members.get(group.id) ?? [];
    if (!children.length) continue;
    const boxes = children.map((node) => {
      const size = sizeOf(node);
      const point = positions.get(node.id) ?? node.position;
      return { x: point.x, y: point.y, ...size };
    });
    const minX = Math.min(...boxes.map((box) => box.x));
    const minY = Math.min(...boxes.map((box) => box.y));
    groupPositions.set(group.id, {
      x: Math.round(minX - GROUP_PADDING),
      y: Math.round(minY - GROUP_PADDING - GROUP_TITLE),
    });
  }
  return groupPositions;
}

/**
 * چیدمان خودکار. خروجی فقط مختصات/اندازهٔ گره‌ها را عوض می‌کند؛ ترتیب آرایه،
 * شناسه‌ها، ارتباط‌ها و داده‌ها همان قبلی است.
 */
export function autoLayoutNodes(
  nodes: DiagramFlowNode[],
  edges: DiagramFlowEdge[],
  options: AutoLayoutOptions
): DiagramFlowNode[] {
  const gap = options.gap ?? DEFAULT_GAP;
  const layerGap = options.layerGap ?? DEFAULT_LAYER_GAP;
  const vertical = options.mode !== 'horizontal';
  const groups = nodes.filter(isGroup);
  const content = nodes.filter((node) => !isGroup(node));
  if (!nodes.length) return nodes;

  const members = new Map<string, DiagramFlowNode[]>();
  for (const group of groups) members.set(group.id, []);
  const groupOf = new Map<string, DiagramFlowNode>();
  for (const node of content) {
    const group = findGroup(node, groups);
    if (!group) continue;
    groupOf.set(node.id, group);
    members.get(group.id)!.push(node);
  }

  const pairs = uniquePairs(content, edges);
  const pairsFor = (subset: Set<string>) =>
    pairs.filter((pair) => subset.has(pair.source) && subset.has(pair.target));

  const fixedIds = new Set(nodes.filter((node) => node.data.locked).map((node) => node.id));
  for (const group of groups) {
    if (!group.data.locked) continue;
    for (const child of members.get(group.id) ?? []) fixedIds.add(child.id);
  }

  let positions = new Map<string, { x: number; y: number }>();
  let groupSizes = new Map<string, Size>();

  if (options.mode === 'grouped') {
    const clusters: { group: DiagramFlowNode | null; items: DiagramFlowNode[] }[] = [];
    for (const group of groups) {
      const items = members.get(group.id) ?? [];
      if (items.length) clusters.push({ group, items });
    }
    const ungrouped = content.filter((node) => !groupOf.has(node.id));
    if (ungrouped.length) clusters.push({ group: null, items: ungrouped });

    const layouts = clusters.map((cluster) => {
      const ids = new Set(cluster.items.map((node) => node.id));
      return { ...cluster, packed: packLayered(cluster.items, pairsFor(ids), true, gap, layerGap) };
    });

    let x = 0;
    let y = 0;
    let rowHeight = 0;
    for (const cluster of layouts) {
      if (x > 0 && x + cluster.packed.width > MAX_ROW_WIDTH) {
        x = 0;
        y += rowHeight + layerGap;
        rowHeight = 0;
      }
      const offsetX = x + GROUP_PADDING;
      const offsetY = y + GROUP_TITLE + GROUP_PADDING;
      for (const node of cluster.items) {
        const point = cluster.packed.positions.get(node.id);
        if (point) positions.set(node.id, { x: point.x + offsetX, y: point.y + offsetY });
      }
      x += cluster.packed.width + gap + GROUP_PADDING * 2;
      rowHeight = Math.max(rowHeight, cluster.packed.height + GROUP_TITLE + GROUP_PADDING * 2);
    }
  } else {
    const ids = new Set(content.map((node) => node.id));
    positions = packLayered(content, pairsFor(ids), vertical, gap, layerGap).positions;
  }

  positions = applyPositions(content, positions, fixedIds, vertical, gap);

  const groupPositions = fitGroups(groups, members, positions);
  for (const group of groups) {
    const point = groupPositions.get(group.id);
    if (!point) continue;
    positions.set(group.id, point);
  }

  // اندازهٔ گروه‌های بدون قفل با کادر اعضا هماهنگ می‌شود.
  for (const group of groups) {
    const children = members.get(group.id) ?? [];
    if (group.data.locked || !children.length) continue;
    const boxes = children.map((node) => {
      const size = sizeOf(node);
      const point = positions.get(node.id) ?? node.position;
      return { x: point.x, y: point.y, ...size };
    });
    const minX = Math.min(...boxes.map((box) => box.x));
    const minY = Math.min(...boxes.map((box) => box.y));
    const maxX = Math.max(...boxes.map((box) => box.x + box.width));
    const maxY = Math.max(...boxes.map((box) => box.y + box.height));
    groupSizes.set(group.id, {
      width: Math.max(180, Math.round(maxX - minX + GROUP_PADDING * 2)),
      height: Math.max(120, Math.round(maxY - minY + GROUP_PADDING * 2 + GROUP_TITLE)),
    });
  }

  return nodes.map((node) => {
    const point = positions.get(node.id) ?? node.position;
    const size = groupSizes.get(node.id);
    return {
      ...node,
      position: { x: Math.round(point.x), y: Math.round(point.y) },
      ...(size ? { width: size.width, height: size.height } : {}),
    };
  });
}
