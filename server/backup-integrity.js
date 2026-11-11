/**
 * NetWatch — بررسی یکپارچگی فایل‌های پشتیبان
 * ----------------------------------------------------------------
 * این ماژول فقط فایل SQLite را می‌خواند و شمارش/سلامت آن را برمی‌گرداند؛
 * هیچ نوشتنی انجام نمی‌دهد تا مستقل و قابل تست باشد.
 */
import { DatabaseSync } from 'node:sqlite';

const REQUIRED_TABLES = ['settings', 'devices', 'samples', 'outages', 'daily_stats', 'alerts'];

export function tableCounts(file) {
  const conn = new DatabaseSync(file, { readOnly: true });
  try {
    const count = (table) => {
      try {
        return Number(conn.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c);
      } catch {
        return null;
      }
    };
    const deviceAttachments = count('device_attachments');
    const diagramAttachments = count('diagram_attachments');
    return {
      devices: count('devices'),
      samples: count('samples'),
      outages: count('outages'),
      openOutages: (() => {
        try {
          return Number(conn.prepare('SELECT COUNT(*) AS c FROM outages WHERE open = 1').get().c);
        } catch {
          return null;
        }
      })(),
      alerts: count('alerts'),
      users: count('users'),
      credentials: count('credentials'),
      attachments:
        deviceAttachments == null && diagramAttachments == null
          ? null
          : Number(deviceAttachments || 0) + Number(diagramAttachments || 0),
    };
  } finally {
    conn.close();
  }
}

/** بررسی یک فایل SQLite با integrity_check و foreign_key_check */
export function inspectSqliteFile(file) {
  const info = { ok: false, errors: [], pageCount: null, userVersion: null, journalMode: null };
  let conn = null;
  try {
    conn = new DatabaseSync(file, { readOnly: true });
    const integrity = conn.prepare('PRAGMA integrity_check').all();
    const messages = integrity.map((r) => String(Object.values(r)[0] ?? ''));
    const bad = messages.filter((m) => m.toLowerCase() !== 'ok');
    if (bad.length) info.errors.push(...bad.slice(0, 20));
    const fk = conn.prepare('PRAGMA foreign_key_check').all();
    if (fk.length) info.errors.push(`نقض کلید خارجی: ${fk.length} ردیف`);
    const present = new Set(
      conn
        .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
        .all()
        .map((r) => r.name)
    );
    const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
    if (missing.length) info.errors.push(`جدول‌های غایب: ${missing.join(', ')}`);
    info.pageCount = conn.prepare('PRAGMA page_count').get()?.page_count ?? null;
    info.userVersion = conn.prepare('PRAGMA user_version').get()?.user_version ?? null;
    info.journalMode = conn.prepare('PRAGMA journal_mode').get()?.journal_mode ?? null;
    info.ok = info.errors.length === 0;
  } catch (e) {
    info.errors.push(e.message);
    info.ok = false;
  } finally {
    try {
      conn?.close();
    } catch {
      /* بی‌اثر */
    }
  }
  return info;
}
