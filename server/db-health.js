/**
 * NetWatch — سلامت پایگاه‌داده و بررسی راه‌اندازی.
 */
import { logEvent } from './logger.mjs';
import { DbError, DB_ERROR_CODES, logDbError } from './db-errors.js';

export function createHealth({ db }) {
  const REQUIRED_TABLES = [
  'settings',
  'devices',
  'samples',
  'outages',
  'daily_stats',
  'alerts',
  'alert_rules',
  'maintenance_records',
  'maintenance_windows',
  'users',
  'sessions',
  'audit_log',
  'engine_log',
  'map_layers',
  'map_markers',
  'diagrams',
  'device_group_members',
  'device_templates',
  'device_attachments',
];

/**
 * بررسی سلامت پایگاه‌داده در زمان راه‌اندازی (و از مسیر /api/system/db/health).
 *
 * • quick_check: بررسی ساختار بدون خواندن کامل ب-تری (سریع، پیش‌فرض راه‌اندازی)
 * • integrity_check: بررسی کامل (هنگام بازبینی دستی یا NETWATCH_DB_CHECK=full)
 * • foreign_key_check: ارجاع‌های شکسته
 * • وجود جدول‌های الزامی
 *
 * @param {{full?: boolean}} [options]
 */
function checkDatabaseHealth({ full = false } = {}) {
  const startedAt = Date.now();
  const report = {
    ok: true,
    mode: full ? 'integrity_check' : 'quick_check',
    checkedAt: startedAt,
    durationMs: 0,
    errors: [],
    tables: null,
    foreignKeyViolations: 0,
    ...db.walInfo(),
  };
  try {
    const pragma = full ? 'integrity_check' : 'quick_check';
    const rows = db.prepare(`PRAGMA ${pragma}`).all();
    const messages = rows.map((r) => String(r[pragma] ?? Object.values(r)[0] ?? '')).filter(Boolean);
    const bad = messages.filter((m) => m.toLowerCase() !== 'ok');
    if (bad.length) {
      report.ok = false;
      report.errors.push(...bad.slice(0, 20));
    }
    report.tables = db.prepare("SELECT COUNT(*) AS c FROM sqlite_schema WHERE type='table'").get().c;
    const present = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((r) => r.name));
    const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
    if (missing.length) {
      report.ok = false;
      report.errors.push(`جدول‌های غایب: ${missing.join(', ')}`);
    }
    const fk = db.prepare('PRAGMA foreign_key_check').all();
    report.foreignKeyViolations = fk.length;
    if (fk.length) {
      report.ok = false;
      report.errors.push(`نقض کلید خارجی در ${fk.length} ردیف`);
    }
  } catch (e) {
    report.ok = false;
    const err = logDbError('db.health', e);
    report.errors.push(err.message);
  }
  report.durationMs = Date.now() - startedAt;
  return report;
}

/**
 * بررسی سلامت در راه‌اندازی. پیش‌فرض: در صورت خرابی، برنامه با پیام روشن
 * متوقف می‌شود (ادامهٔ کار با فایل خراب، داده را بیشتر تخریب می‌کند).
 * با NETWATCH_DB_CHECK=warn فقط هشدار داده می‌شود و NETWATCH_DB_CHECK=full
 * بررسی کامل انجام می‌شود.
 */
function verifyDatabaseAtStartup() {
  const setting = String(process.env.NETWATCH_DB_CHECK || 'quick').toLowerCase();
  if (setting === 'off' || setting === '0') return { ok: true, skipped: true };
  const report = checkDatabaseHealth({ full: setting === 'full' });
  const summary = {
    ok: report.ok,
    mode: report.mode,
    durationMs: report.durationMs,
    journalMode: report.journalMode,
    synchronous: report.synchronous,
    walBytes: report.walBytes,
  };
  if (report.ok) {
    logEvent('info', 'db_health_ok', summary);
    console.log(
      `[db] سلامت پایگاه‌داده تأیید شد (${report.mode}، ${report.durationMs}ms، journal=${report.journalMode}، synchronous=${report.synchronous}).`
    );
    return report;
  }
  logEvent('error', 'db_health_failed', { ...summary, errors: report.errors });
  const message = `پایگاه‌داده ناسالم است: ${report.errors.join(' | ')}`;
  if (setting === 'warn') {
    console.error(`[db] هشدار: ${message}`);
    return report;
  }
  throw new DbError(DB_ERROR_CODES.CORRUPT, message, { detail: report, status: 500 });
}


  return { checkDatabaseHealth, verifyDatabaseAtStartup };
}
