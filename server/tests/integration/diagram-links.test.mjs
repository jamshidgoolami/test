/**
 * پیوند دیاگرام‌ها:
 *   • ایجاد/حذف پیوند، هر دو طرف را در یک تراکنش و با revision هر دو ذخیره می‌کند
 *   • ظرفیت پر دیاگرام مقصد، پیوند مبدأ را هم برمی‌گرداند (بدون پیوند یک‌طرفه)
 *   • حذف دیاگرام، ارجاع‌های بوم‌های دیگر و یال‌های معلق را پاک می‌کند
 *   • پیوست‌های دیاگرام حذف‌شده روی دیسک نمی‌مانند
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { api, cleanupDir, startServer, upload, useTempDataDir } from '../helpers.mjs';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const dir = useTempDataDir('diagram-links');
let srv;

before(async () => {
  srv = await startServer({ dataDir: dir, engine: false });
});

after(async () => {
  await srv.stop();
  cleanupDir(dir);
});

async function createDiagram(name) {
  const res = await api(srv.base, 'POST', '/api/diagrams', { name });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data;
}

function diagramNode(id, target, label = 'link') {
  return {
    id,
    type: 'diagram',
    position: { x: 10, y: id.length * 10 },
    width: 220,
    height: 80,
    data: { label, diagramId: target, linkKind: 'fiber' },
  };
}

test('creating and deleting a link updates both diagrams and their revisions', async () => {
  const a = await createDiagram('link-a');
  const b = await createDiagram('link-b');

  const linked = await api(srv.base, 'POST', `/api/diagrams/${a.id}/links`, {
    targetId: b.id,
    linkKind: 'fiber',
    label: 'A to B',
  });
  assert.equal(linked.status, 201, JSON.stringify(linked.data));
  assert.equal(linked.data.revision, a.revision + 1);
  const linkNode = linked.data.nodes.find((node) => node.type === 'diagram' && Number(node.data.diagramId) === b.id);
  assert.ok(linkNode, 'source link node exists');

  const bAfter = await api(srv.base, 'GET', `/api/diagrams/${b.id}`);
  assert.equal(bAfter.status, 200);
  assert.equal(bAfter.data.revision, b.revision + 1, 'target revision must be bumped');
  assert.equal(
    bAfter.data.nodes.filter((node) => node.type === 'diagram' && Number(node.data.diagramId) === a.id).length,
    1,
    'exactly one reciprocal node'
  );

  const graph = await api(srv.base, 'GET', '/api/diagrams/graph');
  assert.equal(graph.status, 200);
  assert.equal(graph.data.links.length, 1, 'a reciprocal pair is one graph edge');
  assert.equal(graph.data.broken.length, 0);

  const unlinked = await api(srv.base, 'DELETE', `/api/diagrams/${a.id}/links/${linkNode.id}`);
  assert.equal(unlinked.status, 200, JSON.stringify(unlinked.data));
  assert.equal(unlinked.data.revision, a.revision + 2);
  assert.equal(unlinked.data.nodes.filter((node) => node.type === 'diagram').length, 0);
  const bFinal = await api(srv.base, 'GET', `/api/diagrams/${b.id}`);
  assert.equal(bFinal.data.revision, b.revision + 2, 'target revision must be bumped on unlink');
  assert.equal(bFinal.data.nodes.filter((node) => node.type === 'diagram').length, 0);

  // پیوند دوباره و سپس حذف کل دیاگرام مبدأ: طرف مقابل باید پاک شود.
  const relinked = await api(srv.base, 'POST', `/api/diagrams/${a.id}/links`, { targetId: b.id });
  assert.equal(relinked.status, 201);
  const removed = await api(srv.base, 'DELETE', `/api/diagrams/${a.id}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.data.deleted, 1);
  assert.equal(removed.data.cleanedLinks, 1);
  const bClean = await api(srv.base, 'GET', `/api/diagrams/${b.id}`);
  assert.equal(bClean.data.nodes.filter((node) => node.type === 'diagram').length, 0);
  assert.equal((await api(srv.base, 'DELETE', `/api/diagrams/${b.id}`)).status, 200);
});

test('a full target rejects the link and rolls back the source transaction', async () => {
  const source = await createDiagram('capacity-source');
  const target = await createDiagram('capacity-target');
  const sink = await createDiagram('capacity-sink');

  // ۲۰۰ جزء پیوند در مقصد (سقف MAX_LINKS) تا افزودن پیوند بعدی ممکن نباشد.
  const nodes = Array.from({ length: 200 }, (_, index) =>
    diagramNode(`cap-${index}`, sink.id, `sink-${index}`)
  );
  const filled = await api(srv.base, 'PUT', `/api/diagrams/${target.id}/content`, {
    revision: target.revision,
    nodes,
    edges: [],
  });
  assert.equal(filled.status, 200, JSON.stringify(filled.data));
  assert.equal(filled.data.nodes.length, 200);

  const sourceBefore = await api(srv.base, 'GET', `/api/diagrams/${source.id}`);
  const targetBefore = await api(srv.base, 'GET', `/api/diagrams/${target.id}`);
  const linkAttempt = await api(srv.base, 'POST', `/api/diagrams/${source.id}/links`, { targetId: target.id });
  assert.equal(linkAttempt.status, 400, JSON.stringify(linkAttempt.data));
  assert.match(linkAttempt.data.error, /حداکثر 200 پیوند|ظرفیت/);

  const sourceAfter = await api(srv.base, 'GET', `/api/diagrams/${source.id}`);
  const targetAfter = await api(srv.base, 'GET', `/api/diagrams/${target.id}`);
  assert.equal(sourceAfter.data.revision, sourceBefore.data.revision, 'source transaction rolled back');
  assert.equal(targetAfter.data.revision, targetBefore.data.revision, 'target untouched');
  assert.equal(sourceAfter.data.nodes.length, 0);
  assert.equal(targetAfter.data.nodes.length, 200);

  // همان بررسی از مسیر ذخیرهٔ کامل بوم: پیوند خودکار نباید یک‌طرفه بماند.
  const saveAttempt = await api(srv.base, 'PUT', `/api/diagrams/${source.id}/content`, {
    revision: sourceAfter.data.revision,
    nodes: [diagramNode('from-save', target.id)],
    edges: [],
  });
  assert.equal(saveAttempt.status, 400, JSON.stringify(saveAttempt.data));
  const sourceFinal = await api(srv.base, 'GET', `/api/diagrams/${source.id}`);
  assert.equal(sourceFinal.data.nodes.length, 0);
  assert.equal(sourceFinal.data.revision, sourceAfter.data.revision);

  // پاک‌سازی تا پیوند دوطرفهٔ ظرفیت‌پر، آزمون بعدی را آلوده نکند.
  for (const id of [target.id, sink.id, source.id]) {
    assert.equal((await api(srv.base, 'DELETE', `/api/diagrams/${id}`)).status, 200);
  }
});

test('deleting a diagram cleans references in other canvases and removes attachment files', async () => {
  const a = await createDiagram('delete-a');
  const b = await createDiagram('delete-b');
  const c = await createDiagram('delete-c');

  assert.equal((await api(srv.base, 'POST', `/api/diagrams/${a.id}/links`, { targetId: b.id })).status, 201);
  assert.equal((await api(srv.base, 'POST', `/api/diagrams/${c.id}/links`, { targetId: a.id })).status, 201);

  const uploaded = await upload(srv.base, `/api/diagrams/${a.id}/attachments`, {
    filename: 'plan.png',
    content: PNG_1PX,
    type: 'image/png',
  });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  const attachmentsDir = path.join(dir, 'attachments');
  const filesBefore = fs.readdirSync(attachmentsDir).length;
  assert.ok(filesBefore >= 1);

  const aBefore = await api(srv.base, 'GET', `/api/diagrams/${a.id}`);
  const bDeleted = await api(srv.base, 'DELETE', `/api/diagrams/${b.id}`);
  assert.equal(bDeleted.status, 200);
  assert.equal(bDeleted.data.cleanedLinks, 1, 'link to B in A must be removed');
  assert.equal(bDeleted.data.cleanedDiagrams, 1);

  const aAfter = await api(srv.base, 'GET', `/api/diagrams/${a.id}`);
  assert.equal(aAfter.data.revision, aBefore.data.revision + 1);
  assert.equal(
    aAfter.data.nodes.filter((node) => node.type === 'diagram' && Number(node.data.diagramId) === b.id).length,
    0
  );
  const cAfterB = await api(srv.base, 'GET', `/api/diagrams/${c.id}`);
  assert.ok(
    cAfterB.data.nodes.some((node) => node.type === 'diagram' && Number(node.data.diagramId) === a.id),
    'unrelated link to A stays'
  );

  const deletedA = await api(srv.base, 'DELETE', `/api/diagrams/${a.id}`);
  assert.equal(deletedA.status, 200);
  assert.equal(deletedA.data.cleanedLinks, 1, 'link to A in C must be removed');
  const cFinal = await api(srv.base, 'GET', `/api/diagrams/${c.id}`);
  assert.equal(cFinal.data.nodes.filter((node) => node.type === 'diagram').length, 0);

  assert.equal(fs.readdirSync(attachmentsDir).length, filesBefore - 1, 'attachment file removed from disk');
  const graph = await api(srv.base, 'GET', '/api/diagrams/graph');
  assert.equal(graph.data.broken.length, 0);
  assert.equal(graph.data.links.length, 0);
});

