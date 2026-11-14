/**
 * پایش سرورها: اعتبارسنجی ورودی Agent و شکل snapshot نمایشی.
 * این تست‌ها عمداً به پایگاه‌داده و سخت‌افزار واقعی وابسته نیستند.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentPayload } from '../../server-monitoring/normalize.js';
import { demoSnapshot } from '../../server-monitoring/demo.js';

test('Agent payload computes memory/disk percentages and keeps sources separate', () => {
  const now = Date.now();
  const snapshot = normalizeAgentPayload(
    {
      schemaVersion: 1,
      collectedAt: now,
      cpu: { usagePct: 37.5, model: 'Xeon', cores: 16, threads: 32 },
      memory: { totalBytes: 8_000_000_000, freeBytes: 2_000_000_000 },
      disks: [
        { key: 'C:', kind: 'volume', totalBytes: 1000, freeBytes: 250 },
        { key: 'C:', kind: 'volume', totalBytes: 1000, freeBytes: 250 },
      ],
      nics: [{ name: 'Ethernet', rxBps: 1_000_000, txBps: 2_000_000, linkStatus: 'up' }],
    },
    now
  );

  assert.equal(snapshot.metric.cpuPct, 37.5);
  assert.equal(snapshot.metric.memPct, 75);
  assert.equal(snapshot.metric.diskTotalBytes, 1000);
  assert.equal(snapshot.metric.diskUsedBytes, 750);
  assert.equal(snapshot.metric.netRxBps, 1_000_000);
  assert.equal(snapshot.metric.netTxBps, 2_000_000);
  assert.equal(snapshot.disks.length, 1, 'duplicate disk keys must be removed');
  assert.equal(snapshot.disks[0].usedPct, 75);
  assert.equal(snapshot.nics.length, 1);
  assert.equal(snapshot.inventory.cpuModel, 'Xeon');
});

test('Agent payload rejects an unsupported schema version', () => {
  assert.throws(() => normalizeAgentPayload({ schemaVersion: 99 }), /نسخهٔ Agent/);
  assert.throws(() => normalizeAgentPayload(null), /بدنهٔ Agent/);
});

test('out-of-range Agent values do not poison stored metrics', () => {
  const now = Date.now();
  const snapshot = normalizeAgentPayload(
    {
      schemaVersion: 1,
      collectedAt: now,
      cpu: { usagePct: 140 },
      memory: { totalBytes: 100, freeBytes: 500 },
      disks: [{ key: 'D:', totalBytes: 100, freeBytes: 500 }],
      nics: [{ name: 'x', rxBps: -5 }],
    },
    now
  );
  assert.equal(snapshot.metric.cpuPct, null);
  assert.equal(snapshot.metric.memPct, 0);
  assert.equal(snapshot.metric.netRxBps, null);
  assert.equal(snapshot.disks[0].usedPct, 0);
});

test('demo snapshot is internally consistent and labelled as demo', () => {
  const snapshot = demoSnapshot({ id: 7 }, Date.now());
  assert.equal(snapshot.metric.source, 'demo');
  assert.ok(snapshot.metric.cpuPct >= 0 && snapshot.metric.cpuPct <= 100);
  assert.ok(snapshot.sensors.length >= 4);
  assert.equal(snapshot.disks.filter((d) => d.kind === 'volume').length, 4);
  assert.equal(snapshot.nics.length, 2);
  assert.equal(snapshot.inventory.manufacturer, 'Supermicro');
});
