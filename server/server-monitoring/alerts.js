/**
 * NetWatch — هشدارهای آستانه‌ای سرور
 * ----------------------------------------------------------------
 * این ماژول در همان مسیر دریافت snapshot (Agent، Redfish، IPMI یا demo)
 * فراخوانی می‌شود. برای هر متریک موجود، آستانهٔ همان سرور بررسی می‌شود؛
 * هشدار فعال تکراری ساخته نمی‌شود و با بازگشت مقدار به محدودهٔ مجاز، همان
 * هشدار به‌صورت خودکار «رفع‌شده» می‌شود.
 *
 * هشدارها در جدول alerts و با `server_id` ثبت می‌شوند تا در مرکز هشدار و
 * کانال SSE موجود دیده شوند. `duplicate_key` مستقل از تجهیزات شبکه است.
 */
import { db, getSettings } from '../db.js';
import { bus } from '../engine.js';
import { logEvent } from '../logger.mjs';

const METRICS = Object.freeze([
  {
    kind: 'server_cpu',
    field: 'cpuPct',
    thresholdField: 'alert_cpu_pct',
    label: 'CPU',
    title: 'مصرف CPU سرور از حد مجاز بیشتر است',
    unit: '%',
  },
  {
    kind: 'server_mem',
    field: 'memPct',
    thresholdField: 'alert_mem_pct',
    label: 'RAM',
    title: 'مصرف RAM سرور از حد مجاز بیشتر است',
    unit: '%',
  },
  {
    kind: 'server_temp',
    field: 'maxTempC',
    thresholdField: 'alert_temp_c',
    label: 'دما',
    title: 'دمای سرور از حد مجاز بیشتر است',
    unit: '°C',
  },
]);

const round = (value) => Math.round(Number(value) * 10) / 10;

function alertKey(serverId, kind) {
  return `server:${serverId}:${kind}`;
}

function severityFor(kind, value, threshold) {
  if (kind === 'server_temp') return value >= threshold + 5 ? 'critical' : 'warning';
  return value >= threshold + 5 || value >= 95 ? 'critical' : 'warning';
}

function messageFor(server, metric, value, threshold) {
  return `${metric.label} سرور «${server.name}» ${round(value)}${metric.unit} است؛ آستانهٔ تعیین‌شده ${round(threshold)}${metric.unit}.`;
}

function publishAlert(saved) {
  // برای سازگاری با مسیر SSE موجود، هم رویداد alert و هم alerts-changed
  // فرستاده می‌شوند. alert در App باعث Toast و صدای اژیر می‌شود.
  bus.emit('alert', saved);
  bus.emit('alerts-changed', { serverId: saved.serverId, alertId: saved.id });
}

function activeAlert(serverId, kind) {
  return (
    db
      .prepare(
        "SELECT * FROM alerts WHERE server_id = ? AND kind = ? AND status IN ('active','acknowledged') ORDER BY created_at DESC, id DESC LIMIT 1"
      )
      .get(serverId, kind) || null
  );
}

function recentAlert(key, now) {
  return (
    db
      .prepare('SELECT id, created_at FROM alerts WHERE duplicate_key = ? ORDER BY created_at DESC LIMIT 1')
      .get(key) || null
  );
}

function raiseThresholdAlert(server, metric, value, threshold, now) {
  const existing = activeAlert(server.id, metric.kind);
  const severity = severityFor(metric.kind, value, threshold);
  const title = `${metric.title} — ${server.name}`;
  const message = messageFor(server, metric, value, threshold);
  if (existing) {
    // شرط همچنان برقرار است؛ مقدار و پیام را تازه می‌کنیم اما دوباره اعلان
    // نمی‌فرستیم تا صدای اژیر در هر Poll تکرار نشود.
    if (existing.status === 'active' || existing.value !== value || existing.severity !== severity) {
      db.prepare('UPDATE alerts SET severity = ?, title = ?, message = ?, value = ? WHERE id = ?').run(
        severity,
        title,
        message,
        value,
        existing.id
      );
    }
    return null;
  }

  const settings = getSettings();
  if (!settings.alerting_enabled) return null;
  const cooldown = Math.max(0, Number(settings.alert_cooldown) || 0) * 1000;
  const key = alertKey(server.id, metric.kind);
  const previous = recentAlert(key, now);
  if (cooldown > 0 && previous && now - previous.created_at < cooldown) return null;

  const result = db
    .prepare(
      `INSERT INTO alerts
       (server_id, device_id, rule_id, severity, kind, title, message, value, created_at, status, notified, duplicate_key)
       VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, 'active', 1, ?)`
    )
    .run(server.id, severity, metric.kind, title, message, value, now, key);

  const saved = {
    id: Number(result.lastInsertRowid),
    serverId: server.id,
    serverName: server.name,
    deviceId: null,
    deviceName: null,
    severity,
    kind: metric.kind,
    title,
    message,
    value,
    createdAt: now,
    created_at: now,
    status: 'active',
  };
  logEvent('info', 'server_threshold_alert', {
    serverId: server.id,
    kind: metric.kind,
    severity,
    value: round(value),
    threshold: round(threshold),
  });
  publishAlert(saved);
  return saved;
}

function resolveThresholdAlert(server, kind, now) {
  const result = db
    .prepare(
      "UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE server_id = ? AND kind = ? AND status IN ('active','acknowledged')"
    )
    .run(now, server.id, kind);
  if (!result.changes) return;
  bus.emit('alert-resolved', { serverId: server.id, kind, ts: now });
  bus.emit('alerts-changed', { serverId: server.id, kind, resolved: true });
}

/**
 * ارزیابی یک snapshot تازه. فقط متریک‌هایی بررسی می‌شوند که در این snapshot
 * مقدار دارند؛ دادهٔ ناقص یک کانال نباید هشدار کانال دیگر را رفع کند.
 *
 * @param {object} server ردیف سرور (شامل آستانه‌ها)
 * @param {object} snapshot snapshot نرمال‌شدهٔ Agent/Redfish/IPMI/demo
 * @returns {{raised:number,resolved:number}}
 */
export function evaluateServerAlerts(server, snapshot, now = Date.now()) {
  if (!server || !snapshot?.metric || !server.alert_enabled) return { raised: 0, resolved: 0 };
  const metric = snapshot.metric;
  let raised = 0;
  let resolved = 0;
  for (const definition of METRICS) {
    const value = metric[definition.field];
    if (value == null || !Number.isFinite(Number(value))) continue;
    const threshold = Number(server[definition.thresholdField]);
    if (!Number.isFinite(threshold) || threshold <= 0) continue;
    if (Number(value) >= threshold) {
      if (raiseThresholdAlert(server, definition, Number(value), threshold, now)) raised += 1;
    } else {
      const before = db
        .prepare(
          "SELECT COUNT(*) AS c FROM alerts WHERE server_id = ? AND kind = ? AND status IN ('active','acknowledged')"
        )
        .get(server.id, definition.kind).c;
      resolveThresholdAlert(server, definition.kind, now);
      if (before) resolved += 1;
    }
  }
  return { raised, resolved };
}
