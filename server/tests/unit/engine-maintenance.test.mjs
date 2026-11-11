/**
 * آزمون مستقل maintenance:
 *   • Rollup روز جاری و به‌روزرسانی Uptime
 *   • Backfill روزهای جامانده
 *   • هرس تکه‌تکه
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir, cleanupDir, addDevice } from '../helpers.mjs';

const dir = useTempDataDir('engine-maintenance');
const { db, getSettings, setSettings, STATUS } = await import('../../db.js');
const { statements } = await import('../../engine-store.js');
const { backfillDays, localDayStart, pruneBatch, rollup, rollupDay } = await import('../../engine-maintenance.js');

const DAY = 86400000;
const insertSample = db.prepare(
  'INSERT INTO samples(device_id, ts, rtt_ms, packets_sent, packets_recv, loss_pct, status, ok, mode) VALUES (?,?,?,?,?,?,?,?,?)'
);

before(() => {
  setSettings({ timezone_offset_minutes: 0 });
});

after(() => {
  db.close();
  cleanupDir(dir);
});

test('rollup writes daily stats and recomputes device uptime', () => {
  const id = addDevice(db, { status: STATUS.ONLINE });
  const now = Date.now();
  insertSample.run(id, now - 3000, 10, 1, 1, 0, STATUS.ONLINE, 1, 'test');
  insertSample.run(id, now - 2000, 20, 1, 1, 0, STATUS.ONLINE, 1, 'test');
  insertSample.run(id, now - 1000, null, 1, 0, 100, STATUS.OFFLINE, 0, 'test');

  const errors = [];
  rollup({
    getSettings,
    statements: statements(),
    noteInternalError: (error) => errors.push(error),
    db,
    rollupDay,
  });
  assert.deepEqual(errors, []);
  const today = localDayStart(now, 0);
  const day = new Date(today).toISOString().slice(0, 10);
  const stat = db.prepare('SELECT * FROM daily_stats WHERE device_id = ? AND day = ?').get(id, day);
  assert.ok(stat, 'today must be rolled up');
  assert.equal(stat.checks, 3);
  assert.equal(stat.failed, 1);
  assert.ok(Math.abs(stat.uptime_pct - 66.67) < 0.1);
  assert.ok(db.prepare('SELECT uptime_pct FROM devices WHERE id = ?').get(id).uptime_pct >= 0);
});

test('backfillDays fills a missing historical day from raw samples', () => {
  const id = addDevice(db, { status: STATUS.ONLINE });
  const old = Date.now() - 5 * DAY;
  insertSample.run(id, old, 12, 1, 1, 0, STATUS.ONLINE, 1, 'test');
  const errors = [];
  const filled = backfillDays(
    {
      getSettings,
      db,
      log: () => {},
      rollupDay,
    },
    7
  );
  assert.ok(filled >= 3);
  const day = new Date(localDayStart(old, 0)).toISOString().slice(0, 10);
  const stat = db.prepare('SELECT checks FROM daily_stats WHERE device_id = ? AND day = ?').get(id, day);
  assert.ok(stat, 'the missing day must be backfilled');
  assert.equal(stat.checks, 1);
  assert.deepEqual(errors, []);
});

test('pruneBatch stops on a short batch and respects the per-run limit', () => {
  const changes = [5000, 5000, 123];
  const statement = {
    run: () => ({ changes: changes.shift() ?? 0 }),
  };
  assert.equal(pruneBatch(statement, Date.now(), 50000), 10123);
  assert.equal(changes.length, 0);
});
