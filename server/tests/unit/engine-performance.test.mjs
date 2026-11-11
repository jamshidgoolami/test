/**
 * آزمون بار و منابع Engine:
 *   • RecordBatch با ۲۰۰۰ نوشتن
 *   • Tick با ۱۲۰ تجهیز و سقف هم‌زمانی
 *   • آزادشدن Timer/صف/هشدارهای معوق پس از Stop
 * معیارهای حافظه سخاوتمندانه‌اند تا آزمون در CI ناپایدار نشود؛ عدد واقعی
 * اندازه‌گیری‌شده در خروجی چاپ می‌شود.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir, cleanupDir, addDevice, probeResult, waitFor } from '../helpers.mjs';

const dir = useTempDataDir('engine-performance');
const { db, setSettings, transaction } = await import('../../db.js');
const { RecordBatcher } = await import('../../engine-record-batch.js');
const { MonitoringEngine } = await import('../../engine.js');

db.exec('CREATE TABLE perf_rows(value INTEGER NOT NULL)');

before(() => {
  setSettings({
    engine_mode: 'simulate',
    engine_enabled: 1,
    ping_interval: 30,
    max_workers: 8,
    alerting_enabled: false,
  });
});

after(() => {
  db.close();
  cleanupDir(dir);
});

test('2000 record writes drain with bounded queue, time and memory', async () => {
  const beforeHeap = process.memoryUsage().heapUsed;
  const started = Date.now();
  const batcher = new RecordBatcher({ transaction, maxBatch: 128, flushMs: 2 });
  const writes = [];
  for (let i = 0; i < 2000; i++) {
    writes.push(batcher.enqueue(() => transaction(() => db.prepare('INSERT INTO perf_rows(value) VALUES (?)').run(i))));
  }
  await Promise.all(writes);
  const elapsed = Date.now() - started;
  const heapDelta = process.memoryUsage().heapUsed - beforeHeap;
  const count = db.prepare('SELECT COUNT(*) c FROM perf_rows').get().c;

  console.log(`[perf] record-batch rows=${count} elapsedMs=${elapsed} heapDeltaBytes=${heapDelta}`);
  assert.equal(count, 2000);
  assert.equal(batcher.queue.length, 0);
  assert.equal(batcher.timer, null);
  assert.ok(elapsed < 5000, `2000 batched writes took ${elapsed}ms`);
  assert.ok(heapDelta < 64 * 1024 * 1024, `heap grew by ${heapDelta} bytes`);
});

test('120 due devices respect max_workers and leave no engine resources after stop', async () => {
  for (let i = 0; i < 120; i++) {
    addDevice(db, {
      name: `perf-${i}`,
      ip: `10.240.${Math.floor(i / 250)}.${(i % 250) + 1}`,
      ping_interval: 30,
      next_check_at: 0,
      status: 'online',
    });
  }

  const engine = new MonitoringEngine({ emitToBus: false });
  engine.running = true;
  engine.settingsCache = { at: 0, value: undefined };
  let active = 0;
  let peak = 0;
  engine.probe = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return probeResult(true);
  };

  const started = Date.now();
  for (let i = 0; i < 80; i++) {
    await engine.tick();
    await waitFor(() => engine.inflight.size === 0, { timeout: 2000 });
    const checked = db.prepare('SELECT COUNT(*) c FROM samples WHERE device_id >= 1 AND mode = ?').get('test').c;
    if (checked >= 120) break;
  }
  const elapsed = Date.now() - started;
  const checked = db.prepare('SELECT COUNT(*) c FROM samples WHERE mode = ?').get('test').c;
  await engine.stop({ drainMs: 0 });

  console.log(`[perf] engine checks=${checked} peakWorkers=${peak} elapsedMs=${elapsed}`);
  assert.equal(checked, 120);
  assert.ok(peak <= 8, `peak concurrent probes=${peak} exceeded max_workers=8`);
  assert.equal(engine.stats.internalErrors, 0);
  assert.equal(engine.timer, null);
  assert.equal(engine.leaseTimer, null);
  assert.equal(engine.records.timer, null);
  assert.equal(engine.alerts.pending.size, 0);
  assert.equal(engine.inflight.size, 0);
});
