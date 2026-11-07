/**
 * NetWatch — API دیاگرام‌های ماژولار شبکه
 * ----------------------------------------------------------------
 * هر دیاگرام یک فایل مستقل است: نام، توضیح و کل اجزای بوم (تجهیزات، گروه‌ها،
 * شکل‌ها، یادداشت‌ها و ارتباط‌ها) در همان ردیف ذخیره می‌شوند. دیاگرام‌ها با
 * `parent_id` ساختار درختی می‌سازند و ویرایش یکی، دیگری را تغییر نمی‌دهد.
 *
 * `revision` خوش‌بینانه جلوی بازنویسی هم‌زمان دو تب را می‌گیرد: هر ذخیره
 * شمارهٔ نسخه‌ای را که کلاینت دیده است می‌فرستد و اگر سرور نسخهٔ جدیدتری
 * داشته باشد، ۴۰۹ برمی‌گرداند تا کاربر تصمیم بگیرد.
 */
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { db, getSettings, log } from '../db.js';
import { routePermission } from '../permissions.js';
import {
  attachmentMaxBytes,
  attachmentPath,
  detectFileType,
  removeAttachmentFile,
  safeDisplayName,
  stageAttachmentRemoval,
  writeAttachmentFile,
} from '../attachments.js';

const router = express.Router();

router.use(routePermission({ read: 'diagrams:read', write: 'diagrams:write' }));

const CONNECTION_KINDS = new Set(['fiber', 'otn', 'copper', 'bandwidth', 'radio', 'modem']);
const LINK_SIDES = new Set(['top', 'right', 'bottom', 'left']);
const NODE_TYPES = new Set(['device', 'shape', 'note', 'group', 'image', 'diagram']);
const MAX_NODES = 800;
const MAX_EDGES = 1600;
const MAX_DATA_BYTES = 4 * 1024 * 1024;

const NAME_MAX = 120;
const DESCRIPTION_MAX = 2000;

const text = (v, max) => String(v ?? '').trim().slice(0, max);

function cleanLinkKind(raw, fallback = 'fiber') {
  const kind = String(raw ?? fallback);
  if (!CONNECTION_KINDS.has(kind)) throw new DiagramError(`نوع ارتباط «${kind}» پشتیبانی نمی‌شود.`);
  return kind;
}

/** سمت اتصال اختیاری است؛ مقدار خالی یعنی همان مسیر خودکار قبلی. */
function cleanLinkSide(raw) {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const side = String(raw);
  if (!LINK_SIDES.has(side)) throw new DiagramError(`سمت اتصال «${side}» پشتیبانی نمی‌شود.`);
  return side;
}

class DiagramError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function nowMs() {
  return Date.now();
}

function serializeSummary(row) {
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

function serialize(row) {
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

function getRow(id) {
  const row = db.prepare('SELECT * FROM diagrams WHERE id = ?').get(id);
  if (!row) throw new DiagramError('دیاگرام پیدا نشد.', 404);
  return row;
}

/** آیا `candidate` خودِ `id` یا یکی از زیرمجموعه‌های آن است؟ */
function isSelfOrDescendant(id, candidate) {
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

function descendantIds(id) {
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

function normalizeParent(parentId) {
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

function normalizeGraph(input) {
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

/** ساختار درختی برای پنل کنار بوم: فهرست تخت با parentId */
router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM diagrams ORDER BY name COLLATE NOCASE').all();
  res.json({ items: rows.map(serializeSummary) });
});

/* ------------------------------------------------------------------ */
/* پیوند دوطرفهٔ دیاگرام‌ها                                             */
/* ------------------------------------------------------------------ */
/* هر پیوند بین دو دیاگرام در هر دو بوم یک جزء «diagram» دارد؛ بنابراین   */
/* حذف/تغییر یک طرف، طرف مقابل را هم همگام می‌کند. برای هر جفت دیاگرام    */
/* تنها یک پیوند نگه داشته می‌شود تا نقشهٔ ارتباط یال تکراری نشان ندهد.    */

function linkTargets(graph) {
  const targets = new Set();
  for (const node of graph.nodes) {
    if (!node || node.type !== 'diagram') continue;
    const target = Number(node.data?.diagramId);
    if (Number.isInteger(target) && target > 0) targets.add(target);
  }
  return targets;
}

/** جزء پیوند برگشتی را در دیاگرام مقصد می‌سازد (یا نوعش را همگام می‌کند). */
function ensureReciprocalLink(sourceRow, targetId, linkKind) {
  if (!Number.isInteger(targetId) || targetId <= 0 || targetId === sourceRow.id) return false;
  let targetRow;
  try {
    targetRow = getRow(targetId);
  } catch {
    return false;
  }
  const graph = readGraph(targetRow);
  const kind = CONNECTION_KINDS.has(linkKind) ? linkKind : 'fiber';
  const existing = graph.nodes.find(
    (node) => node && node.type === 'diagram' && Number(node.data?.diagramId) === sourceRow.id
  );
  if (existing) {
    if (existing.data?.linkKind === kind) return false;
    const next = {
      nodes: graph.nodes.map((node) =>
        node === existing ? { ...existing, data: { ...existing.data, linkKind: kind } } : node
      ),
      edges: graph.edges,
    };
    writeGraph(targetRow.id, next, nowMs());
    return true;
  }
  const links = graph.nodes.filter((node) => node && node.type === 'diagram');
  if (links.length >= MAX_LINKS || graph.nodes.length >= MAX_NODES) {
    log('warn', `پیوند برگشتی «${targetRow.name}» → «${sourceRow.name}» ساخته نشد: ظرفیت دیاگرام پر است.`);
    return false;
  }
  const node = {
    id: `link-${crypto.randomUUID()}`,
    type: 'diagram',
    position: linkPosition(graph.nodes, links.length),
    width: 220,
    height: 80,
    data: {
      label: sourceRow.name,
      diagramId: sourceRow.id,
      color: '#0369a1',
      linkKind: kind,
    },
  };
  const next = { nodes: [...graph.nodes, node], edges: graph.edges };
  if (Buffer.byteLength(JSON.stringify(next), 'utf8') > MAX_DATA_BYTES) return false;
  writeGraph(targetRow.id, next, nowMs());
  return true;
}

/** جزءهای پیوندِ دیاگرام مقصد که به `sourceId` اشاره می‌کنند را برمی‌دارد. */
function removeReciprocalLink(sourceId, targetId) {
  if (!Number.isInteger(targetId) || targetId <= 0 || targetId === sourceId) return false;
  let targetRow;
  try {
    targetRow = getRow(targetId);
  } catch {
    return false;
  }
  const graph = readGraph(targetRow);
  const removable = graph.nodes.filter(
    (node) => node && node.type === 'diagram' && Number(node.data?.diagramId) === sourceId
  );
  if (!removable.length) return false;
  const ids = new Set(removable.map((node) => node.id));
  writeGraph(
    targetRow.id,
    {
      nodes: graph.nodes.filter((node) => !ids.has(node.id)),
      edges: graph.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)),
    },
    nowMs()
  );
  return true;
}

/** پس از ذخیرهٔ بوم، پیوندهای برگشتی را می‌سازد/حذف می‌کند. */
function syncReciprocalLinks(sourceRow, previousGraph, nextGraph) {
  const before = linkTargets(previousGraph);
  const after = linkTargets(nextGraph);
  for (const targetId of before) {
    if (targetId !== sourceRow.id && !after.has(targetId)) removeReciprocalLink(sourceRow.id, targetId);
  }
  for (const node of nextGraph.nodes) {
    if (!node || node.type !== 'diagram') continue;
    const targetId = Number(node.data?.diagramId);
    if (!Number.isInteger(targetId) || targetId <= 0 || targetId === sourceRow.id) continue;
    ensureReciprocalLink(sourceRow, targetId, node.data?.linkKind);
  }
  // پیوندهای یک‌طرفهٔ قدیمی که دیگر جفت ندارند پاک می‌شوند تا نقشه متقارن بماند.
  for (const row of db.prepare('SELECT id FROM diagrams WHERE id <> ?').all(sourceRow.id)) {
    if (after.has(row.id)) continue;
    removeReciprocalLink(sourceRow.id, row.id);
  }
}

/**
 * نقشهٔ ارتباط دیاگرام‌ها.
 *
 * دو نوع رابطه برگردانده می‌شود: ساختار درختی (parentId) و پیوندهای
 * دستی که کاربر با جزء نوع «diagram» روی بوم ساخته است. هر جزء پیوند یک یال
 * مستقل است (نه یک جفت مبدأ/مقصد) تا بتوان چند پیوند به یک مقصد را جدا دید،
 * هر یال را به جزء روی بومش رساند و پیوندهای شکسته را دقیق پاک کرد.
 */

router.get('/graph', (_req, res) => {
  const rows = db
    .prepare(
      'SELECT id, parent_id, name, description, data, revision, updated_at FROM diagrams ORDER BY name COLLATE NOCASE'
    )
    .all();
  const ids = new Set(rows.map((row) => row.id));
  const links = [];
  const broken = [];
  const seen = new Set();
  const pairKeys = new Set();
  const outCount = new Map();
  const inCount = new Map();
  const brokenCount = new Map();

  const items = rows.map((row) => {
    let graph = { nodes: [], edges: [] };
    try {
      graph = JSON.parse(row.data || '{}');
    } catch {
      /* دادهٔ خراب نباید نقشهٔ ارتباط را از کار بیندازد */
    }
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph.edges) ? graph.edges : [];
    for (const node of nodes) {
      if (!node || node.type !== 'diagram') continue;
      const target = Number(node.data?.diagramId);
      const nodeId = String(node.id ?? '');
      const nodeLabel = text(node.data?.label, 120);
      if (!Number.isInteger(target) || target <= 0 || target === row.id || !nodeId) continue;
      if (!ids.has(target)) {
        broken.push({ from: row.id, fromName: row.name, nodeId, nodeLabel, to: target });
        brokenCount.set(row.id, (brokenCount.get(row.id) ?? 0) + 1);
        continue;
      }
      // یکتایی بر اساس جفت دیاگرام است؛ پیوند دوطرفه فقط یک یال نشان می‌دهد.
      const key = `${row.id}:${nodeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pairKey = `${Math.min(row.id, target)}:${Math.max(row.id, target)}`;
      if (pairKeys.has(pairKey)) continue;
      pairKeys.add(pairKey);
      const kind = CONNECTION_KINDS.has(node.data?.linkKind) ? node.data.linkKind : 'fiber';
      const fromSide = LINK_SIDES.has(node.data?.fromSide) ? node.data.fromSide : undefined;
      const toSide = LINK_SIDES.has(node.data?.toSide) ? node.data.toSide : undefined;
      links.push({
        from: row.id,
        to: target,
        nodeId,
        nodeLabel,
        label: nodeLabel,
        kind,
        ...(fromSide ? { fromSide } : {}),
        ...(toSide ? { toSide } : {}),
      });
      outCount.set(row.id, (outCount.get(row.id) ?? 0) + 1);
      inCount.set(target, (inCount.get(target) ?? 0) + 1);
    }
    return {
      id: row.id,
      parentId: row.parent_id ?? null,
      name: row.name,
      description: row.description || '',
      nodeCount: nodes.length,
      edgeCount: edges.length,
      revision: row.revision ?? 0,
      updatedAt: row.updated_at,
      inLinks: 0,
      outLinks: 0,
      childCount: 0,
      brokenLinks: 0,
    };
  });

  for (const item of items) {
    item.outLinks = outCount.get(item.id) ?? 0;
    item.inLinks = inCount.get(item.id) ?? 0;
    item.childCount = items.filter((other) => other.parentId === item.id).length;
    item.brokenLinks = brokenCount.get(item.id) ?? 0;
  }

  const roots = items.filter((item) => item.parentId == null).length;
  const orphans = items.filter(
    (item) => item.parentId == null && item.childCount === 0 && item.inLinks === 0 && item.outLinks === 0
  ).length;

  res.json({
    items,
    links,
    broken,
    stats: {
      diagrams: items.length,
      links: links.length,
      children: items.filter((item) => item.parentId != null).length,
      broken: broken.length,
      roots,
      orphans,
    },
  });
});

/* ------------------------------------------------------------------ */
/* مدیریت پیوند بین دیاگرام‌ها بدون باز کردن بوم                        */
/* ------------------------------------------------------------------ */
/* جزء نوع «diagram» همان پیوند است؛ این سه مسیر فقط همان جزء را روی بوم
   مبدأ می‌سازند، تغییر می‌دهند یا حذف می‌کنند، نسخهٔ دیاگرام را بالا می‌برند
   و دیاگرام کامل را برمی‌گردانند تا بوم باز همان لحظه همگام شود. */
const MAX_LINKS = 200;

function readGraph(row) {
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

function writeGraph(id, graph, stamp) {
  const info = db
    .prepare('UPDATE diagrams SET data = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(graph), stamp, id);
  if (!info.changes) throw new DiagramError('دیاگرام پیدا نشد.', 404);
  return getRow(id);
}

/** جای خالی برای جزء تازه: ستونی در سمت راست بوم، زیر پیوندهای موجود */
function linkPosition(nodes, linkCount) {
  const right = nodes.reduce(
    (max, node) => Math.max(max, Number(node?.position?.x ?? 0) + Number(node?.width ?? 190)),
    0
  );
  const top = nodes.reduce(
    (min, node) => Math.min(min, Number(node?.position?.y ?? 0)),
    0
  );
  return { x: Math.round(right + 80), y: Math.round(top + linkCount * 100) };
}

router.post('/:id/links', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = getRow(id);
    const targetId = Number(req.body?.targetId);
    if (!Number.isInteger(targetId) || targetId <= 0) throw new DiagramError('دیاگرام مقصد را انتخاب کنید.');
    if (targetId === id) throw new DiagramError('پیوند یک دیاگرام به خودش مجاز نیست.');
    const target = getRow(targetId);
    const graph = readGraph(row);
    if (
      readGraph(target).nodes.some(
        (node) => node && node.type === 'diagram' && Number(node.data?.diagramId) === id
      )
    ) {
      throw new DiagramError('این دو دیاگرام از قبل به هم پیوند دارند.');
    }
    const links = graph.nodes.filter((node) => node && node.type === 'diagram');
    if (links.length >= MAX_LINKS) {
      throw new DiagramError(`هر دیاگرام حداکثر ${MAX_LINKS} پیوند می‌تواند داشته باشد.`);
    }
    if (links.some((node) => Number(node.data?.diagramId) === targetId)) {
      throw new DiagramError(`این دیاگرام از قبل به «${target.name}» پیوند دارد.`);
    }
    if (graph.nodes.length >= MAX_NODES) throw new DiagramError(`حداکثر ${MAX_NODES} جزء در هر دیاگرام مجاز است.`);
    const label = text(req.body?.label, 120) || target.name;
    const description = text(req.body?.description, 300);
    const linkKind = cleanLinkKind(req.body?.linkKind ?? req.body?.kind);
    const fromSide = cleanLinkSide(req.body?.fromSide);
    const toSide = cleanLinkSide(req.body?.toSide);
    const node = {
      id: `link-${crypto.randomUUID()}`,
      type: 'diagram',
      position: linkPosition(graph.nodes, links.length),
      width: 220,
      height: 80,
      data: {
        label,
        diagramId: targetId,
        color: '#0369a1',
        linkKind,
        ...(fromSide ? { fromSide } : {}),
        ...(toSide ? { toSide } : {}),
        ...(description ? { description } : {}),
      },
    };
    const next = { nodes: [...graph.nodes, node], edges: graph.edges };
    if (Buffer.byteLength(JSON.stringify(next), 'utf8') > MAX_DATA_BYTES) {
      throw new DiagramError('حجم دیاگرام بیش از حد مجاز است.');
    }
    const saved = writeGraph(id, next, nowMs());
    ensureReciprocalLink(saved, targetId, linkKind);
    log('info', `پیوند دوطرفهٔ «${row.name}» ↔ «${target.name}» ساخته شد.`);
    res.status(201).json(serialize(saved));
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/links/:nodeId', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = getRow(id);
    const nodeId = String(req.params.nodeId ?? '');
    const graph = readGraph(row);
    const index = graph.nodes.findIndex((node) => node && node.id === nodeId && node.type === 'diagram');
    if (index < 0) throw new DiagramError('پیوند پیدا نشد.', 404);
    const current = graph.nodes[index];
    const previousTargetId = Number(current.data?.diagramId);
    const targetId =
      req.body?.targetId === undefined ? Number(current.data?.diagramId) : Number(req.body.targetId);
    if (!Number.isInteger(targetId) || targetId <= 0) throw new DiagramError('دیاگرام مقصد نامعتبر است.');
    if (targetId === id) throw new DiagramError('پیوند یک دیاگرام به خودش مجاز نیست.');
    const target = getRow(targetId);
    if (
      graph.nodes.some(
        (node) => node.id !== nodeId && node.type === 'diagram' && Number(node.data?.diagramId) === targetId
      )
    ) {
      throw new DiagramError(`این دیاگرام از قبل به «${target.name}» پیوند دارد.`);
    }
    const label =
      req.body?.label === undefined
        ? text(current.data?.label, 120) || target.name
        : text(req.body.label, 120) || target.name;
    const description =
      req.body?.description === undefined ? text(current.data?.description, 300) : text(req.body.description, 300);
    const kindInput = req.body?.linkKind ?? req.body?.kind;
    const linkKind =
      kindInput === undefined
        ? CONNECTION_KINDS.has(current.data?.linkKind)
          ? current.data.linkKind
          : 'fiber'
        : cleanLinkKind(kindInput);
    const data = { ...current.data, label, diagramId: targetId, linkKind };
    if (req.body?.fromSide !== undefined) {
      const fromSide = cleanLinkSide(req.body.fromSide);
      if (fromSide) data.fromSide = fromSide;
      else delete data.fromSide;
    }
    if (req.body?.toSide !== undefined) {
      const toSide = cleanLinkSide(req.body.toSide);
      if (toSide) data.toSide = toSide;
      else delete data.toSide;
    }
    if (description) data.description = description;
    else delete data.description;
    const next = {
      nodes: graph.nodes.map((node, position) =>
        position === index ? { ...current, data } : node
      ),
      edges: graph.edges,
    };
    const saved = writeGraph(id, next, nowMs());
    if (previousTargetId !== targetId) removeReciprocalLink(id, previousTargetId);
    ensureReciprocalLink(saved, targetId, linkKind);
    log('info', `پیوند دوطرفهٔ «${row.name}» ↔ «${target.name}» به‌روزرسانی شد.`);
    res.json(serialize(saved));
  } catch (e) {
    next(e);
  }
});

router.delete('/:id/links/:nodeId', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = getRow(id);
    const nodeId = String(req.params.nodeId ?? '');
    const graph = readGraph(row);
    const linkNode = graph.nodes.find((node) => node && node.id === nodeId && node.type === 'diagram');
    if (!linkNode) throw new DiagramError('پیوند پیدا نشد.', 404);
    const previousTargetId = Number(linkNode.data?.diagramId);
    const next = {
      nodes: graph.nodes.filter((node) => node.id !== nodeId),
      edges: graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
    };
    const saved = writeGraph(id, next, nowMs());
    removeReciprocalLink(id, previousTargetId);
    log('info', `پیوند دوطرفهٔ دیاگرام «${row.name}» حذف شد.`);
    res.json(serialize(saved));
  } catch (e) {
    next(e);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new DiagramError('شناسهٔ دیاگرام نامعتبر است.');
    res.json(serialize(getRow(id)));
  } catch (e) {
    next(e);
  }
});

router.post('/', (req, res, next) => {
  try {
    const name = text(req.body?.name, NAME_MAX);
    if (!name) throw new DiagramError('نام دیاگرام لازم است.');
    const parentId = normalizeParent(req.body?.parentId);
    const ts = nowMs();
    const info = db
      .prepare(
        `INSERT INTO diagrams(parent_id, name, description, data, revision, created_by, created_at, updated_at)
         VALUES (?,?,?,?,1,?,?,?)`
      )
      .run(
        parentId,
        name,
        text(req.body?.description, DESCRIPTION_MAX),
        '{"nodes":[],"edges":[]}',
        text(req.user?.username, 120),
        ts,
        ts
      );
    const row = getRow(Number(info.lastInsertRowid));
    log('info', `دیاگرام «${row.name}» ساخته شد.`);
    res.status(201).json(serialize(row));
  } catch (e) {
    next(e);
  }
});

/**
 * با تغییر نام یک دیاگرام، برچسب جزءهای پیوندی که در بوم‌های دیگر به آن
 * اشاره می‌کنند هم به‌روز می‌شود. برچسبی که کاربر دستی عوض کرده (و با نام
 * قبلی یکی نیست) دست نمی‌خورد و نسخهٔ دیاگرام‌های تغییر‌یافته بالا می‌رود.
 */
function renameLinkLabels(targetId, oldName, newName, stamp) {
  const rows = db.prepare('SELECT id, data FROM diagrams WHERE id <> ?').all(targetId);
  const update = db.prepare('UPDATE diagrams SET data = ?, revision = revision + 1, updated_at = ? WHERE id = ?');
  let nodes = 0;
  const diagrams = [];
  for (const row of rows) {
    const graph = readGraph(row);
    let changed = false;
    const nextNodes = graph.nodes.map((node) => {
      if (!node || node.type !== 'diagram' || Number(node.data?.diagramId) !== targetId) return node;
      const label = text(node.data?.label, 120);
      if (label && label !== oldName) return node;
      changed = true;
      nodes += 1;
      return { ...node, data: { ...node.data, label: newName } };
    });
    if (!changed) continue;
    update.run(JSON.stringify({ nodes: nextNodes, edges: graph.edges }), stamp, row.id);
    diagrams.push(row.id);
  }
  return { nodes, diagrams };
}

router.put('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = getRow(id);
    const name = req.body?.name === undefined ? row.name : text(req.body.name, NAME_MAX);
    if (!name) throw new DiagramError('نام دیاگرام لازم است.');
    const description =
      req.body?.description === undefined ? row.description : text(req.body.description, DESCRIPTION_MAX);
    let parentId = row.parent_id;
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'parentId')) {
      parentId = normalizeParent(req.body.parentId);
      if (parentId !== null && isSelfOrDescendant(id, parentId)) {
        throw new DiagramError('دیاگرام نمی‌تواند زیرمجموعهٔ خودش یا زیرمجموعه‌هایش باشد.');
      }
    }
    const stamp = nowMs();
    const oldName = row.name;
    db.prepare(
      `UPDATE diagrams SET name = ?, description = ?, parent_id = ?, updated_at = ? WHERE id = ?`
    ).run(name, description, parentId, stamp, id);
    const relabeled = name !== oldName ? renameLinkLabels(id, oldName, name, stamp) : { nodes: 0, diagrams: [] };
    if (relabeled.nodes) {
      log(
        'info',
        `نام دیاگرام «${oldName}» به «${name}» تغییر کرد و برچسب ${relabeled.nodes} پیوند در ${relabeled.diagrams.length} دیاگرام هم به‌روز شد.`
      );
    }
    res.json({
      ...serialize(getRow(id)),
      relabeledLinks: relabeled.nodes,
      relabeledDiagrams: relabeled.diagrams,
    });
  } catch (e) {
    next(e);
  }
});

router.put('/:id/content', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = getRow(id);
    const revision = Number(req.body?.revision);
    if (!Number.isInteger(revision)) throw new DiagramError('شمارهٔ نسخهٔ دیاگرام لازم است.');
    if (revision !== row.revision) {
      return res.status(409).json({
        error: 'این دیاگرام در جای دیگری تغییر کرده است. برای ادامه، نسخهٔ تازه را بارگذاری کنید.',
        code: 'stale',
        revision: row.revision,
        updatedAt: row.updated_at,
      });
    }
    const graph = normalizeGraph(req.body);
    const previousGraph = readGraph(row);
    const nextRevision = row.revision + 1;
    db.prepare('UPDATE diagrams SET data = ?, revision = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(graph),
      nextRevision,
      nowMs(),
      id
    );
    const savedRow = getRow(id);
    syncReciprocalLinks(savedRow, previousGraph, graph);
    res.json(serialize(savedRow));
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------ */
/* پیوست‌های دیاگرام — تصویر/لوگو/نقشهٔ طبقه روی بوم                     */
/* ------------------------------------------------------------------ */
/* همان سامانهٔ پیوست تجهیزات استفاده می‌شود: تشخیص نوع از محتوای واقعی، نام
   تولیدی فایل روی دیسک و سقف حجم از تنظیمات. فقط تصویر پذیرفته می‌شود چون
   کاربرد این پیوست‌ها نمایش روی بوم است. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 + 1, files: 1, fields: 5, parts: 8 },
});

function serializeAttachment(row) {
  return {
    id: row.id,
    diagramId: row.diagram_id,
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    kind: row.kind,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    downloadUrl: `/api/diagrams/${row.diagram_id}/attachments/${row.id}/download`,
  };
}

router.get('/:id/attachments', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = getRow(id);
    const items = db
      .prepare('SELECT * FROM diagram_attachments WHERE diagram_id = ? ORDER BY created_at DESC')
      .all(row.id);
    res.json({ items: items.map(serializeAttachment), maxBytes: attachmentMaxBytes(getSettings()) });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/attachments', upload.single('file'), (req, res, next) => {
  let written = null;
  try {
    const id = Number(req.params.id);
    const row = getRow(id);
    if (!req.file || !req.file.buffer?.length) throw new DiagramError('فایلی دریافت نشد.');
    const maxBytes = attachmentMaxBytes(getSettings());
    if (req.file.size > maxBytes) {
      throw new DiagramError(`حجم فایل بیش از حد مجاز (${Math.round(maxBytes / 1024 / 1024)} مگابایت) است.`, 413);
    }
    const type = detectFileType(req.file.buffer);
    if (!type || type.kind !== 'image') {
      throw new DiagramError('فقط تصویر (PNG/JPEG/GIF/WebP) برای بوم دیاگرام پذیرفته می‌شود.', 415);
    }
    written = writeAttachmentFile(req.file.buffer, type);
    const now = nowMs();
    const info = db
      .prepare(
        `INSERT INTO diagram_attachments(diagram_id, file_name, stored_name, mime, size_bytes, kind, uploaded_by, created_at)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        row.id,
        safeDisplayName(req.file.originalname, type.ext),
        written.storedName,
        type.mime,
        written.sizeBytes,
        type.kind,
        text(req.user?.username, 80),
        now
      );
    const saved = db.prepare('SELECT * FROM diagram_attachments WHERE id = ?').get(Number(info.lastInsertRowid));
    res.status(201).json(serializeAttachment(saved));
  } catch (e) {
    // آپلود ناموفق نباید فایل یتیم روی دیسک بگذارد.
    if (written?.storedName) removeAttachmentFile(written.storedName);
    next(e);
  }
});

router.get('/:id/attachments/:attachmentId/download', (req, res, next) => {
  try {
    const row = db
      .prepare('SELECT * FROM diagram_attachments WHERE id = ? AND diagram_id = ?')
      .get(Number(req.params.attachmentId), Number(req.params.id));
    if (!row) throw new DiagramError('تصویر دیاگرام پیدا نشد.', 404);
    const full = attachmentPath(row.stored_name);
    if (!full || !fs.existsSync(full)) throw new DiagramError('فایل تصویر در دسترس نیست.', 404);
    res.setHeader('Content-Type', row.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(full);
  } catch (e) {
    next(e);
  }
});

router.delete('/:id/attachments/:attachmentId', (req, res, next) => {
  try {
    const row = db
      .prepare('SELECT * FROM diagram_attachments WHERE id = ? AND diagram_id = ?')
      .get(Number(req.params.attachmentId), Number(req.params.id));
    if (!row) throw new DiagramError('تصویر دیاگرام پیدا نشد.', 404);
    const isAdmin = String(req.user?.role) === 'admin';
    if (!isAdmin && row.uploaded_by !== String(req.user?.username || '')) {
      throw new DiagramError('حذف تصویر دیگران فقط برای مدیر مجاز است.', 403);
    }
    // همان ترتیب امن پیوست تجهیز: اول فایل کنار گذاشته می‌شود، سپس رکورد.
    const staged = stageAttachmentRemoval(row.stored_name);
    try {
      db.prepare('DELETE FROM diagram_attachments WHERE id = ?').run(row.id);
    } catch (e) {
      if (staged?.restore) staged.restore();
      throw e;
    }
    if (staged?.commit) staged.commit();
    else removeAttachmentFile(row.stored_name);
    res.json({ deleted: 1 });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = getRow(id);
    const ids = descendantIds(id);
    db.prepare('DELETE FROM diagrams WHERE id = ?').run(id);
    log('info', `دیاگرام «${row.name}» و ${ids.length - 1} زیرمجموعهٔ آن حذف شد.`);
    res.json({ deleted: ids.length });
  } catch (e) {
    next(e);
  }
});

export default router;

// خطاهای اعتبارسنجی/تعارض، خطای سرور نیستند و نباید در گزارش رویدادها
// به‌عنوان خطای داخلی ثبت شوند.
router.use((err, _req, res, next) => {
  if (!(err instanceof DiagramError)) return next(err);
  res.status(err.status).json({ error: err.message });
});
