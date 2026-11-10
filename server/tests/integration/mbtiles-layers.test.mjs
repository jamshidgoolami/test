/**
 * MBTiles و لایه‌ها:
 *   • فایل مورد استفادهٔ یک یا چند لایه حذف نمی‌شود (۴۰۹)
 *   • حذف لایه با فایل مشترک، فایل را نگه می‌دارد و فقط آخرین ارجاع آن را پاک می‌کند
 *   • ساخت/ویرایش لایه با فایل ناموجود یا ناسازگار رد می‌شود
 *   • حذف فایل ناموجود ۴۰۴ می‌دهد و فایل بی‌ارجاع با حذف صریح پاک می‌شود
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { useTempDataDir, cleanupDir, startServer, api } from '../helpers.mjs';

const dir = useTempDataDir('mbtiles-layers');
let srv;

before(async () => {
  srv = await startServer({ dataDir: dir, engine: false });
});

after(async () => {
  await srv.stop();
  cleanupDir(dir);
});

/** یک MBTiles حداقلی اما واقعی می‌سازد تا مسیر خواندن metadata هم آزموده شود. */
function makeTileFile(name) {
  fs.mkdirSync(path.join(dir, 'mbtiles'), { recursive: true });
  const file = path.join(dir, 'mbtiles', name);
  const conn = new DatabaseSync(file);
  try {
    conn.exec(`
      CREATE TABLE metadata (name TEXT, value TEXT);
      CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
      CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
      INSERT INTO metadata(name, value) VALUES ('format', 'png'), ('minzoom', '0'), ('maxzoom', '1');
      INSERT INTO tiles VALUES (0, 0, 0, x'89504e470d0a1a0a');
    `);
  } finally {
    conn.close();
  }
  return file;
}

test('an in-use MBTiles file cannot be deleted; layer deletion keeps shared files', async () => {
  const shared = `shared-${Date.now()}.mbtiles`;
  const sharedPath = makeTileFile(shared);

  const first = await api(srv.base, 'POST', '/api/layers', { name: 'shared-one', kind: 'mbtiles', file_name: shared });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const second = await api(srv.base, 'POST', '/api/layers', { name: 'shared-two', kind: 'mbtiles', file_name: shared });
  assert.equal(second.status, 201, JSON.stringify(second.data));

  const blocked = await api(srv.base, 'DELETE', `/api/mbtiles/files/${shared}`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.layers.length, 2);
  assert.ok(fs.existsSync(sharedPath), 'file referenced by layers must stay');

  const dropFirst = await api(srv.base, 'DELETE', `/api/layers/${first.data.id}?removeFile=1`);
  assert.equal(dropFirst.status, 200);
  assert.equal(dropFirst.data.deleted, 1);
  assert.equal(dropFirst.data.fileDeleted, false);
  assert.equal(dropFirst.data.fileKept, true);
  assert.ok(fs.existsSync(sharedPath), 'shared file must not be removed with the first layer');

  const dropLast = await api(srv.base, 'DELETE', `/api/layers/${second.data.id}?removeFile=1`);
  assert.equal(dropLast.status, 200);
  assert.equal(dropLast.data.fileDeleted, true);
  assert.equal(dropLast.data.fileKept, false);
  assert.ok(!fs.existsSync(sharedPath), 'last reference removes the file');
});

test('layers cannot be created or updated against a missing or mismatched file', async () => {
  const missingName = `missing-${Date.now()}.mbtiles`;
  const createMissing = await api(srv.base, 'POST', '/api/layers', { name: 'missing', kind: 'mbtiles', file_name: missingName });
  assert.equal(createMissing.status, 400);

  const empty = await api(srv.base, 'POST', '/api/layers', { name: 'empty', kind: 'empty' });
  assert.equal(empty.status, 201);
  const updateMissing = await api(srv.base, 'PUT', `/api/layers/${empty.data.id}`, { file_name: missingName, kind: 'mbtiles' });
  assert.equal(updateMissing.status, 400);

  const existingName = `existing-${Date.now()}.mbtiles`;
  makeTileFile(existingName);
  const mismatch = await api(srv.base, 'PUT', `/api/layers/${empty.data.id}`, { file_name: existingName, kind: 'empty' });
  assert.equal(mismatch.status, 400);

  const mbtilesNoFile = await api(srv.base, 'POST', '/api/layers', { name: 'no-file', kind: 'mbtiles' });
  assert.equal(mbtilesNoFile.status, 400);

  const deleted = await api(srv.base, 'DELETE', `/api/layers/${empty.data.id}`);
  assert.equal(deleted.status, 200);
});

test('deleting an unreferenced file works and unknown files return 404', async () => {
  const orphan = `orphan-${Date.now()}.mbtiles`;
  const orphanPath = makeTileFile(orphan);
  const layer = await api(srv.base, 'POST', '/api/layers', { name: 'orphan-layer', kind: 'mbtiles', file_name: orphan });
  assert.equal(layer.status, 201);

  // بدون removeFile رکورد می‌رود اما فایل می‌ماند؛ سپس حذف صریح فایل انجام می‌شود.
  const dropped = await api(srv.base, 'DELETE', `/api/layers/${layer.data.id}`);
  assert.equal(dropped.status, 200);
  assert.ok(fs.existsSync(orphanPath));
  assert.equal((await api(srv.base, 'DELETE', `/api/mbtiles/files/${orphan}`)).status, 200);
  assert.ok(!fs.existsSync(orphanPath));

  assert.equal((await api(srv.base, 'DELETE', `/api/mbtiles/files/not-there.mbtiles`)).status, 404);
});
