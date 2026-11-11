import { db } from './db.js';

/* ------------------------------------------------------------------ */
let stmt = null;
export function statements() {
  if (stmt) return stmt;
  stmt = {
    // فقط تجهیزات سررسیدشده تا ثانیه جاری، به ترتیب اولویت و با ایندکس idx_devices_due
    // (به‌جای خواندن کل جدول تجهیزات در هر چرخه)
    due: db.prepare(`SELECT * FROM devices
       WHERE enabled = 1 AND monitoring_enabled = 1 AND next_check_at <= ?
       ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END
       LIMIT ?`),
    scheduleNext: db.prepare('UPDATE devices SET next_check_at = ? WHERE id = ?'),
    exists: db.prepare('SELECT id FROM devices WHERE id = ?'),
    overdue: db.prepare(
      'SELECT COUNT(*) c FROM devices WHERE enabled = 1 AND monitoring_enabled = 1 AND next_check_at <= ?'
    ),
    insertSample: db.prepare(
      `INSERT INTO samples(device_id, ts, rtt_ms, packets_sent, packets_recv, loss_pct, status, ok, mode, scheduled_at, started_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ),
    lastSampleStarted: db.prepare('SELECT MAX(started_at) AS started FROM samples WHERE device_id = ?'),
    openOutage: db.prepare(
      'INSERT INTO outages(device_id, started_at, ended_at, duration_sec, cause, detail, lat, lng, open) VALUES (?,?,?,?,?,?,?,?,1)'
    ),
    // قطعی باز موجود هر تجهیز (قید یکتای پایگاه‌داده تضمین می‌کند حداکثر یکی باشد).
    // موتور پیش از ساخت قطعی تازه آن را «به فرزندی می‌گیرد»، پس هیچ‌گاه دو قطعی باز
    // برای یک تجهیز ساخته نمی‌شود — حتی پس از Crash و بازگشت.
    openOutageFor: db.prepare(
      'SELECT id, started_at FROM outages WHERE device_id = ? AND open = 1 ORDER BY started_at ASC, id ASC LIMIT 1'
    ),
    closeOpenOutages: db.prepare(
      'UPDATE outages SET ended_at = ?, duration_sec = MAX(1, CAST((? - started_at) / 1000 AS INTEGER)), open = 0 WHERE device_id = ? AND open = 1 AND id != ?'
    ),
    closeOutage: db.prepare('UPDATE outages SET ended_at=?, duration_sec=?, open=0 WHERE id=?'),
    updateDevice: db.prepare(`UPDATE devices SET
        status=?, status_reason=?, service_status=?, service_port=?, service_checked_at=?,
        last_check_at=?, last_status_change_at=?, last_rtt_ms=?, loss_pct=?,
        success_count=?, fail_count=?, total_checks=?, consecutive_failures=?, consecutive_successes=?,
        last_outage_at=?, current_outage_id=?, current_outage_started_at=?, last_recovery_at=?, min_rtt_ms=?, max_rtt_ms=?, avg_rtt_ms=?
      WHERE id=?`),
    recentAlert: db.prepare(
      'SELECT id, created_at FROM alerts WHERE duplicate_key = ? ORDER BY created_at DESC LIMIT 1'
    ),
    insertAlert: db.prepare(
      'INSERT INTO alerts(device_id, rule_id, severity, kind, title, message, value, created_at, status, notified, duplicate_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ),
    resolveAlerts: db.prepare(
      "UPDATE alerts SET status='resolved', resolved_at=? WHERE device_id=? AND status IN ('active','acknowledged') AND kind IN ('offline','latency','loss')"
    ),
    // یک قطعی «باز» تنها می‌تواند متعلق به تجهیزی باشد که در وضعیت Offline است
    closeStaleOpen: db.prepare(
      'UPDATE outages SET ended_at=?, duration_sec=MAX(1, CAST((?-started_at)/1000 AS INTEGER)), open=0 WHERE device_id=? AND open=1'
    ),
    markMaintenance: db.prepare(
      'UPDATE devices SET status=?, status_reason=?, current_outage_id=NULL, current_outage_started_at=NULL WHERE id=? AND (status != ? OR current_outage_id IS NOT NULL)'
    ),
    rules: db.prepare('SELECT * FROM alert_rules WHERE enabled = 1'),
    windows: db.prepare('SELECT * FROM maintenance_windows WHERE enabled = 1'),
    deviceTags: db.prepare('SELECT t.name FROM device_tags dt JOIN tags t ON t.id = dt.tag_id WHERE dt.device_id = ?'),
    // هرس تکه‌تکه: حذف یک‌بارهٔ صدها هزار رکورد، پایگاه‌داده را ثانیه‌ها قفل می‌کند.
    //
    // سیاست حفظ سوابق ضروری:
    //   • قطعی‌های «باز» هرگز حذف نمی‌شوند (حتی اگر از بازهٔ نگهداری قدیمی‌تر باشند)؛
    //     وگرنه یک حادثهٔ طولانی بی‌سند می‌ماند.
    //   • قطعی‌ای که سابقهٔ تعمیرات به آن ارجاع دارد حذف نمی‌شود تا پیوند سند
    //     عملیاتی (outage_id) قطع نشود.
    //   • فقط هشدارهای حل‌شده/سرکوب‌شده حذف می‌شوند؛ هشدار فعال یا تأییدشده
    //     هرگز هرس نمی‌شود. هشدارهای تجهیز دارای قطعی باز هم می‌مانند.
    pruneSamples: db.prepare('DELETE FROM samples WHERE rowid IN (SELECT rowid FROM samples WHERE ts < ? LIMIT ?)'),
    pruneOutages: db.prepare(
      `DELETE FROM outages WHERE rowid IN (
         SELECT o.rowid FROM outages o
         WHERE o.open = 0 AND o.started_at < ?
           AND NOT EXISTS (SELECT 1 FROM maintenance_records m WHERE m.outage_id = o.id)
         LIMIT ?)`
    ),
    pruneAlertsRow: db.prepare(
      `DELETE FROM alerts WHERE rowid IN (
         SELECT a.rowid FROM alerts a
         WHERE a.created_at < ? AND a.status IN ('resolved','suppressed')
           AND NOT EXISTS (SELECT 1 FROM outages o WHERE o.device_id = a.device_id AND o.open = 1)
         LIMIT ?)`
    ),
    pruneLog: db.prepare('DELETE FROM engine_log WHERE rowid IN (SELECT rowid FROM engine_log WHERE ts < ? LIMIT ?)'),

    // تجمیع روزانه به‌صورت چند پرس‌وجوی گروهی (به‌جای یک پرس‌وجوی همبسته برای هر تجهیز)
    daySamples: db.prepare(
      `SELECT device_id, COUNT(*) AS checks,
              SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) AS failed,
              AVG(CASE WHEN ok=1 THEN rtt_ms END) AS avg_rtt,
              MIN(CASE WHEN ok=1 THEN rtt_ms END) AS min_rtt,
              MAX(CASE WHEN ok=1 THEN rtt_ms END) AS max_rtt,
              AVG(CASE WHEN ok=0 THEN 100 ELSE 0 END) AS loss_pct
       FROM samples WHERE ts >= ? AND ts < ? GROUP BY device_id`
    ),
    dayOutages: db.prepare(
      `SELECT device_id, COUNT(*) AS outages, COALESCE(SUM(duration_sec),0) AS downtime_sec
       FROM outages WHERE started_at >= ? AND started_at < ? GROUP BY device_id`
    ),
    upsertDay: db.prepare(
      `INSERT INTO daily_stats(device_id, day, checks, failed, avg_rtt, min_rtt, max_rtt, loss_pct, outages, downtime_sec, uptime_pct)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(device_id, day) DO UPDATE SET checks=excluded.checks, failed=excluded.failed,
         avg_rtt=excluded.avg_rtt, min_rtt=excluded.min_rtt, max_rtt=excluded.max_rtt, loss_pct=excluded.loss_pct,
         outages=excluded.outages, downtime_sec=excluded.downtime_sec, uptime_pct=excluded.uptime_pct`
    ),
    recompute: db.prepare(
      `SELECT device_id,
              COUNT(*) AS checks,
              SUM(ok) AS ok_count,
              MIN(CASE WHEN ok=1 THEN rtt_ms END) AS min_rtt,
              MAX(CASE WHEN ok=1 THEN rtt_ms END) AS max_rtt,
              AVG(CASE WHEN ok=1 THEN rtt_ms END) AS avg_rtt
       FROM samples WHERE ts >= ? GROUP BY device_id`
    ),
    setUptime: db.prepare('UPDATE devices SET uptime_pct=? WHERE id=?'),
    // بازیابی وضعیت پس از راه‌اندازی/بازگشت:
    // • قطعی بازِ یتیم (تجهیزش به آن ارجاع ندارد) به تجهیز وصل می‌شود.
    // • ارجاعی که به قطعی بسته/ناموجود اشاره می‌کند پاک می‌شود.
    // • برای تجهیز قطع‌شده‌ای که هیچ قطعی بازی ندارد، وضعیت متناقض اصلاح می‌شود.
    orphans: db.prepare(
      `SELECT o.device_id, o.id, o.started_at FROM outages o
       JOIN devices d ON d.id = o.device_id
       WHERE o.open = 1 AND (d.current_outage_id IS NULL OR d.current_outage_id != o.id)`
    ),
    adoptOutage: db.prepare('UPDATE devices SET current_outage_id = ?, current_outage_started_at = ? WHERE id = ?'),
    clearDanglingOutage: db.prepare(
      `UPDATE devices SET current_outage_id = NULL, current_outage_started_at = NULL
       WHERE current_outage_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM outages o WHERE o.id = devices.current_outage_id AND o.open = 1)`
    ),
    danglingRefs: db.prepare(
      `SELECT d.id FROM devices d
       WHERE d.current_outage_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM outages o WHERE o.id = d.current_outage_id AND o.open = 1)`
    ),
    openForDevice: db.prepare('SELECT id FROM outages WHERE device_id = ? AND open = 1 LIMIT 1'),
    offlineWithoutOutage: db.prepare(
      `SELECT d.id, d.status_reason FROM devices d
       WHERE d.status = 'offline' AND NOT EXISTS (SELECT 1 FROM outages o WHERE o.device_id = d.id AND o.open = 1)`
    ),
  };
  return stmt;
}
