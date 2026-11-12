/**
 * در restoreMbtiles=false پایگاه‌داده از پشتیبان می‌آید ولی فایل‌های نقشه دست
 * نمی‌خورند؛ پس ارجاع‌های map_layers باید با فایل‌های موجود همان پوشه بخوانند.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { useTempDataDir, cleanupDir } from '../helpers.mjs';

const dir = useTempDataDir('backup-map-check');
const { db, MBTILES_DIR } = await import('../../db.js');
const { createBackup, restoreBackup } = await import('../../backup.js');

after(() => {
  db.close();
  cleanupDir(dir);
});

function addLayer(name, fileName) {
  db.prepare(
    `INSERT INTO map_layers(name, description, kind, file_name, min_zoom, max_zoom, attribution, visible, is_default, tile_count, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(name, '', 'mbtiles', fileName, 0, 19, '', 1, 0, 0, Date.now());
}

function removeLayer(name) {
  db.prepare('DELETE FROM map_layers WHERE name = ?').run(name);
}

test('a database-only restore succeeds when referenced MBTiles already exist', () => {
  const name = `existing-map-${Date.now()}`;
  const fileName = `${name}.mbtiles`;
  fs.mkdirSync(MBTILES_DIR, { recursive: true });
  fs.writeFileSync(path.join(MBTILES_DIR, fileName), 'existing-map');
  addLayer(name, fileName);
  const backup = createBackup({ includeMbtiles: false, reason: 'map-existing' });
  try {
    const result = restoreBackup(backup.dir, { force: true, restoreMbtiles: false });
    assert.equal(result.restored, true);
    assert.ok(db.prepare('SELECT id FROM map_layers WHERE name = ?').get(name));
  } finally {
    removeLayer(name);
    fs.rmSync(path.join(MBTILES_DIR, fileName), { force: true });
  }
});

test('a database-only restore is rejected when a referenced MBTiles file is missing', () => {
  const name = `missing-map-${Date.now()}`;
  const fileName = `${name}.mbtiles`;
  addLayer(name, fileName);
  const backup = createBackup({ includeMbtiles: false, reason: 'map-missing' });
  try {
    assert.throws(
      () => restoreBackup(backup.dir, { force: true, restoreMbtiles: false }),
      (error) => /فایل‌های نقشهٔ غایب/.test(error.message)
    );
    assert.ok(
      db.prepare('SELECT id FROM map_layers WHERE name = ?').get(name),
      'the original database must be restored after rejection'
    );
  } finally {
    removeLayer(name);
  }
});
