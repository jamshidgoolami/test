/**
 * آزمون مستقل RecordBatcher:
 *   • Flush خودکار بر اساس تعداد و زمان
 *   • SAVEPOINT مستقل برای هر نتیجه
 *   • Rollback کامل وقتی تراکنش بیرونی شکست می‌خورد
 */
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir, cleanupDir } from '../helpers.mjs';

const dir = useTempDataDir('engine-record-batch');
const { db, transaction } = await import('../../db.js');
const { RecordBatcher } = await import('../../engine-record-batch.js');

db.exec('CREATE TABLE batch_events(value TEXT NOT NULL)');
const rows = () =>
  db
    .prepare('SELECT value FROM batch_events ORDER BY rowid')
    .all()
    .map((row) => row.value);

beforeEach(() => {
  db.prepare('DELETE FROM batch_events').run();
});

after(() => {
  db.close();
  cleanupDir(dir);
});

test('maxBatch flushes immediately and isolates a failed item with its own savepoint', async () => {
  const batcher = new RecordBatcher({ transaction, maxBatch: 3, flushMs: 100 });
  const first = batcher.enqueue(() => transaction(() => db.prepare("INSERT INTO batch_events VALUES ('one')").run()));
  const failed = batcher.enqueue(() => {
    db.prepare("INSERT INTO batch_events VALUES ('rolled-back')").run();
    throw new Error('item-failure');
  });
  const third = batcher.enqueue(() => transaction(() => db.prepare("INSERT INTO batch_events VALUES ('three')").run()));

  const outcomes = await Promise.allSettled([first, failed, third]);
  assert.equal(outcomes[0].status, 'fulfilled');
  assert.equal(outcomes[1].status, 'rejected');
  assert.equal(outcomes[2].status, 'fulfilled');
  assert.deepEqual(rows(), ['one', 'three'], 'the failed item must roll back only its own savepoint');
  assert.equal(batcher.queue.length, 0);
  assert.equal(batcher.timer, null);
});

test('timer flush writes a small batch and releases its timer', async () => {
  const batcher = new RecordBatcher({ transaction, maxBatch: 10, flushMs: 15 });
  const pending = batcher.enqueue(() =>
    transaction(() => db.prepare("INSERT INTO batch_events VALUES ('timer')").run())
  );
  assert.ok(batcher.timer, 'the flush timer must be armed');
  await pending;
  assert.equal(batcher.timer, null);
  assert.deepEqual(rows(), ['timer']);
});

test('outer transaction failure rejects every queued item and rolls back all writes', async () => {
  const failingTransaction = (fn, options = {}) => {
    if (options.label === 'engine.record.batch') {
      return transaction(() => {
        fn();
        throw new Error('outer-commit-failure');
      }, options);
    }
    return transaction(fn, options);
  };
  const batcher = new RecordBatcher({ transaction: failingTransaction, maxBatch: 2, flushMs: 100 });
  const one = batcher.enqueue(() =>
    transaction(() => db.prepare("INSERT INTO batch_events VALUES ('outer-one')").run())
  );
  const two = batcher.enqueue(() =>
    transaction(() => db.prepare("INSERT INTO batch_events VALUES ('outer-two')").run())
  );

  const outcomes = await Promise.allSettled([one, two]);
  assert.deepEqual(
    outcomes.map((outcome) => outcome.status),
    ['rejected', 'rejected']
  );
  assert.deepEqual(rows(), [], 'an outer transaction failure must leave no partial writes');
  assert.equal(batcher.queue.length, 0);
  assert.equal(batcher.timer, null);
});
