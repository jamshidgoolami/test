/**
 * آزمون مستقل لایهٔ Probe:
 *   • مهلت سخت
 *   • لغو با AbortSignal
 *   • Retry واقعی TCP
 *   • قرارداد حالت simulate و تشخیص علت
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { guessCause, probeWithDeadline, runProbe } from '../../engine-probe.js';

const device = { id: 1, ip: '127.0.0.1' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('probeWithDeadline returns a completed probe result', async () => {
  const result = await probeWithDeadline(async () => ({ ok: true, mode: 'test' }), device, {}, 1000);
  assert.deepEqual(result, { ok: true, mode: 'test' });
});

test('probeWithDeadline rejects a hung probe with PROBE_DEADLINE', async () => {
  const started = Date.now();
  await assert.rejects(
    () => probeWithDeadline(() => new Promise(() => {}), device, { timeoutMs: 100, count: 1, retries: 0 }, 60),
    (error) => error.code === 'PROBE_DEADLINE'
  );
  assert.ok(Date.now() - started < 1000, 'the deadline must not wait for the hung probe');
});

test('runProbe honors an already-aborted signal without starting a protocol probe', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runProbe(device, {
    timeoutMs: 100,
    count: 1,
    retries: 0,
    mode: 'tcp',
    port: 1,
    signal: controller.signal,
  });
  assert.equal(result.mode, 'cancelled');
  assert.equal(result.error, 'CANCELLED');
  assert.equal(result.packetsSent, 0);
});

test('runProbe keeps the simulate contract', async () => {
  const result = await runProbe(device, { timeoutMs: 50, count: 2, retries: 0, mode: 'simulate', port: 80 });
  assert.equal(result.mode, 'simulate');
  assert.equal(result.packetsSent, 2);
  assert.ok(result.packetsRecv >= 0 && result.packetsRecv <= 2);
});

test('runProbe retries a failed TCP probe with the configured delay', async () => {
  const started = Date.now();
  const result = await runProbe(device, { timeoutMs: 100, count: 1, retries: 2, mode: 'tcp', port: 1 });
  const elapsed = Date.now() - started;
  assert.equal(result.ok, false);
  assert.ok(elapsed >= 350, `expected two 200ms retry delays, elapsed=${elapsed}ms`);
  await sleep(0);
});

test('guessCause maps probe errors to the existing operational causes', () => {
  assert.equal(guessCause({ error: 'TIMEOUT' }, 1), 'Ping Timeout');
  assert.equal(guessCause({ error: 'SERVICE_UNAVAILABLE' }, 1), 'سرویس روی پورت مورد پایش پاسخ نمی‌دهد');
  assert.equal(guessCause({ error: 'ENETUNREACH' }, 1), 'اختلال در زیرساخت فیبر نوری');
  assert.equal(guessCause({ error: 'OTHER' }, 10), 'هنگ کردن سوئیچ');
  assert.equal(guessCause({ error: 'OTHER' }, 1), 'مشکل شبکه');
});
