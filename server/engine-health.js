/**
 * NetWatch — سلامت خود موتور و هشدارهای مستقل آن.
 * خطای داخلی/دیتابیس با قطعی شبکه یکی نیست و این ماژول آن را جدا نگه می‌دارد.
 */
const ENGINE_INCIDENT_COOLDOWN_MS = 5 * 60 * 1000;

export function internalErrorCode(err, phase) {
  const text = `${err?.code || ''} ${err?.message || ''}`;
  if (/DB_|SQLITE|constraint|database|no such table|closed/i.test(text)) return 'ENGINE_DB';
  if (/PROBE_DEADLINE/i.test(text)) return 'ENGINE_PROBE';
  // کد صریح خطا (مثلاً از لایهٔ پروب) گویاتر از دسته‌بندی عمومی است؛ فقط کدهای
  // استاندارد Node (ERR_*) نادیده گرفته می‌شوند تا لاگ پرنویز نشود.
  if (err?.code && typeof err.code === 'string' && !/^ERR_/.test(err.code)) return err.code;
  if (phase === 'probe') return 'ENGINE_PROBE';
  return 'ENGINE_INTERNAL';
}

export class EngineHealth {
  constructor({
    statements,
    db,
    getSettings,
    getStatus,
    stats,
    isRunning,
    isLeader,
    getEpoch,
    emit,
    publish,
    incidentGraceMs,
    log,
    logEvent,
  }) {
    this.statements = statements;
    this.db = db;
    this.getSettings = getSettings;
    this.getStatus = getStatus;
    this.stats = stats;
    this.isRunning = isRunning;
    this.isLeader = isLeader;
    this.getEpoch = getEpoch;
    this.emit = emit;
    this.publish = publish;
    this.incidentGraceMs = incidentGraceMs;
    this.log = log;
    this.logEvent = logEvent;
    this.lastIncidentAt = new Map();
    this.incidentActive = new Map();
  }

  /**
   * ثبت استاندارد خطای داخلی موتور. چنین خطایی هرگز «قطع تجهیز» نیست و نباید
   * به عنوان شکست شبکه در شاخص‌ها بیاید؛ فقط لاگ/شمارنده/هشدار مستقل می‌سازد.
   */
  noteInternalError(err, { phase = 'unknown', deviceId = null } = {}) {
    const code = internalErrorCode(err, phase);
    const ts = Date.now();
    // Fencing/از دست دادن رهبری خطای داخلی نیست؛ هشدار «اختلال موتور» نمی‌سازد
    // (انتقال رهبری رفتار مورد انتظار است) اما برای ردیابی ثبت می‌شود.
    if (code === 'ENGINE_FENCED' || code === 'ENGINE_NOT_LEADER') {
      this.stats.lastErrorCode = code;
      this.logEvent('warn', 'engine_write_rejected', {
        code,
        phase,
        deviceId,
        leader: this.isLeader(),
        epoch: this.getEpoch(),
      });
      return code;
    }
    this.stats.errors++;
    this.stats.internalErrors++;
    this.stats.lastErrorAt = ts;
    this.stats.lastErrorCode = code;
    this.log('error', `خطای داخلی موتور (${phase}${deviceId ? ` — تجهیز #${deviceId}` : ''}): ${err?.message || err}`);
    this.logEvent('error', 'engine_internal_error', {
      code,
      phase,
      deviceId,
      message: String(err?.message || err),
      mode: this.getSettings().engine_mode,
      leader: this.isLeader(),
    });
    // اختلال موتور هشدار مستقل خودش را دارد (kind='engine' و بدون تجهیز)
    if (phase !== 'recover') {
      this.raiseIncident(code, `اختلال موتور در مرحله ${phase}: ${err?.message || err}`, ts);
    }
    return code;
  }

  /**
   * هشدار مستقل اختلال موتور. در جدول هشدارها با kind='engine' و بدون تجهیز
   * ثبت می‌شود تا در مرکز هشدارها دیده شود، اما با هشدارهای تجهیز قاطی نشود.
   */
  raiseIncident(code, message, ts = Date.now()) {
    // نمونهٔ standby/running بدون رهبری نباید در جدول هشدار بنویسد.
    if (this.isRunning() && !this.isLeader()) return null;
    const key = `engine:${code}`;
    const last = this.lastIncidentAt.get(key) || 0;
    if (this.incidentActive.get(key)) return null;
    if (ts - last < ENGINE_INCIDENT_COOLDOWN_MS) return null;
    this.lastIncidentAt.set(key, ts);
    const title = 'اختلال موتور مانیتورینگ';
    try {
      const res = this.statements.insertAlert.run(
        null,
        null,
        'critical',
        'engine',
        title,
        message,
        null,
        ts,
        'active',
        1,
        key
      );
      this.incidentActive.set(key, Number(res.lastInsertRowid));
      this.logEvent('error', 'engine_incident', { code, message });
      const saved = {
        id: Number(res.lastInsertRowid),
        deviceId: null,
        severity: 'critical',
        kind: 'engine',
        title,
        message,
        created_at: ts,
        status: 'active',
      };
      this.emit('alert', saved);
      this.publish('alert', saved);
      return saved;
    } catch (e) {
      // ثبت هشدار موتور نباید خودش موتور را متوقف کند
      this.logEvent('error', 'engine_incident_failed', { code, message: String(e?.message || e) });
      return null;
    }
  }

  /** بستن هشدارهای مستقل موتور پس از بازگشت به وضعیت پایدار */
  resolveIncidents(ts = Date.now(), reason = '') {
    let changes = 0;
    try {
      changes =
        Number(
          this.db
            .prepare(
              "UPDATE alerts SET status='resolved', resolved_at=? WHERE device_id IS NULL AND kind='engine' AND status IN ('active','acknowledged')"
            )
            .run(ts).changes
        ) || 0;
    } catch (e) {
      this.logEvent('error', 'engine_incident_resolve_failed', { message: String(e?.message || e) });
    }
    if (changes) {
      this.incidentActive.clear();
      this.logEvent('info', 'engine_incident_resolved', { reason, resolved: changes });
      this.publish('alerts-changed', { engine: true });
    }
    return changes;
  }

  /**
   * پایش سلامت خود موتور در هر چرخه (مستقل از تجهیزات).
   * اگر حلقه گیر کرده باشد یا عقب‌ماندگی زمان‌بندی از حد بگذرد هشدار می‌دهد؛
   * پس از پایدارشدن، هشدارهای موتور بسته می‌شوند.
   */
  checkEngineHealth(now = Date.now()) {
    if (!this.isRunning() || !this.isLeader()) return;
    const { stalled, tickLagMs } = this.getStatus();
    if (stalled) {
      this.raiseIncident(
        'ENGINE_STALLED',
        `حلقهٔ موتور ${Math.round(tickLagMs / 1000)} ثانیه عقب افتاده است (کار همگام یا قفل پایگاه‌داده).`,
        now
      );
      return;
    }
    // عقب‌ماندگی زمان‌بندی: تأخیر شروع بررسی‌ها از سررسیدشان
    const lag = this.stats.scheduling.lastLagMs;
    const intervalMs = Math.max(5000, Number(this.getSettings().ping_interval || 30) * 1000);
    if (lag > intervalMs * 2) {
      this.raiseIncident(
        'ENGINE_LAG',
        `تأخیر زمان‌بندی بررسی‌ها ${Math.round(lag / 1000)} ثانیه است (بازهٔ تنظیم‌شده: ${Math.round(intervalMs / 1000)} ثانیه).`,
        now
      );
      return;
    }
    // بازگشت به وضعیت پایدار: تنها وقتی بی‌خطایی ادامه داشته باشد، هشدارهای
    // مستقل موتور بسته می‌شوند.
    if (this.incidentActive.size) {
      const quietFor = this.stats.lastErrorAt ? now - this.stats.lastErrorAt : Infinity;
      if (quietFor >= this.incidentGraceMs) this.resolveIncidents(now, 'بازگشت به وضعیت پایدار');
    }
  }
}
