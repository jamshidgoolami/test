/**
 * آزمون مستقل EngineAlerts:
 *   • Cooldown و ضدتکرار
 *   • تأخیر و اجرای هشدار معوق
 *   • ساعات سکوت
 *   • Resolve هشدارهای تجهیز
 */
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDataDir, cleanupDir, addDevice, waitFor } from '../helpers.mjs';

const dir = useTempDataDir('engine-alerts');
const { db, getSettings, setSettings, STATUS } = await import('../../db.js');
const { statements } = await import('../../engine-store.js');
const { EngineAlerts } = await import('../../engine-alerts.js');

let rules = [];
let events = 0;
let published = 0;

function manager() {
  return new EngineAlerts({
    statements: statements(),
    db,
    getSettings: () => getSettings(),
    getRules: () => rules,
    emit: () => {
      events += 1;
    },
    publish: () => {
      published += 1;
    },
    log: () => {},
    onDeliveryError: (error) => {
      throw error;
    },
    STATUS,
  });
}

function addRule(patch = {}) {
  const rule = {
    name: 'قانون آزمون',
    enabled: 1,
    metric: 'offline',
    comparator: 'gte',
    threshold: 1,
    duration_sec: 0,
    severity: 'critical',
    scope_group_id: null,
    cooldown_sec: 0,
    apply_to_unmon: 0,
    silent: 0,
    created_at: Date.now(),
    ...patch,
  };
  const cols = Object.keys(rule);
  const id = Number(
    db
      .prepare(`INSERT INTO alert_rules(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map((key) => rule[key])).lastInsertRowid
  );
  return db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(id);
}

const offlineAlert = (ts = Date.now()) => ({
  severity: 'critical',
  title: 'قطع',
  message: 'قطع',
  value: 3,
  ts,
});

beforeEach(() => {
  db.prepare('DELETE FROM alerts').run();
  db.prepare('DELETE FROM alert_rules').run();
  rules = [];
  events = 0;
  published = 0;
  setSettings({
    alerting_enabled: true,
    alert_cooldown: 0,
    alert_delay: 0,
    suppression_enabled: false,
    suppression_start: '00:00',
    suppression_end: '23:59',
  });
});

after(() => {
  db.close();
  cleanupDir(dir);
});

test('cooldown suppresses a duplicate device alert', () => {
  setSettings({ alert_cooldown: 600 });
  const id = addDevice(db, { status: STATUS.OFFLINE });
  const alerts = manager();

  const first = alerts.raiseAlert('offline', { id, name: 'd', group_id: null }, offlineAlert());
  const second = alerts.raiseAlert('offline', { id, name: 'd', group_id: null }, offlineAlert(Date.now() + 100));
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM alerts WHERE device_id = ?').get(id).c, 1);
  alerts.clearPending();
});

test('a delayed alert stays pending and is delivered once', async () => {
  const rule = addRule({ duration_sec: 0.05 });
  rules = [rule];
  const id = addDevice(db, { status: STATUS.OFFLINE });
  const alerts = manager();

  const result = alerts.raiseAlert('offline', { id, name: 'd', group_id: null }, offlineAlert());
  assert.equal(result?.pending, true);
  assert.equal(alerts.pending.size, 1);
  assert.equal(
    await waitFor(() => db.prepare('SELECT COUNT(*) c FROM alerts WHERE device_id = ?').get(id).c === 1, {
      timeout: 1500,
    }),
    true
  );
  assert.equal(alerts.pending.size, 0);
  assert.ok(events >= 1);
  assert.ok(published >= 1);
});

test('silent rules write a suppressed alert during quiet hours', () => {
  const rule = addRule({ silent: 1 });
  rules = [rule];
  setSettings({ suppression_enabled: true });
  const id = addDevice(db, { status: STATUS.OFFLINE });
  const alerts = manager();

  assert.equal(alerts.raiseAlert('offline', { id, name: 'd', group_id: null }, offlineAlert()), null);
  const row = db.prepare('SELECT status FROM alerts WHERE device_id = ?').get(id);
  assert.equal(row.status, 'suppressed');
  assert.equal(events, 0, 'a suppressed alert is stored without notifying the UI');
});

test('resolveDeviceAlerts resolves active alerts and publishes one change', () => {
  const id = addDevice(db, { status: STATUS.OFFLINE });
  const alerts = manager();
  alerts.raiseAlert('offline', { id, name: 'd', group_id: null }, offlineAlert());
  const before = published;

  alerts.resolveDeviceAlerts(id, Date.now());
  assert.equal(db.prepare('SELECT status FROM alerts WHERE device_id = ?').get(id).status, 'resolved');
  assert.equal(published, before + 1);
});
