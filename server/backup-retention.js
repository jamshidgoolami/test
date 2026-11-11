/**
 * NetWatch — فهرست و هرس مجموعه‌های پشتیبان.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logEvent } from './logger.mjs';
import { BACKUP_FORMAT, BACKUP_DIR, readManifest } from './backup-files.js';

/** فهرست پشتیبان‌های معتبر (به‌ترتیب جدیدترین) */
function listBackups(dir = BACKUP_DIR) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.'));
  } catch {
    return [];
  }
  if (!entries) return [];
  const items = [];
  for (const entry of entries) {
    const itemDir = path.join(dir, entry.name);
    const manifest = readManifest(itemDir);
    if (!manifest || manifest.format !== BACKUP_FORMAT) continue;
    items.push({
      name: manifest.name || entry.name,
      dir: itemDir,
      createdAt: manifest.createdAt,
      createdAtMs: manifest.createdAtMs || 0,
      reason: manifest.reason || '',
      dbBytes: manifest.db?.size ?? 0,
      mbtiles: manifest.mbtiles?.length ?? 0,
      attachments: manifest.attachments?.length ?? 0,
      credentialsKey: manifest.credentialsKey?.source ?? 'none',
      integrity: manifest.db?.integrity || 'unknown',
      counts: manifest.db?.counts || null,
    });
  }
  return items.sort((a, b) => b.createdAtMs - a.createdAtMs);
}

/** شمارهٔ هفتهٔ ISO برای سیاست هفتگی */
function isoWeek(dateMs) {
  const d = new Date(dateMs);
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * هرس پشتیبان با سیاست Grandfather-Father-Son:
 *   • newest backup of each of the last `dailyKeep` calendar days (UTC)
 *   • newest backup of each of the last `weeklyKeep` ISO weeks
 * همهٔ نسخه‌های دیگر حذف می‌شوند. حداقل یک نسخه همیشه می‌ماند.
 * @returns {string[]} نام نسخه‌های حذف‌شده
 */
function pruneBackupsByPolicy({ dailyKeep = 7, weeklyKeep = 4, dir = BACKUP_DIR } = {}) {
  const daily = Math.max(1, Math.min(60, Number(dailyKeep) || 7));
  const weekly = Math.max(0, Math.min(52, Number(weeklyKeep) || 0));
  const all = listBackups(dir);
  if (!all.length) return [];
  const keep = new Set();
  const days = new Set();
  const weeks = new Set();
  for (const item of all) {
    const ts = Number(item.createdAtMs) || Date.parse(item.createdAt) || 0;
    const day = new Date(ts).toISOString().slice(0, 10);
    if (days.size < daily && !days.has(day)) {
      days.add(day);
      keep.add(item.name);
      continue;
    }
    if (weekly > 0) {
      const week = isoWeek(ts);
      if (weeks.size < weekly && !weeks.has(week)) {
        weeks.add(week);
        keep.add(item.name);
      }
    }
  }
  // جدیدترین نسخه در هر حال حفظ می‌شود (حتی اگر همه در یک روز باشند).
  keep.add(all[0].name);
  const removed = [];
  for (const item of all) {
    if (keep.has(item.name)) continue;
    try {
      fs.rmSync(item.dir, { recursive: true, force: true });
      removed.push(item.name);
    } catch (e) {
      logEvent('warn', 'backup_prune_failed', { name: item.name, message: e.message });
    }
  }
  if (removed.length) logEvent('info', 'backup_pruned', { removed: removed.length, kept: keep.size, daily, weekly });
  return removed;
}

/** حذف پشتیبان‌های قدیمی‌تر از سقف نگهداری (فقط مجموعه‌های معتبر) */
function pruneBackups(keep = 7) {
  const limit = Math.max(1, Math.min(60, Number(keep) || 7));
  const all = listBackups();
  const removed = [];
  for (const item of all.slice(limit)) {
    try {
      fs.rmSync(item.dir, { recursive: true, force: true });
      removed.push(item.name);
    } catch (e) {
      logEvent('warn', 'backup_prune_failed', { name: item.name, message: e.message });
    }
  }
  return removed;
}


export { listBackups, pruneBackupsByPolicy, pruneBackups };
