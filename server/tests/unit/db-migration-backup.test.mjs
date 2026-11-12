/**
 * پشتیبان پیش از Migration باید یک عکس کامل از جمله تراکنش‌های موجود در WAL
 * باشد؛ و اگر ساخت پشتیبان شکست بخورد، Migration نباید شروع شود.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { useTempDataDir, cleanupDir } from '../helpers.mjs';
import { DatabaseHandle } from '../../db-connection.js';
import { SCHEMA_SQL } from '../../db-schema.js';
import { createMigrationRunner } from '../../db-migrations.js';

const dir = useTempDataDir('db-migration-backup');
after(() => cleanupDir(dir));

function prepareLegacy(file, marker) {
  const handle = new DatabaseHandle(file);
  handle.exec(SCHEMA_SQL);
  handle.exec('PRAGMA user_version = 21');
  // جدول retention_state توسط Migration 3 ساخته می‌شود؛ این تست عمداً یک
  // دیتابیس حداقلی می‌سازد، پس فقط وابستگی ترمیم idempotent را فراهم می‌کند.
  handle.exec(`CREATE TABLE IF NOT EXISTS retention_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    stop_requested INTEGER NOT NULL DEFAULT 0
  )`);
  handle.exec('INSERT OR IGNORE INTO retention_state(id) VALUES (1)');
  handle.exec('CREATE TABLE IF NOT EXISTS migration_backup_probe(id INTEGER PRIMARY KEY, note TEXT NOT NULL)');
  handle.prepare('INSERT INTO migration_backup_probe(note) VALUES (?)').run(marker);
  return handle;
}

test('pre-migration backup includes committed rows that are still in WAL', () => {
  const dbFile = path.join(dir, 'wal.db');
  const handle = prepareLegacy(dbFile, 'wal-marker');
  try {
    assert.ok(fs.existsSync(`${dbFile}-wal`) && fs.statSync(`${dbFile}-wal`).size > 0, 'test setup needs a non-empty WAL');

    const runner = createMigrationRunner({
      db: handle,
      dbPath: dbFile,
      dbExisted: true,
      log: () => {},
    });
    runner.initializeMigrations();

    const backups = fs.readdirSync(dir).filter((name) => name.includes('.pre-migration-v21-'));
    assert.equal(backups.length, 1, `expected one migration backup, got ${backups.join(', ')}`);

    const backup = new DatabaseSync(path.join(dir, backups[0]), { readOnly: true });
    try {
      assert.equal(backup.prepare('SELECT note FROM migration_backup_probe LIMIT 1').get()?.note, 'wal-marker');
      assert.equal(Number(backup.prepare('PRAGMA user_version').get().user_version), 21);
    } finally {
      backup.close();
    }
  } finally {
    handle.close();
  }
});

test('a failed pre-migration backup aborts migration and leaves no partial backup', () => {
  const dbFile = path.join(dir, 'failed.db');
  const handle = prepareLegacy(dbFile, 'not-migrated');
  const originalPrepare = handle.prepare.bind(handle);
  handle.prepare = (sql) => {
    if (String(sql).trim().startsWith('VACUUM INTO')) throw new Error('simulated backup write failure');
    return originalPrepare(sql);
  };
  try {
    const runner = createMigrationRunner({
      db: handle,
      dbPath: dbFile,
      dbExisted: true,
      log: () => {},
    });

    assert.throws(
      () => runner.initializeMigrations(),
      (error) => error.code === 'DB_BACKUP_INVALID' && /پشتیبان پیش از Migration/.test(error.message)
    );
    assert.equal(Number(handle.prepare('PRAGMA user_version').get().user_version), 21, 'migration must not start');
    assert.equal(
      fs.readdirSync(dir).filter((name) => name.startsWith('failed.db.pre-migration-v21-')).length,
      0,
      'a failed backup must not leave a published file'
    );
  } finally {
    handle.close();
  }
});
