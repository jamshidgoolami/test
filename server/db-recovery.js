/**
 * NetWatch — Recovery پیش از بازکردن اتصال SQLite.
 *
 * این ماژول به db.js وابسته نیست تا Recovery همیشه قبل از ساخت DatabaseHandle
 * اجرا شود و Circular Dependency ایجاد نشود.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logEvent } from './logger.mjs';
import {
  rollbackFileOperations,
  cleanupRestoreJournal,
  cleanupRestoreTempFiles,
  writeRestoreJournal,
} from './backup-journal.js';

function corruptStateError(stateFile, cause) {
  const err = new Error(`فایل وضعیت بازیابی خراب یا غیرقابل‌خواندن است و بازیابی خودکار ممکن نیست: ${stateFile}`);
  err.code = 'RESTORE_STATE_CORRUPT';
  err.cause = cause;
  return err;
}

export function recoverInterruptedRestoreBeforeOpen({ dataDir, dbPath, mbtilesDir }) {
  const stateFile = path.join(dataDir, '.restore-state.json');
  let raw;
  try {
    raw = fs.readFileSync(stateFile, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    logEvent('error', 'restore_crash_recovery_state_corrupt', { message: e?.message, stateFile });
    throw corruptStateError(stateFile, e);
  }
  let state;
  try {
    state = JSON.parse(raw);
  } catch (e) {
    logEvent('error', 'restore_crash_recovery_state_corrupt', { message: e?.message, stateFile });
    throw corruptStateError(stateFile, e);
  }
  if (!state || typeof state !== 'object' || Array.isArray(state) || typeof state.status !== 'string') {
    logEvent('error', 'restore_crash_recovery_state_corrupt', { stateFile, reason: 'invalid-shape' });
    throw corruptStateError(stateFile, new Error('invalid state shape'));
  }
  if (state.status === 'completed') {
    cleanupRestoreJournal(state.journalDir, dataDir);
    return null;
  }
  const needsRecovery = state.status === 'in_progress' || state.requiresRecovery === true;
  if (!needsRecovery) return null;

  const fileRollback = rollbackFileOperations(state.fileOperations || []);
  const safety = state.safetyFile && fs.existsSync(state.safetyFile) ? state.safetyFile : null;
  const dbExists = (() => {
    try {
      return fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0;
    } catch {
      return false;
    }
  })();
  const dbInstallStarted = state.dbInstallStarted === true || state.dbInstalled === true;
  let dbRecovered = false;
  let dbRemoved = false;
  let dbError = null;
  try {
    // اگر نصب دیتابیس آغاز شده باشد، حتی اگر rename انجام شده باشد، نسخهٔ قبلی
    // باید برگردد؛ در غیر این صورت DB جدید با فایل‌های قدیمی ناسازگار می‌ماند.
    if (dbInstallStarted) {
      if (safety) {
        const tmp = `${dbPath}.crash-recover-${process.pid}`;
        fs.copyFileSync(safety, tmp);
        const fd = fs.openSync(tmp, 'r+');
        try {
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        for (const suffix of ['-wal', '-shm']) {
          try {
            fs.unlinkSync(`${dbPath}${suffix}`);
          } catch {
            /* بی‌اثر */
          }
        }
        fs.renameSync(tmp, dbPath);
        dbRecovered = true;
      } else {
        // پیش از Restore دیتابیسی وجود نداشت؛ بازگشت به همان وضعیت یعنی حذف DB.
        for (const suffix of ['-wal', '-shm']) {
          try {
            fs.unlinkSync(`${dbPath}${suffix}`);
          } catch {
            /* بی‌اثر */
          }
        }
        fs.rmSync(dbPath, { force: true });
        dbRemoved = true;
      }
    } else if (!dbExists && safety) {
      const tmp = `${dbPath}.crash-recover-${process.pid}`;
      fs.copyFileSync(safety, tmp);
      const fd = fs.openSync(tmp, 'r+');
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, dbPath);
      dbRecovered = true;
    }
    cleanupRestoreTempFiles([mbtilesDir, path.join(dataDir, 'attachments'), dataDir]);
    // فایل‌های موقت باقی‌مانده هرگز بخشی از پایگاه‌داده نیستند.
    try {
      const dir = path.dirname(dbPath);
      const base = path.basename(dbPath);
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith(`${base}.restore-stage-`) || name.startsWith(`${base}.rollback-`)) {
          fs.rmSync(path.join(dir, name), { force: true });
        }
      }
    } catch {
      /* بی‌اثر */
    }
  } catch (e) {
    dbError = e;
    logEvent('error', 'restore_crash_recovery_failed', { message: e?.message, phase: state.phase });
  }
  const complete = fileRollback.ok && !dbError;
  const changed = dbRecovered || dbRemoved || fileRollback.restored > 0 || fileRollback.removed > 0;
  const next = {
    ...state,
    status: complete ? (changed ? 'recovered_interrupted' : 'interrupted') : 'recovery_failed',
    requiresRecovery: !complete,
    recoveredAt: complete ? Date.now() : state.recoveredAt,
    updatedAt: Date.now(),
    dbRecovered,
    dbRemoved,
    fileRollback,
    rollbackError: dbError ? String(dbError.message || dbError).slice(0, 500) : null,
    note: complete
      ? changed
        ? 'Restore نیمه‌کاره برگردانده شد؛ دیتابیس و فایل‌ها به وضعیت پیش از عملیات بازگشتند.'
        : 'هیچ تغییری نصب نشده بود؛ فایل‌های موقت پاک شدند.'
      : 'بازیابی خودکار کامل نشد؛ Journal برای تلاش دوباره حفظ می‌شود.',
  };
  let stateWritten = false;
  try {
    writeRestoreJournal(stateFile, next);
    stateWritten = true;
  } catch (e) {
    logEvent('error', 'restore_crash_recovery_state_write_failed', { message: e?.message });
  }
  // Journal فقط پس از ثبت durable وضعیت پاک می‌شود؛ اگر نوشتن وضعیت شکست
  // بخورد، شواهد و امکان تلاش دوباره باید باقی بمانند.
  if (complete && stateWritten) {
    const cleaned = cleanupRestoreJournal(state.journalDir, dataDir);
    if (!cleaned) logEvent('warn', 'restore_journal_cleanup_failed', { journalDir: state.journalDir });
  }
  logEvent(complete ? 'warn' : 'error', complete ? 'restore_crash_recovered' : 'restore_crash_recovery_failed', {
    phase: state.phase,
    safety: Boolean(safety),
    files: { restored: fileRollback.restored, removed: fileRollback.removed, ok: fileRollback.ok },
    dbRecovered,
    dbRemoved,
  });
  return next;
}

