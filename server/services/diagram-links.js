/**
 * NetWatch — پیوندها و نقشهٔ ارتباط دیاگرام‌ها
 * ----------------------------------------------------------------
 * پیوند دوطرفه، نقشهٔ ارتباط، تغییر نام برچسب‌ها و پاک‌سازی ارجاع‌ها در
 * این ماژول است. همهٔ تراکنش‌ها و پیام‌های لاگ قبلی حفظ شده‌اند.
 */
import crypto from 'node:crypto';
import { db, log, transaction } from '../db.js';
import {
  CONNECTION_KINDS,
  LINK_SIDES,
  MAX_DATA_BYTES,
  MAX_LINKS,
  MAX_NODES,
  DiagramError,
  cleanLinkKind,
  cleanLinkSide,
  getRow,
  linkPosition,
  nowMs,
  readGraph,
  text,
  writeGraph,
} from './diagram-graph.js';

export function linkTargets(graph) {
  const targets = new Set();
  for (const node of graph.nodes) {
    if (!node || node.type !== 'diagram') continue;
    const target = Number(node.data?.diagramId);
    if (Number.isInteger(target) && target > 0) targets.add(target);
  }
  return targets;
}

/** پیش‌شرط ظرفیت یک بوم برای افزودن جزء پیوند. */
export function assertLinkCapacity(graph, label) {
  const links = graph.nodes.filter((node) => node && node.type === 'diagram');
  if (links.length >= MAX_LINKS) {
    throw new DiagramError(`${label} حداکثر ${MAX_LINKS} پیوند می‌تواند داشته باشد.`);
  }
  if (graph.nodes.length >= MAX_NODES) {
    throw new DiagramError(`${label} حداکثر ${MAX_NODES} جزء می‌تواند داشته باشد.`);
  }
}

/** جزء پیوند برگشتی را در دیاگرام مقصد می‌سازد (یا نوعش را همگام می‌کند). */
export function ensureReciprocalLink(sourceRow, targetId, linkKind, { strict = true } = {}) {
  if (!Number.isInteger(targetId) || targetId <= 0 || targetId === sourceRow.id) {
    if (strict) throw new DiagramError('دیاگرام مقصد نامعتبر است.');
    return false;
  }
  let targetRow;
  try {
    targetRow = getRow(targetId);
  } catch {
    if (strict) throw new DiagramError('دیاگرام مقصد پیدا نشد.', 404);
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
    if (strict) {
      throw new DiagramError(
        `دیاگرام «${targetRow.name}» ظرفیت پیوند ندارد (حداکثر ${MAX_LINKS} پیوند و ${MAX_NODES} جزء).`
      );
    }
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
  if (Buffer.byteLength(JSON.stringify(next), 'utf8') > MAX_DATA_BYTES) {
    if (strict) throw new DiagramError(`حجم دیاگرام «${targetRow.name}» بیش از حد مجاز است.`);
    return false;
  }
  writeGraph(targetRow.id, next, nowMs());
  return true;
}

/** جزءهای پیوندِ دیاگرام مقصد که به `sourceId` اشاره می‌کنند را برمی‌دارد. */
export function removeReciprocalLink(sourceId, targetId) {
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
export function syncReciprocalLinks(sourceRow, previousGraph, nextGraph) {
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

/** بدنهٔ نقشهٔ ارتباط دیاگرام‌ها. */
export function graphPayload() {
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

  return {
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
  };
}

/** ایجاد پیوند دوطرفه؛ خروجی Row ذخیره‌شده است. */
export function createLink(id, body) {
  const targetId = Number(body?.targetId);
  if (!Number.isInteger(targetId) || targetId <= 0) throw new DiagramError('دیاگرام مقصد را انتخاب کنید.');
  if (targetId === id) throw new DiagramError('پیوند یک دیاگرام به خودش مجاز نیست.');
  const target = getRow(targetId);
  const label = text(body?.label, 120) || target.name;
  const description = text(body?.description, 300);
  const linkKind = cleanLinkKind(body?.linkKind ?? body?.kind);
  const fromSide = cleanLinkSide(body?.fromSide);
  const toSide = cleanLinkSide(body?.toSide);
  // ایجاد هر دو طرف در یک تراکنش: اگر طرف مقابل ظرفیت نداشته باشد یا نوشتن
  // آن شکست بخورد، پیوند یک‌طرفه در مبدأ باقی نمی‌ماند.
  const saved = transaction(
    () => {
      const row = getRow(id);
      const graph = readGraph(row);
      const targetGraph = readGraph(target);
      if (targetGraph.nodes.some((node) => node && node.type === 'diagram' && Number(node.data?.diagramId) === id)) {
        throw new DiagramError('این دو دیاگرام از قبل به هم پیوند دارند.');
      }
      const links = graph.nodes.filter((node) => node && node.type === 'diagram');
      if (links.some((node) => Number(node.data?.diagramId) === targetId)) {
        throw new DiagramError(`این دیاگرام از قبل به «${target.name}» پیوند دارد.`);
      }
      assertLinkCapacity(graph, 'دیاگرام مبدأ');
      assertLinkCapacity(targetGraph, `دیاگرام «${target.name}»`);
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
      writeGraph(id, next, nowMs());
      ensureReciprocalLink(getRow(id), targetId, linkKind, { strict: true });
      return getRow(id);
    },
    { label: 'diagram.link.create' }
  );
  const row = getRow(id);
  log('info', `پیوند دوطرفهٔ «${row.name}» ↔ «${target.name}» ساخته شد.`);
  return saved;
}

/** به‌روزرسانی پیوند؛ خروجی Row ذخیره‌شده است. */
export function updateLink(id, nodeId, body) {
  const row = getRow(id);
  const graph = readGraph(row);
  const index = graph.nodes.findIndex((node) => node && node.id === nodeId && node.type === 'diagram');
  if (index < 0) throw new DiagramError('پیوند پیدا نشد.', 404);
  const current = graph.nodes[index];
  const previousTargetId = Number(current.data?.diagramId);
  const targetId = body?.targetId === undefined ? Number(current.data?.diagramId) : Number(body.targetId);
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
  const targetGraph = readGraph(target);
  const targetAlreadyLinks = targetGraph.nodes.some(
    (node) => node && node.type === 'diagram' && Number(node.data?.diagramId) === id
  );
  if (!targetAlreadyLinks) assertLinkCapacity(targetGraph, `دیاگرام «${target.name}»`);
  const label =
    body?.label === undefined ? text(current.data?.label, 120) || target.name : text(body.label, 120) || target.name;
  const description =
    body?.description === undefined ? text(current.data?.description, 300) : text(body.description, 300);
  const kindInput = body?.linkKind ?? body?.kind;
  const linkKind =
    kindInput === undefined
      ? CONNECTION_KINDS.has(current.data?.linkKind)
        ? current.data.linkKind
        : 'fiber'
      : cleanLinkKind(kindInput);
  const data = { ...current.data, label, diagramId: targetId, linkKind };
  if (body?.fromSide !== undefined) {
    const fromSide = cleanLinkSide(body.fromSide);
    if (fromSide) data.fromSide = fromSide;
    else delete data.fromSide;
  }
  if (body?.toSide !== undefined) {
    const toSide = cleanLinkSide(body.toSide);
    if (toSide) data.toSide = toSide;
    else delete data.toSide;
  }
  if (description) data.description = description;
  else delete data.description;
  const next = {
    nodes: graph.nodes.map((node, position) => (position === index ? { ...current, data } : node)),
    edges: graph.edges,
  };
  const saved = transaction(
    () => {
      const savedRow = writeGraph(id, next, nowMs());
      if (previousTargetId !== targetId) removeReciprocalLink(id, previousTargetId);
      ensureReciprocalLink(savedRow, targetId, linkKind, { strict: true });
      return getRow(id);
    },
    { label: 'diagram.link.update' }
  );
  log('info', `پیوند دوطرفهٔ «${row.name}» ↔ «${target.name}» به‌روزرسانی شد.`);
  return saved;
}

/** حذف پیوند؛ خروجی Row ذخیره‌شده است. */
export function deleteLink(id, nodeId) {
  const row = getRow(id);
  const graph = readGraph(row);
  const linkNode = graph.nodes.find((node) => node && node.id === nodeId && node.type === 'diagram');
  if (!linkNode) throw new DiagramError('پیوند پیدا نشد.', 404);
  const previousTargetId = Number(linkNode.data?.diagramId);
  const next = {
    nodes: graph.nodes.filter((node) => node.id !== nodeId),
    edges: graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
  };
  const saved = transaction(
    () => {
      writeGraph(id, next, nowMs());
      removeReciprocalLink(id, previousTargetId);
      return getRow(id);
    },
    { label: 'diagram.link.delete' }
  );
  log('info', `پیوند دوطرفهٔ دیاگرام «${row.name}» حذف شد.`);
  return saved;
}

/**
 * با تغییر نام یک دیاگرام، برچسب جزءهای پیوندی که در بوم‌های دیگر به آن
 * اشاره می‌کنند هم به‌روز می‌شود. برچسبی که کاربر دستی عوض کرده (و با نام
 * قبلی یکی نیست) دست نمی‌خورد و نسخهٔ دیاگرام‌های تغییر‌یافته بالا می‌رود.
 */
export function renameLinkLabels(targetId, oldName, newName, stamp) {
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

/**
 * حذف ارجاع‌های خارجی به دیاگرام‌های حذف‌شده و یال‌های معلق از یک بوم.
 * فقط گرافِ تغییرکرده نوشته می‌شود و revision آن بالا می‌رود.
 */
export function cleanDiagramGraph(graph, ownerId, removedIds) {
  const removedNodes = new Set();
  const nodes = graph.nodes.filter((node) => {
    if (!node || node.type !== 'diagram') return true;
    const target = Number(node.data?.diagramId);
    if (!Number.isInteger(target) || target <= 0 || target === ownerId || removedIds.has(target)) {
      removedNodes.add(node.id);
      return false;
    }
    return true;
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  return {
    graph: { nodes, edges },
    removedNodes: removedNodes.size,
    changed: nodes.length !== graph.nodes.length || edges.length !== graph.edges.length,
  };
}

/** پاک‌سازی ارجاع‌ها در همهٔ بوم‌های باقی‌مانده (داخل تراکنش فراخوانده می‌شود). */
export function cleanupDiagramReferences(removedIds) {
  const rows = db.prepare('SELECT id, data FROM diagrams').all();
  let cleanedLinks = 0;
  let cleanedDiagrams = 0;
  for (const row of rows) {
    const result = cleanDiagramGraph(readGraph(row), row.id, removedIds);
    if (!result.changed) continue;
    writeGraph(row.id, result.graph, nowMs());
    cleanedLinks += result.removedNodes;
    cleanedDiagrams += 1;
  }
  return { cleanedLinks, cleanedDiagrams };
}

/**
 * پاک‌سازی لینک‌های شکسته (ارجاع به دیاگرام ناموجود یا خود) در شروع سرور.
 * حذف دیاگرام این کار را در همان تراکنش انجام می‌دهد؛ این تابع برای دادهٔ
 * بازمانده از نسخه‌های قبل و اصلاح دستی پایگاه‌داده است.
 */
export function pruneBrokenDiagramLinks() {
  return transaction(
    () => {
      const rows = db.prepare('SELECT id, data FROM diagrams').all();
      const valid = new Set(rows.map((row) => row.id));
      let links = 0;
      let diagrams = 0;
      for (const row of rows) {
        const graph = readGraph(row);
        const kept = graph.nodes.filter((node) => {
          if (!node || node.type !== 'diagram') return true;
          const target = Number(node.data?.diagramId);
          return Number.isInteger(target) && target > 0 && target !== row.id && valid.has(target);
        });
        const nodeIds = new Set(kept.map((node) => node.id));
        const edges = graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
        const removed = graph.nodes.length - kept.length;
        if (!removed && edges.length === graph.edges.length) continue;
        writeGraph(row.id, { nodes: kept, edges }, nowMs());
        links += removed;
        diagrams += 1;
      }
      return { links, diagrams };
    },
    { label: 'diagram.links.prune_broken' }
  );
}
