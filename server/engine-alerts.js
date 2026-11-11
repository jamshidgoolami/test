/**
 * NetWatch — سیاست هشدار تجهیزات و هشدارهای معوق.
 * این ماژول فقط با تنظیمات، قوانین و Statementهای تزریق‌شده کار می‌کند و
 * به موتور یا لایهٔ HTTP وابسته نیست.
 */
import { inQuietHours } from './engine-windows.js';

export class EngineAlerts {
  constructor({ statements, db, getSettings, getRules, emit, publish, log, onDeliveryError, STATUS }) {
    this.statements = statements;
    this.db = db;
    this.getSettings = getSettings;
    this.getRules = getRules;
    this.emit = emit;
    this.publish = publish;
    this.log = log;
    this.onDeliveryError = onDeliveryError;
    this.STATUS = STATUS;
    this.pending = new Map();
  }

  /**
   * ایجاد هشدار با احترام به «مدت پایداری شرط» (`rule.duration_sec`) و «تأخیر
   * عمومی» (`settings.alert_delay`). هر دو یک معنا دارند؛ بزرگ‌ترشان اعمال می‌شود.
   * در این فاصله اگر تجهیز به وضعیت عادی برگردد، هشدار لغو می‌شود.
   */
  raiseAlert(kind, device, { severity, title, message, value, ts }) {
    const s = this.getSettings();
    const key = `${kind}:${device.id}`;
    if (!s.alerting_enabled) {
      this.cancelPending(key);
      return null;
    }
    const rules = this.getRules();
    const mapped = { offline: 'offline', latency: 'latency', loss: 'loss', recovery: 'recovery' }[kind];
    const rule =
      rules.find((r) => r.metric === mapped && (!r.scope_group_id || r.scope_group_id === device.group_id)) ||
      rules.find((r) => r.metric === mapped) ||
      null;
    const cooldown = (rule?.cooldown_sec ?? s.alert_cooldown) * 1000;
    // ضد‌تکرار پیش از هر درج (حتی سرکوب‌شده) اعمال می‌شود؛ در غیر این صورت در
    // ساعات سکوت، هر بررسی یک ردیف هشدار سرکوب‌شده می‌ساخت و جدول بی‌سقف رشد می‌کرد.
    if (cooldown > 0) {
      const prev = this.statements.recentAlert.get(key);
      if (prev && ts - prev.created_at < cooldown) {
        this.cancelPending(key);
        return null;
      }
    }
    const alert = {
      kind,
      deviceId: device.id,
      deviceName: device.name,
      ruleId: rule ? rule.id : null,
      silent: Boolean(rule && rule.silent),
      severity,
      title,
      message,
      value,
      ts,
    };
    const delaySec = Math.max(0, Number(rule?.duration_sec) || 0, Number(s.alert_delay) || 0);
    if (delaySec > 0) {
      const existing = this.pending.get(key);
      if (existing) return { pending: true, dueAt: existing.dueAt };
      const dueAt = ts + delaySec * 1000;
      const timer = setTimeout(() => {
        this.pending.delete(key);
        try {
          this.deliverPending(alert);
        } catch (e) {
          this.onDeliveryError(e);
        }
      }, delaySec * 1000);
      if (timer.unref) timer.unref();
      this.pending.set(key, { dueAt, timer, alert });
      this.log('engine', `هشدار «${kind}» برای تجهیز #${device.id} تا ${delaySec} ثانیه معوق شد.`);
      return { pending: true, dueAt };
    }
    return this.commitAlert(alert);
  }

  /** ثبت نهایی هشدار (پس از پایان تأخیر) با بررسی دوبارهٔ وضعیت و شرط‌ها */
  deliverPending(alert) {
    const s = this.getSettings();
    if (!s.alerting_enabled) return null;
    const row = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(alert.deviceId);
    if (!row) return null;
    if (!this.pendingStillValid(alert.kind, row)) {
      this.log('engine', `هشدار معوق «${alert.kind}» برای تجهیز #${row.id} لغو شد؛ وضعیت دیگر برقرار نیست.`);
      return null;
    }
    return this.commitAlert({ ...alert, deviceName: row.name, ts: Date.now() });
  }

  /** آیا وضعیت فعلی تجهیز هنوز همان شرطی است که هشدار برایش ساخته شده بود؟ */
  pendingStillValid(kind, row) {
    if (!row) return false;
    if (kind === 'offline') return row.status === this.STATUS.OFFLINE;
    if (kind === 'latency' || kind === 'loss') return row.status === this.STATUS.WARNING;
    if (kind === 'recovery') return row.status !== this.STATUS.OFFLINE;
    return true;
  }

  /** درج هشدار با رعایت cooldown و ساعات سکوت، سپس اعلان به UI */
  commitAlert(alert) {
    const s = this.getSettings();
    const key = `${alert.kind}:${alert.deviceId}`;
    const rule = alert.ruleId ? this.db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(alert.ruleId) : null;
    const cooldown = (rule?.cooldown_sec ?? s.alert_cooldown) * 1000;
    if (cooldown > 0) {
      const prev = this.statements.recentAlert.get(key);
      if (prev && alert.ts - prev.created_at < cooldown) return null;
    }
    if (alert.silent && inQuietHours(s)) {
      this.db
        .prepare(
          'INSERT INTO alerts(device_id, rule_id, severity, kind, title, message, value, created_at, status, notified, duplicate_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
        )
        .run(
          alert.deviceId,
          alert.ruleId,
          alert.severity,
          alert.kind,
          alert.title,
          alert.message,
          alert.value ?? null,
          alert.ts,
          'suppressed',
          1,
          key
        );
      return null;
    }
    const res = this.statements.insertAlert.run(
      alert.deviceId,
      alert.ruleId,
      alert.severity,
      alert.kind,
      alert.title,
      alert.message,
      alert.value ?? null,
      alert.ts,
      'active',
      1,
      key
    );
    const saved = {
      id: Number(res.lastInsertRowid),
      deviceId: alert.deviceId,
      deviceName: alert.deviceName,
      severity: alert.severity,
      kind: alert.kind,
      title: alert.title,
      message: alert.message,
      created_at: alert.ts,
      status: 'active',
    };
    this.emit('alert', saved);
    this.publish('alert', saved);
    return saved;
  }

  cancelPending(key) {
    const entry = this.pending.get(key);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    return true;
  }

  /** لغو همهٔ هشدارهای معوق یک تجهیز (پس از بازگشت به وضعیت عادی) */
  cancelDevicePending(deviceId) {
    for (const key of [...this.pending.keys()]) {
      if (key.endsWith(`:${deviceId}`)) this.cancelPending(key);
    }
  }

  clearPending() {
    for (const key of [...this.pending.keys()]) this.cancelPending(key);
  }

  resolveDeviceAlerts(deviceId, ts) {
    // تجهیزی که وضعیتش عادی شده، نباید بعداً هشدار معوق بفرستد
    this.cancelDevicePending(deviceId);
    const r = this.statements.resolveAlerts.run(ts, deviceId);
    if (r.changes > 0) {
      this.emit('alert-resolved', { deviceId, ts });
      this.publish('alert-resolved', { deviceId, ts });
    }
  }
}
