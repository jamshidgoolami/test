/**
 * NetWatch — گراف دیاگرام
 * ----------------------------------------------------------------
 * اعتبارسنجی، نرمال‌سازی، سریال‌سازی و خواندن/نوشتن گراف در این ماژول
 * است. Routeها فقط دادهٔ HTTP را می‌گیرند و پاسخ را می‌سازند.
 */
import { db } from '../db.js';

export const CONNECTION_KINDS = new Set(['fiber', 'otn', 'copper', 'bandwidth', 'radio', 'modem']);
export const LINK_SIDES = new Set(['top', 'right', 'bottom', 'left']);
const NODE_TYPES = new Set(['device', 'shape', 'note', 'group', 'image', 'diagram']);
export const MAX_NODES = 800;
export const MAX_EDGES = 1600;
export const MAX_DATA_BYTES = 4 * 1024 * 1024;
export const MAX_LINKS = 200;

export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 2000;

export const text = (v, max) =>
  String(v ?? '')
    .trim()
    .slice(0, max);

export class DiagramError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function cleanLinkKind(raw, fallback = 'fiber') {
  const kind = String(raw ?? fallback);
  if (!CONNECTION_KINDS.has(kind)) throw new DiagramError(`نوع ارتباط «${kind}» پشتیبانی نمی‌شود.`);
  return kind;
}

/** سمت اتصال اختیاری است؛ مقدار خالی یعنی همان مسیر خودکار قبلی. */
export function cleanLinkSide(raw) {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const side = String(raw);
  if (!LINK_SIDES.has(side)) throw new DiagramError(`سمت اتصال «${side}» پشتیبانی نمی‌شود.`);
  return side;
}

export function nowMs() {
  return Date.now();
}

export function serializeSummary(row) {
  let graph = { nodes: [], edges: [] };
  try {
    graph = JSON.parse(row.data || '{}');
  } catch {
    /* دادهٔ خراب نباید فهرست را از کار بیندازد */
  }
  return {
    id: row.id,
    parentId: row.parent_id ?? null,
    name: row.name,
    description: row.description || '',
    revision: row.revision,
    nodeCount: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
    edgeCount: Array.isArray(graph.edges) ? graph.edges.length : 0,
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serialize(row) {
  let graph = { nodes: [], edges: [] };
  try {
    graph = JSON.parse(row.data || '{}');
  } catch {
    /* نمای خالی */
  }
  return {
    ...serializeSummary(row),
    nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
    edges: Array.isArray(graph.edges) ? graph.edges : [],
  };
}

export function getRow(id) {
  const row = db.prepare('SELECT * FROM diagrams WHERE id = ?').get(id);
  if (!row) throw new DiagramError('دیاگرام پیدا نشد.', 404);
  return row;
}

/** آیا `candidate` خودِ `id` یا یکی از زیرمجموعه‌های آن است؟ */
export function isSelfOrDescendant(id, candidate) {
  let cursor = candidate;
  const seen = new Set();
  while (cursor != null) {
    if (cursor === id) return true;
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const row = db.prepare('SELECT parent_id FROM diagrams WHERE id = ?').get(cursor);
    cursor = row?.parent_id ?? null;
  }
  return false;
}

export function descendantIds(id) {
  return db
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM diagrams WHERE id = ?
         UNION ALL
         SELECT d.id FROM diagrams d JOIN tree t ON d.parent_id = t.id
       )
       SELECT id FROM tree`
    )
    .all(id)
    .map((r) => r.id);
}

export function normalizeParent(parentId) {
  if (parentId === null || parentId === undefined || parentId === '') return null;
  const value = Number(parentId);
  if (!Number.isInteger(value) || value <= 0) throw new DiagramError('شناسهٔ دیاگرام والد نامعتبر است.');
  const parent = db.prepare('SELECT id FROM diagrams WHERE id = ?').get(value);
  if (!parent) throw new DiagramError('دیاگرام والد پیدا نشد.', 404);
  return value;
}

function cleanComments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 100)
    .map((comment) => ({
      id: text(comment?.id, 80),
      text: text(comment?.text, 1000),
      author: text(comment?.author, 120),
      createdAt: Number.isFinite(Number(comment?.createdAt)) ? Number(comment.createdAt) : nowMs(),
    }))
    .filter((comment) => comment.id && comment.text);
}

function cleanNode(raw, index) {
  if (!raw || typeof raw !== 'object') throw new DiagramError(`جزء شمارهٔ ${index + 1} نامعتبر است.`);
  const id = String(raw.id ?? '').trim();
  if (!id || id.length > 80) throw new DiagramError(`شناسهٔ جزء شمارهٔ ${index + 1} نامعتبر است.`);
  const type = String(raw.type ?? '');
  if (!NODE_TYPES.has(type)) throw new DiagramError(`نوع جزء «${type}» پشتیبانی نمی‌شود.`);
  const x = Number(raw.position?.x);
  const y = Number(raw.position?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new DiagramError('موقعیت جزء باید عدد باشد.');
  const width = Number(raw.width);
  const height = Number(raw.height);
  const rawData = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : {};
  const data = { ...rawData };
  if (Array.isArray(rawData.comments)) {
    const comments = cleanComments(rawData.comments);
    if (comments.length) data.comments = comments;
    else delete data.comments;
  }
  return {
    id,
    type,
    position: { x, y },
    ...(Number.isFinite(width) && width > 0 ? { width: Math.min(4000, Math.round(width)) } : {}),
    ...(Number.isFinite(height) && height > 0 ? { height: Math.min(4000, Math.round(height)) } : {}),
    data,
  };
}

export function normalizeGraph(input) {
  const nodes = Array.isArray(input?.nodes) ? input.nodes : [];
  const edges = Array.isArray(input?.edges) ? input.edges : [];
  if (nodes.length > MAX_NODES) throw new DiagramError(`حداکثر ${MAX_NODES} جزء در هر دیاگرام مجاز است.`);
  if (edges.length > MAX_EDGES) throw new DiagramError(`حداکثر ${MAX_EDGES} ارتباط در هر دیاگرام مجاز است.`);

  const cleanNodes = nodes.map(cleanNode);
  const ids = new Set(cleanNodes.map((n) => n.id));
  if (ids.size !== cleanNodes.length) throw new DiagramError('شناسهٔ اجزای دیاگرام باید یکتا باشد.');

  const cleanEdges = edges.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new DiagramError(`ارتباط شمارهٔ ${index + 1} نامعتبر است.`);
    const id = String(raw.id ?? '').trim();
    const source = String(raw.source ?? '').trim();
    const target = String(raw.target ?? '').trim();
    if (!id || id.length > 80) throw new DiagramError(`شناسهٔ ارتباط شمارهٔ ${index + 1} نامعتبر است.`);
    if (!ids.has(source) || !ids.has(target)) throw new DiagramError('دو سر ارتباط باید جزء موجود روی بوم باشند.');
    if (source === target) throw new DiagramError('اتصال یک جزء به خودش مجاز نیست.');
    const kind = String(raw.kind ?? 'copper');
    if (!CONNECTION_KINDS.has(kind)) throw new DiagramError(`نوع ارتباط «${kind}» پشتیبانی نمی‌شود.`);
    return {
      id,
      source,
      target,
      sourceHandle: String(raw.sourceHandle ?? '').slice(0, 20),
      targetHandle: String(raw.targetHandle ?? '').slice(0, 20),
      kind,
      label: text(raw.label, 120),
      ...(Array.isArray(raw.comments) ? { comments: cleanComments(raw.comments) } : {}),
    };
  });
  if (new Set(cleanEdges.map((e) => e.id)).size !== cleanEdges.length) {
    throw new DiagramError('شناسهٔ ارتباط‌ها باید یکتا باشد.');
  }

  const graph = { nodes: cleanNodes, edges: cleanEdges };
  if (Buffer.byteLength(JSON.stringify(graph), 'utf8') > MAX_DATA_BYTES) {
    throw new DiagramError('حجم دیاگرام بیش از حد مجاز است.');
  }
  return graph;
}

export function readGraph(row) {
  try {
    const parsed = JSON.parse(row.data || '{}');
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

export function writeGraph(id, graph, stamp) {
  const info = db
    .prepare('UPDATE diagrams SET data = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(graph), stamp, id);
  if (!info.changes) throw new DiagramError('دیاگرام پیدا نشد.', 404);
  return getRow(id);
}

/** جای خالی برای جزء تازه: ستونی در سمت راست بوم، زیر پیوندهای موجود */
export function linkPosition(nodes, linkCount) {
  const right = nodes.reduce(
    (max, node) => Math.max(max, Number(node?.position?.x ?? 0) + Number(node?.width ?? 190)),
    0
  );
  const top = nodes.reduce((min, node) => Math.min(min, Number(node?.position?.y ?? 0)), 0);
  return { x: Math.round(right + 80), y: Math.round(top + linkCount * 100) };
}
