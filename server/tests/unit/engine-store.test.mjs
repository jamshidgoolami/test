/**
 * آزمون مستقل لایهٔ Prepared Statementهای موتور.
 * SQL و ترتیب انتخاب تجهیزات سررسیدشده نباید با استخراج ماژول تغییر کند.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir, cleanupDir, addDevice } from '../helpers.mjs';

const dir = useTempDataDir('engine-store');
const { db } = await import('../../db.js');
const { statements } = await import('../../engine-store.js');

after(() => {
  db.close();
  cleanupDir(dir);
});

test('due statement selects only enabled monitored devices in priority order', () => {
  const now = Date.now();
  const normal = addDevice(db, { priority: 'normal', next_check_at: now - 100 });
  const critical = addDevice(db, { priority: 'critical', next_check_at: now - 100 });
  const high = addDevice(db, { priority: 'high', next_check_at: now - 100 });
  addDevice(db, { priority: 'critical', enabled: 0, next_check_at: now - 100 });
  addDevice(db, { priority: 'critical', monitoring_enabled: 0, next_check_at: now - 100 });
  addDevice(db, { priority: 'critical', next_check_at: now + 60_000 });

  const rows = statements().due.all(now, 10);
  assert.deepEqual(
    rows.map((row) => row.id),
    [critical, high, normal],
    'only enabled/monitored due devices, ordered critical → high → normal'
  );
  assert.equal(statements().overdue.get(now).c, 3);
});

test('prepared statements propagate database errors unchanged', () => {
  const deviceId = addDevice(db, { priority: 'normal', next_check_at: 0 });
  assert.equal(statements().exists.get(deviceId).id, deviceId);

  db.exec(
    "CREATE TRIGGER engine_store_block_sample BEFORE INSERT ON samples BEGIN SELECT RAISE(ABORT, 'store-block'); END"
  );
  try {
    assert.throws(
      () => statements().insertSample.run(deviceId, Date.now(), 5, 1, 1, 0, 'online', 1, 'test', null, Date.now()),
      /store-block/
    );
  } finally {
    db.exec('DROP TRIGGER IF EXISTS engine_store_block_sample');
  }
});
