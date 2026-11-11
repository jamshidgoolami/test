/**
 * آزمون شبیه‌ساز مستقل موتور: خروجی همیشه برچسب simulate دارد و هرگز
 * ادعای سرویس سالم نمی‌کند. کش هم پس از پاک‌سازی همچنان قابل استفاده است.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSimulationCache, simulateCheck } from '../../engine-simulation.js';

const device = { id: 101, ip: '10.20.30.40' };

test('simulated checks keep the simulate contract', () => {
  for (let i = 0; i < 50; i++) {
    const result = simulateCheck(device, 3);
    assert.equal(result.mode, 'simulate');
    assert.equal(result.service, 'unknown');
    assert.equal(result.servicePort, null);
    assert.equal(result.packetsSent, 3);
    assert.ok(result.packetsRecv >= 0 && result.packetsRecv <= 3);
    assert.equal(result.reachable, result.packetsRecv > 0);
    if (result.reachable) {
      assert.ok(result.rtt > 0);
      assert.ok(result.lossPct >= 0 && result.lossPct < 100);
    } else {
      assert.equal(result.lossPct, 100);
      assert.equal(result.error, 'TIMEOUT');
    }
  }
});

test('clearing the simulation cache resets state without breaking checks', () => {
  simulateCheck(device, 1);
  clearSimulationCache();
  const result = simulateCheck(device, 4);
  assert.equal(result.packetsSent, 4);
  assert.equal(result.mode, 'simulate');
});
