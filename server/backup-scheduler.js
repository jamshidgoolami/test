/**
 * NetWatch — Checkpoint، زمان‌بند Backup و وضعیت خلاصه.
 */
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR, getSettings, SCHEMA_VERSION } from './db.js';
import { logEvent } from './logger.mjs';
import { logDbError } from './db-errors.js';
import { freeDiskBytes } from './db-safety.js';
import { APP_VERSION, BACKUP_DIR, STATE_FILE, ensureDir, writeJsonDurable } from './backup-files.js';
import { createBackup } from './backup-create.js';
import { listBackups } from './backup-retention.js';
import { isBackupRunning, isRestoreRunning, restoreStatus } from './backup-state.js';

/** Checkpoint دوره‌ای؛ مقدار بازگشتی برای گزارش‌ها و آزمون‌ها */
function runCheckpoint(reason = 'scheduled') {
  try {
    const startedAt = Date.now();
    const result = db.checkpoint('TRUNCATE');
    const info = { ...result, reason, durationMs: Date.now() - startedAt, ...db.walInfo() };
    if (result.busy) {
      logEvent('warn', 'wal_checkpoint_busy', info);
    } else {
      logEvent('info', 'wal_checkpoint', info);
    }
    return info;
  } catch (e) {
    const err = logDbError('db.checkpoint.scheduled', e);
    logEvent('error', 'wal_checkpoint_failed', { message: err.message, reason });
    return { ok: false, error: err.message, reason };
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, STATE_FILE), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(patch = {}) {
  try {
    ensureDir(BACKUP_DIR);
    writeJsonDurable(path.join(BACKUP_DIR, STATE_FILE), { ...readState(), ...patch });
  } catch {
    /* وضعیت زمان‌بند حیاتی نیست */
  }
}

let schedulerTimer = null;
let schedulerKickoff = null;
let lastCheckpointAt = 0;
let lastBackupAt = 0;
let nextBackupRetryAt = 0;
let backupRetryDelayMs = 0;
let tickRunning = false;
let leaderCheck = null;

/**
 * زمان‌بند پشتیبان‌گیری خودکار + Checkpoint دوره‌ای.
 * هر ۶۰ ثانیه بیدار می‌شود و بر اساس تنظیمات (backup_enabled،
 * backup_interval_hours، checkpoint_interval_minutes) کار را انجام می‌دهد.
 * پشتیبان نخستین بار چند ثانیه پس از راه‌اندازی (اگر موعدش رسیده باشد).
 */
function startBackupScheduler({ isLeader = null } = {}) {
  if (schedulerTimer) return schedulerTimer;
  leaderCheck = typeof isLeader === 'function' ? isLeader : null;
  const state = readState();
  lastBackupAt = Number(state.lastBackupAt) || 0;
  lastCheckpointAt = Date.now();
  const tick = () => {
    if (tickRunning || isRestoreRunning()) return;
    tickRunning = true;
    try {
      const s = getSettings();
      const checkpointEvery = Math.max(1, Number(s.checkpoint_interval_minutes) || 15) * 60000;
      if (Date.now() - lastCheckpointAt >= checkpointEvery) {
        lastCheckpointAt = Date.now();
        runCheckpoint('scheduled');
      }
      if (s.backup_enabled === false) return;
      // پشتیبان‌گیری فقط در نمونهٔ رهبر انجام می‌شود تا در اجرای هم‌زمان
      // سرور و engine-cli، دو پشتیبان تکراری ساخته نشود.
      if (leaderCheck && !leaderCheck()) return;
      const backupEvery = Math.max(1, Number(s.backup_interval_hours) || 24) * 3600000;
      const now = Date.now();
      if (now - lastBackupAt >= backupEvery && now >= nextBackupRetryAt) {
        try {
          const created = createBackup({
            keep: s.backup_prune_enabled === false ? s.backup_keep : null,
            reason: 'scheduled',
          });
          const completedAt = Date.now();
          writeState({ lastBackupAt: completedAt, lastName: created.name });
          lastBackupAt = completedAt;
          nextBackupRetryAt = 0;
          backupRetryDelayMs = 0;
        } catch (e) {
          // شکست نباید موعد را جلو ببرد؛ وگرنه تلاش بعدی یک بازهٔ کامل عقب می‌افتد.
          backupRetryDelayMs = Math.min(backupEvery, backupRetryDelayMs ? backupRetryDelayMs * 2 : 5 * 60000);
          nextBackupRetryAt = Date.now() + backupRetryDelayMs;
          logEvent('warn', 'backup_scheduler_retry', {
            retryAt: nextBackupRetryAt,
            delayMs: backupRetryDelayMs,
            message: e?.message,
            code: e?.code,
          });
          throw e;
        }
      }
    } catch (e) {
      logEvent('error', 'backup_scheduler_error', { message: e?.message, code: e?.code });
    } finally {
      tickRunning = false;
    }
  };
  schedulerTimer = setInterval(tick, 60000);
  if (schedulerTimer.unref) schedulerTimer.unref();
  schedulerKickoff = setTimeout(tick, 5000);
  if (schedulerKickoff.unref) schedulerKickoff.unref();
  logEvent('info', 'backup_scheduler_started', { dir: BACKUP_DIR, lastBackupAt });
  return schedulerTimer;
}

function stopBackupScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (schedulerKickoff) clearTimeout(schedulerKickoff);
  schedulerTimer = null;
  schedulerKickoff = null;
  leaderCheck = null;
  nextBackupRetryAt = 0;
  backupRetryDelayMs = 0;
}

/** وضعیت خلاصه برای /api/system/db/health */
function backupStatus() {
  const backups = listBackups();
  const state = readState();
  const settings = getSettings();
  return {
    dir: BACKUP_DIR,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    count: backups.length,
    lastBackupAt: Number(state.lastBackupAt) || lastBackupAt || null,
    latest: backups[0] || null,
    running: isBackupRunning(),
    restoring: isRestoreRunning(),
    restore: restoreStatus(),
    policy: {
      enabled: settings.backup_enabled !== false,
      intervalHours: settings.backup_interval_hours,
      pruneEnabled: settings.backup_prune_enabled !== false,
      dailyKeep: settings.backup_daily_keep,
      weeklyKeep: settings.backup_weekly_keep,
    },
    freeBytes: freeDiskBytes(DATA_DIR),
  };
}


export { runCheckpoint, startBackupScheduler, stopBackupScheduler, backupStatus };
