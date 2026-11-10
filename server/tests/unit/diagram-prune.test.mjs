/**
 * پاک‌سازی لینک‌های شکسته در Startup:
 * ارجاع به دیاگرام ناموجود، خودارجاعی و یال‌های معلق باید حذف شوند و
 * پیوندهای معتبر بمانند؛ اجرای دوباره باید بی‌اثر (idempotent) باشد.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupDir, useTempDataDir } from '../helpers.mjs';

const dir = useTempDataDir('diagram-prune');
const { db, seedIfEmpty } = await import('../../db.js');
const { pruneBrokenDiagramLinks } = await import('../../routes/diagrams.js');

seedIfEmpty();
after(() => cleanupDir(dir));
const now = Date.now();
const insert = db.prepare(
  `INSERT INTO diagrams(parent_id, name, description, data, revision, created_by, created_at, updated_at)
   VALUES (NULL, ?, '', ?, 1, 'test', ?, ?)`
);

const targetId = Number(insert.run('target', '{"nodes":[],"edges":[]}', now, now).lastInsertRowid);
const keepId = Number(
  insert.run(
    'keep',
    JSON.stringify({
      nodes: [
        { id: 'valid', type: 'diagram', position: { x: 0, y: 0 }, width: 220, height: 80, data: { diagramId: targetId } },
        { id: 'missing', type: 'diagram', position: { x: 0, y: 100 }, width: 220, height: 80, data: { diagramId: 999999 } },
        { id: 'self', type: 'diagram', position: { x: 0, y: 200 }, width: 220, height: 80, data: { diagramId: 0 } },
        { id: 'shape', type: 'shape', position: { x: 0, y: 300 }, width: 100, height: 50, data: {} },
      ],
      edges: [
        { id: 'good', source: 'valid', target: 'shape', kind: 'fiber', label: '' },
        { id: 'dangling', source: 'missing', target: 'shape', kind: 'fiber', label: '' },
      ],
    }),
    now,
    now
  ).lastInsertRowid
);

test('startup pruning removes broken/self links and their edges, keeping valid links', () => {
  const result = pruneBrokenDiagramLinks();
  assert.deepEqual(result, { links: 2, diagrams: 1 });

  const row = db.prepare('SELECT data, revision FROM diagrams WHERE id = ?').get(keepId);
  assert.equal(row.revision, 2, 'a changed canvas is versioned');
  const graph = JSON.parse(row.data);
  assert.deepEqual(graph.nodes.map((node) => node.id), ['valid', 'shape']);
  assert.deepEqual(graph.edges.map((edge) => edge.id), ['good']);

  assert.deepEqual(pruneBrokenDiagramLinks(), { links: 0, diagrams: 0 }, 'second run is a no-op');
  db.close();
});
