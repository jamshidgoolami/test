/**
 * تاریخچهٔ سنسورهای دما و فن سرور:
 *   • هر خواندن BMC برای سنسورهای دما/فن نمونه ثبت می‌کند.
 *   • پاسخ /sensor-series سنسورها را با بازه‌بندی زمانی و واحد برمی‌گرداند.
 *   • سروری که هنوز خوانده نشده است، پاسخ معتبر با فهرست خالی می‌دهد.
 */
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { startServer, api, useTempDataDir, cleanupDir } from '../helpers.mjs';

const dir = useTempDataDir('server-sensors');
let server;

before(async () => {
  server = await startServer({ dataDir: dir, env: { NETWATCH_SEED_DEMO: '0' } });
});

after(async () => {
  await server?.stop();
  cleanupDir(dir);
});

async function createDemoServer(name) {
  const res = await api(server.base, 'POST', '/api/servers/demo', { name });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.server.id;
}

test('خواندن BMC سنسورهای دما و فن را در تاریخچه ثبت می‌کند', async () => {
  const id = await createDemoServer('سرور نمودار سنسور');
  const collect = await api(server.base, 'POST', `/api/servers/${id}/collect`, {});
  assert.equal(collect.status, 200, JSON.stringify(collect.data));

  const res = await api(server.base, 'GET', `/api/servers/${id}/sensor-series?range=1h`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.range, '1h');
  assert.equal(res.data.bucketMs, 5 * 60 * 1000);
  assert.equal(res.data.available.temperature > 0, true, 'سنسور دما باید ثبت شده باشد');
  assert.equal(res.data.available.fan > 0, true, 'سنسور فن باید ثبت شده باشد');

  const temperature = res.data.sensors.filter((sensor) => sensor.type === 'temperature');
  const fan = res.data.sensors.filter((sensor) => sensor.type === 'fan');
  assert.ok(temperature.length >= 1, 'حداقل یک سنسور دما در تاریخچه لازم است');
  assert.ok(fan.length >= 1, 'حداقل یک سنسور فن در تاریخچه لازم است');

  for (const sensor of [...temperature, ...fan]) {
    assert.ok(sensor.points.length >= 1, `${sensor.key} باید نمونه داشته باشد`);
    assert.equal(typeof sensor.points[0].reading, 'number');
    assert.equal(sensor.points[0].t % res.data.bucketMs, 0, 'زمان نمونه باید روی مرز بازه باشد');
    assert.ok(sensor.name.length > 0);
  }
  assert.equal(new Set(fan.map((sensor) => sensor.key)).size, fan.length, 'هر سنسور تنها یک سری دارد');
});

test('سرور خوانده‌نشده فهرست خالی با شمار صفر برمی‌گرداند', async () => {
  const id = await createDemoServer('سرور بدون خواندن');
  const res = await api(server.base, 'GET', `/api/servers/${id}/sensor-series?range=24h`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.bucketMs, 60 * 60 * 1000);
  assert.deepEqual(res.data.available, { temperature: 0, fan: 0 });
  assert.deepEqual(res.data.sensors, []);
});

test('شناسهٔ ناموجود و بازهٔ ناشناخته رفتار مشخص دارند', async () => {
  const missing = await api(server.base, 'GET', '/api/servers/999999/sensor-series');
  assert.equal(missing.status, 404);

  const id = await createDemoServer('سرور بازهٔ نامعتبر');
  const res = await api(server.base, 'GET', `/api/servers/${id}/sensor-series?range=year`);
  assert.equal(res.status, 200);
  assert.equal(res.data.bucketMs, 5 * 60 * 1000, 'بازهٔ ناشناخته به یک ساعت برمی‌گردد');
});
