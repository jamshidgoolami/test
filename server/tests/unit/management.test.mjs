/**
 * قالب تجهیز (بدون بازنویسی ناخواسته) و عضویت چندگروهی.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { useTempDataDir, cleanupDir, addDevice } from '../helpers.mjs';

const dir = useTempDataDir('management');
const { db } = await import('../../db.js');
const { getDevice, setDeviceGroups, groupsFor, updateDevice } = await import('../../store.js');
const { createTemplate, applyTemplate, updateTemplate, normalizeTemplateSettings } = await import('../../management.js');

test.after(() => {
  db.close();
  cleanupDir(dir);
});

test('قالب فقط فیلدهای مجاز را نگه می‌دارد', () => {
  const clean = normalizeTemplateSettings({ vendor: 'Cisco', ping_interval: 60, ip: '1.1.1.1', name: 'x', bogus: 1 });
  assert.deepEqual(clean, { vendor: 'Cisco', ping_interval: 60 });
});

test('اعمال قالب بدون تأیید، تنظیمات اختصاصی تجهیز را بازنویسی نمی‌کند', () => {
  const id = addDevice(db, { name: 'سوئیچ قالب', ip: '10.30.0.10', vendor: 'HP', ping_interval: 30 });
  const template = createTemplate({ name: 'قالب سیسکو', settings: { vendor: 'Cisco', ping_interval: 120, timeout_ms: 900 } }, { actor: 'admin' });

  const first = applyTemplate(template.id, { deviceIds: [id], overwrite: false });
  assert.equal(first.updated, 1);
  let device = getDevice(id);
  assert.equal(device.vendor, 'HP', 'مقدار اختصاصی حفظ می‌شود');
  assert.equal(device.pingInterval, 30);
  assert.equal(device.timeoutMs, 900, 'فیلد خالی پر می‌شود');
  assert.ok(first.details[0].preserved.includes('vendor'));

  const second = applyTemplate(template.id, { deviceIds: [id], overwrite: true, fields: ['vendor', 'ping_interval'] });
  assert.equal(second.overwrite ?? true, true);
  device = getDevice(id);
  assert.equal(device.vendor, 'Cisco');
  assert.equal(device.pingInterval, 120);
  assert.equal(device.timeoutMs, 900, 'فیلد انتخاب‌نشده تغییر نمی‌کند');
});

test('قالب قابل ویرایش است و نام تکراری رد می‌شود', () => {
  const t = createTemplate({ name: 'قالب ویرایش', settings: { vendor: 'MikroTik' } });
  const updated = updateTemplate(t.id, { settings: { vendor: 'Ubiquiti', model: 'EdgeSwitch' } });
  assert.equal(updated.settings.vendor, 'Ubiquiti');
  assert.throws(() => createTemplate({ name: 'قالب ویرایش', settings: { vendor: 'x' } }), /وجود دارد/);
  assert.throws(() => createTemplate({ name: 'خالی', settings: {} }), /حداقل یک تنظیم/);
});

test('هر تجهیز فقط عضو یک گروه است و جایگزینی گروه کار می‌کند', () => {
  const now = Date.now();
  const g1 = Number(db.prepare('INSERT INTO groups(name, created_at) VALUES (?,?)').run('گروه A', now).lastInsertRowid);
  const g2 = Number(db.prepare('INSERT INTO groups(name, created_at) VALUES (?,?)').run('گروه B', now).lastInsertRowid);
  const id = addDevice(db, { name: 'یک‌گروهی', ip: '10.30.0.20' });
  setDeviceGroups(id, [g1, g2]);
  // ورودی چندگانه فقط با اولین گروه ذخیره می‌شود.
  const groups = groupsFor([id]).get(id);
  assert.deepEqual(groups.map((g) => g.id), [g1]);
  assert.equal(getDevice(id).groupIds.length, 1);
  // ستون قدیمی برای سازگاری با همان یک گروه هم‌گام می‌شود
  assert.equal(db.prepare('SELECT group_id FROM devices WHERE id=?').get(id).group_id, g1);
  // جایگزینی کامل عضویت
  setDeviceGroups(id, [g2]);
  assert.deepEqual(groupsFor([id]).get(id).map((g) => g.id), [g2]);
  assert.equal(db.prepare('SELECT group_id FROM devices WHERE id=?').get(id).group_id, g2);
  void updateDevice;
});
