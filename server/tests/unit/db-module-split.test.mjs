/**
 * آزمون قرارداد Refactor لایه دیتابیس:
 *   • Exportهای عمومی قبلی حفظ شده‌اند.
 *   • نصب تازه Schema کامل و سالم است.
 *   • اجرای دوباره Migrationها idempotent است.
 *   • SAVEPOINT تودرتو فقط بلوک داخلی را Rollback می‌کند.
 *   • Close/Reopen داده و Prepared Queryها را حفظ می‌کند.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir, cleanupDir } from '../helpers.mjs';

const dir = useTempDataDir('db-module-split');
const dbModule = await import('../../db.js');
const {
  db,
  SCHEMA_VERSION,
  runMigrations,
  transaction,
  checkDatabaseHealth,
} = dbModule;

after(() => {
  db.close();
  cleanupDir(dir);
});

test('the public database contract is preserved', () => {
  for (const name of [
    'DATA_DIR',
    'MBTILES_DIR',
    'DB_PATH',
    'SCHEMA_VERSION',
    'SYNC_MODE',
    'db',
    'transaction',
    'requireDiskSpace',
    'diskSpace',
    'STATUS',
    'DEFAULT_SETTINGS',
    'applyMigrationStep',
    'runMigrations',
    'refreshQueryStats',
    'checkDatabaseHealth',
    'verifyDatabaseAtStartup',
    'ensureDefaultSettings',
    'getSettings',
    'sanitizeSettings',
    'setSettings',
    'log',
    'seedIfEmpty',
  ]) {
    assert.ok(name in dbModule, `missing export: ${name}`);
  }
});

test('a fresh database is initialized at the current schema version', () => {
  assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get().c, SCHEMA_VERSION);
  const health = checkDatabaseHealth({ full: true });
  assert.equal(health.ok, true, health.errors.join(' | '));
});

test('running migrations again does not duplicate or change applied steps', () => {
  const before = db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all();
  runMigrations();
  runMigrations();
  const afterRuns = db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all();
  assert.deepEqual(afterRuns, before);
  assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), SCHEMA_VERSION);
});

test('nested transactions roll back only the inner savepoint', () => {
  db.exec('CREATE TABLE IF NOT EXISTS tx_probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  try {
    transaction(() => {
      db.prepare("INSERT INTO tx_probe(value) VALUES ('outer')").run();
      assert.throws(() => {
        transaction(() => {
          db.prepare("INSERT INTO tx_probe(value) VALUES ('inner')").run();
          throw new Error('inner failure');
        }, { label: 'inner' });
      }, /inner failure/);
    }, { label: 'outer' });
    const values = db.prepare('SELECT value FROM tx_probe ORDER BY id').all().map((r) => r.value);
    assert.deepEqual(values, ['outer']);
  } finally {
    db.exec('DROP TABLE IF EXISTS tx_probe');
  }
});

test('closing and reopening preserves committed data and query access', () => {
  const stamp = `split-${Date.now()}`;
  db.prepare('INSERT INTO engine_log(ts, level, message) VALUES (?,?,?)').run(Date.now(), 'info', stamp);
  db.close();
  db.reopen();
  const row = db.prepare('SELECT message FROM engine_log WHERE message = ?').get(stamp);
  assert.equal(row?.message, stamp);
  assert.equal(checkDatabaseHealth({ full: false }).ok, true);
});
