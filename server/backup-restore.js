/**
 * NetWatch — بازیابی مجموعهٔ پشتیبان و Rollback نسخهٔ ایمنی.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  db,
  DB_PATH,
  DATA_DIR,
  MBTILES_DIR,
  checkDatabaseHealth,
  runMigrations,
  ensureDefaultSettings,
  requireDiskSpace,
  log,
} from './db.js';
import { logEvent } from './logger.mjs';
import { inspectSqliteFile, tableCounts } from './backup-integrity.js';
import { DbError, DB_ERROR_CODES, logDbError } from './db-errors.js';
import { fileSizeBytes } from './db-safety.js';
import { ATTACHMENTS_DIR } from './attachments.js';
import { CREDENTIAL_KEY_FILE, resetCredentialKeyCache } from './credential-crypto.js';
import {
  ensureDir,
  sha256File,
  fsyncPath,
  copyFileDurable,
} from './backup-files.js';
import { isRestoreRunning, setRestoreRunning, writeRestoreState } from './backup-state.js';
import { verifyBackup } from './backup-validation.js';

function engineLockOwner() {
  try {
    return db.prepare('SELECT owner, expires_at FROM engine_lock WHERE id = 1').get() || null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* بازیابی                                                            */
/* ------------------------------------------------------------------ */

function removeWalShm() {
  for (const suffix of ['-wal', '-shm']) {
    try {
      fs.unlinkSync(`${DB_PATH}${suffix}`);
    } catch {
      /* فایلی وجود ندارد */
    }
  }
}

/** بازگرداندن نسخهٔ ایمنی با rename اتمیک (پس از خرابی هر مرحله) */
function rollbackToSafety(safetyFile) {
  if (!safetyFile || !fs.existsSync(safetyFile)) return false;
  const rb = `${DB_PATH}.rollback-${process.pid}`;
  fs.copyFileSync(safetyFile, rb);
  fsyncPath(rb);
  removeWalShm();
  fs.renameSync(rb, DB_PATH);
  fsyncPath(path.dirname(DB_PATH));
  return true;
}

/**
 * بازیابی کامل از پشتیبان.
 *
 * ترتیب امن (Crash-safe):
 *   ۱) verifyBackup: checksum + integrity + FK + جدول‌ها + نسخهٔ ساختار
 *   ۲) بررسی فضای دیسک و توقف نویسنده‌ها (onBeforeRestore)
 *   ۳) Checkpoint کامل و ساخت نسخهٔ ایمنی با fsync
 *   ۴) کپی پشتیبان در مسیر موقت و اعتبارسنجی دوبارهٔ همان کپی
 *   ۵) بستن اتصال، حذف WAL/SHM (پس از Checkpoint)، rename اتمیک فایل موقت
 *   ۶) بازگشایی، مهاجرت‌ها، integrity_check + foreign_key_check و تطبیق تعداد رکوردها
 *   ۷) بازیابی MBTiles با checksum تأییدشده
 *
 * فایل وضعیت `.restore-state.json` پیش از هر مرحله روی دیسک نوشته می‌شود؛
 * db.js پیش از بازکردن اتصال، بازیابی نیمه‌کاره را تشخیص و نسخهٔ ایمنی را
 * برمی‌گرداند. بنابراین Crash/SIGKILL در هر مرحله به دادهٔ معتبر می‌رسد.
 *
 * @param {string} source
 * @param {{restoreMbtiles?: boolean, force?: boolean, dryRun?: boolean, onBeforeRestore?: Function, onAfterRestore?: Function}} [options]
 */
function restoreBackup(source, options = {}) {
  const { restoreMbtiles = true, force = false, dryRun = false, onBeforeRestore, onAfterRestore } = options;
  if (isRestoreRunning()) throw new DbError(DB_ERROR_CODES.BUSY, 'یک بازیابی دیگر در جریان است.', { status: 409 });
  if (String(DB_PATH).startsWith(':')) throw new DbError(DB_ERROR_CODES.BACKUP_INVALID, 'بازیابی روی پایگاه‌دادهٔ درون‌حافظه‌ای پشتیبانی نمی‌شود.', { status: 400 });

  const verification = verifyBackup(source);
  if (!verification.ok) {
    logEvent('warn', 'restore_rejected', { source: String(source), errors: verification.errors });
    throw new DbError(
      DB_ERROR_CODES.BACKUP_INVALID,
      `پشتیبان معتبر نیست و بازیابی انجام نشد: ${verification.errors.join(' | ')}`,
      { status: 400, detail: verification }
    );
  }
  if (dryRun) return { restored: false, dryRun: true, verification };

  const lock = engineLockOwner();
  if (lock && Number(lock.expires_at) > Date.now() && !force && !onBeforeRestore) {
    throw new DbError(
      DB_ERROR_CODES.BUSY,
      'موتور پایش فعال است؛ پیش از بازیابی سرویس را متوقف کنید یا گزینهٔ force را انتخاب کنید.',
      { status: 409 }
    );
  }

  setRestoreRunning(true);
  const startedAt = Date.now();
  const safetyFile = `${DB_PATH}.pre-restore-${startedAt}`;
  const stageFile = `${DB_PATH}.restore-stage-${process.pid}`;
  const tilesStageDir = path.join(MBTILES_DIR, `.restore-stage-${process.pid}`);
  const attachmentsStageDir = path.join(DATA_DIR, `.restore-attachments-${process.pid}`);
  const keyStageFile = path.join(DATA_DIR, `.restore-key-${process.pid}`);
  let closed = false;
  let installed = false;
  try {
    const incomingFileBytes = [...verification.mbtiles, ...verification.attachments].reduce(
      (sum, file) => sum + Number(file.size || 0),
      0
    );
    const incomingKeyBytes = verification.credentialsKey?.file
      ? fileSizeBytes(verification.credentialsKey.file)
      : 0;
    requireDiskSpace(
      fileSizeBytes(DB_PATH) * 2 + fileSizeBytes(verification.dbFile) + incomingFileBytes + incomingKeyBytes + 8 * 1024 * 1024,
      'بازیابی'
    );
    onBeforeRestore?.();

    // ۱) دوام نوشته‌های تأییدشده در فایل اصلی، سپس نسخهٔ ایمنی
    try {
      db.checkpoint('TRUNCATE');
    } catch (e) {
      logEvent('warn', 'restore_checkpoint_failed', { message: e?.message });
    }
    if (fs.existsSync(DB_PATH)) {
      copyFileDurable(DB_PATH, safetyFile);
      fsyncPath(DATA_DIR);
    }
    writeRestoreState({
      status: 'in_progress',
      phase: 'safety_ready',
      startedAt,
      source: verification.dbFile,
      safetyFile: fs.existsSync(safetyFile) ? safetyFile : null,
      updatedAt: Date.now(),
    });

    // ۲) کپی در مسیر موقت و اعتبارسنجی همان کپی (نه فقط مبدأ)
    copyFileDurable(verification.dbFile, stageFile);
    const staged = inspectSqliteFile(stageFile);
    if (!staged.ok) {
      throw new DbError(DB_ERROR_CODES.BACKUP_INVALID, `کپی موقت پشتیبان معتبر نیست: ${staged.errors.join(' | ')}`, {
        status: 500,
      });
    }
    const stagedCounts = tableCounts(stageFile);
    const expectedCounts = verification.manifest?.db?.counts || {};
    const countMismatch = ['devices', 'samples', 'outages', 'alerts', 'users'].filter(
      (k) => expectedCounts[k] != null && stagedCounts[k] != null && Number(expectedCounts[k]) !== Number(stagedCounts[k])
    );
    if (countMismatch.length) {
      throw new DbError(DB_ERROR_CODES.BACKUP_INVALID, `تعداد رکوردهای کپی موقت با مانیفست نمی‌خواند: ${countMismatch.join(', ')}`, {
        status: 400,
      });
    }

    // ۳) آماده‌سازی فایل‌های نقشه در پوشهٔ موقت (پیش از جای‌گذاری پایگاه‌داده)
    const stagedTiles = [];
    if (restoreMbtiles && verification.mbtiles.length) {
      ensureDir(tilesStageDir);
      for (const tile of verification.mbtiles) {
        const tmp = path.join(tilesStageDir, path.basename(tile.name));
        copyFileDurable(tile.path, tmp);
        const sha = sha256File(tmp);
        if (tile.sha256 && sha !== tile.sha256) {
          throw new DbError(DB_ERROR_CODES.BACKUP_INVALID, `checksum فایل نقشه در کپی موقت نامعتبر است: ${tile.name}`, {
            status: 400,
          });
        }
        stagedTiles.push({ name: path.basename(tile.name), tmp });
      }
    }

    // ۳-ب) پیوست‌ها و کلید رمزنگاری هم پیش از جای‌گذاری پایگاه‌داده در مسیر
    // موقت کپی و checksum آن‌ها دوباره بررسی می‌شود.
    const stagedAttachments = [];
    if (verification.attachments.length) {
      ensureDir(attachmentsStageDir);
      for (const attachment of verification.attachments) {
        const tmp = path.join(attachmentsStageDir, path.basename(attachment.name));
        copyFileDurable(attachment.path, tmp);
        const sha = sha256File(tmp);
        if (attachment.sha256 && sha !== attachment.sha256) {
          throw new DbError(DB_ERROR_CODES.BACKUP_INVALID, `checksum پیوست در کپی موقت نامعتبر است: ${attachment.name}`, {
            status: 400,
          });
        }
        stagedAttachments.push({ name: path.basename(attachment.name), tmp });
      }
    }
    let stagedKey = null;
    if (verification.credentialsKey?.source === 'file' && verification.credentialsKey.file) {
      copyFileDurable(verification.credentialsKey.file, keyStageFile);
      const sha = sha256File(keyStageFile);
      if (verification.credentialsKey.sha256 && sha !== verification.credentialsKey.sha256) {
        throw new DbError(DB_ERROR_CODES.BACKUP_INVALID, 'checksum کلید رمزنگاری در کپی موقت نامعتبر است.', {
          status: 400,
        });
      }
      stagedKey = keyStageFile;
    }

    // ۴) جای‌گذاری اتمیک: ابتدا اتصال بسته و WAL/SHM پاک می‌شود تا WAL قدیمی
    //    هرگز روی فایل جدید بازپخش نشود؛ سپس rename موقت → اصلی.
    db.close();
    closed = true;
    removeWalShm();
    writeRestoreState({ status: 'in_progress', phase: 'installing', updatedAt: Date.now() });
    fs.renameSync(stageFile, DB_PATH);
    installed = true;
    fsyncPath(DATA_DIR);

    db.reopen();
    closed = false;
    runMigrations();
    ensureDefaultSettings();
    const health = checkDatabaseHealth({ full: true });
    if (!health.ok) {
      throw new DbError(DB_ERROR_CODES.CORRUPT, `پایگاه‌دادهٔ بازیابی‌شده سالم نیست: ${health.errors.join(' | ')}`, {
        status: 500,
        detail: health,
      });
    }
    // تطبیق نهایی: تعداد رکوردهای اصلی باید همان مانیفست باشد (کپی ناقص/خطای I/O)
    const postCounts = tableCounts(DB_PATH);
    const postMismatch = ['devices', 'samples', 'outages', 'alerts', 'users'].filter(
      (k) => expectedCounts[k] != null && postCounts[k] != null && Number(expectedCounts[k]) !== Number(postCounts[k])
    );
    if (postMismatch.length) {
      throw new DbError(DB_ERROR_CODES.CORRUPT, `تعداد رکوردها پس از بازیابی با مانیفست نمی‌خواند: ${postMismatch.join(', ')}`, {
        status: 500,
      });
    }

    // ۵) نصب فایل‌های نقشهٔ تأییدشده
    const restoredTiles = [];
    if (stagedTiles.length) {
      ensureDir(MBTILES_DIR);
      for (const tile of stagedTiles) {
        const dest = path.join(MBTILES_DIR, tile.name);
        const tmp = `${dest}.restore-tmp-${process.pid}`;
        fs.copyFileSync(tile.tmp, tmp);
        fsyncPath(tmp);
        fs.renameSync(tmp, dest);
        restoredTiles.push(tile.name);
      }
      fsyncPath(MBTILES_DIR);
    }

    // ۶) نصب پیوست‌ها؛ نام فایل‌ها تولیدی و یکتاست، بنابراین rename اتمیک است.
    const restoredAttachments = [];
    if (stagedAttachments.length) {
      ensureDir(ATTACHMENTS_DIR);
      for (const attachment of stagedAttachments) {
        const dest = path.join(ATTACHMENTS_DIR, attachment.name);
        const tmp = `${dest}.restore-tmp-${process.pid}`;
        fs.copyFileSync(attachment.tmp, tmp);
        fsyncPath(tmp);
        fs.renameSync(tmp, dest);
        try {
          fs.chmodSync(dest, 0o600);
        } catch {
          /* بی‌اثر */
        }
        restoredAttachments.push(attachment.name);
      }
      fsyncPath(ATTACHMENTS_DIR);
    }

    // ۷) کلید رمزنگاری آخر از همه نصب می‌شود: اگر مراحل قبلی شکست بخورند،
    // پایگاه‌داده به نسخهٔ ایمنی برمی‌گردد و کلید قدیمی دست‌نخورده می‌ماند.
    let restoredKey = false;
    if (stagedKey) {
      ensureDir(path.dirname(CREDENTIAL_KEY_FILE));
      const tmp = `${CREDENTIAL_KEY_FILE}.restore-tmp-${process.pid}`;
      fs.copyFileSync(stagedKey, tmp);
      fsyncPath(tmp);
      try {
        fs.chmodSync(tmp, 0o600);
      } catch {
        /* بی‌اثر */
      }
      fs.renameSync(tmp, CREDENTIAL_KEY_FILE);
      fsyncPath(path.dirname(CREDENTIAL_KEY_FILE));
      resetCredentialKeyCache();
      restoredKey = true;
    }

    const summary = {
      restored: true,
      source: verification.dbFile,
      safetyCopy: fs.existsSync(safetyFile) ? safetyFile : null,
      counts: postCounts,
      mbtiles: restoredTiles,
      attachments: restoredAttachments,
      credentialsKey: restoredKey ? 'file' : verification.credentialsKey?.source || 'none',
      durationMs: Date.now() - startedAt,
      health: { ok: health.ok, mode: health.mode, foreignKeyViolations: health.foreignKeyViolations },
      schemaVersion: Number(db.prepare('PRAGMA user_version').get()?.user_version) || null,
    };
    writeRestoreState({
      status: 'completed',
      phase: 'done',
      finishedAt: Date.now(),
      updatedAt: Date.now(),
      counts: postCounts,
      mbtiles: restoredTiles,
      attachments: restoredAttachments,
      credentialsKey: restoredKey ? 'file' : verification.credentialsKey?.source || 'none',
      durationMs: summary.durationMs,
      error: '',
    });
    log('info', `بازیابی از پشتیبان انجام شد: ${path.basename(verification.dbFile)} (${summary.durationMs}ms).`);
    logEvent('info', 'restore_completed', summary);
    onAfterRestore?.(summary);
    return summary;
  } catch (e) {
    const err = logDbError('backup.restore', e);
    let rolledBack = false;
    try {
      if (closed) {
        db.close();
        closed = false;
      }
      if (installed) {
        rolledBack = rollbackToSafety(safetyFile);
      }
      db.reopen();
      closed = false;
    } catch (recoveryError) {
      logEvent('error', 'restore_rollback_failed', { message: recoveryError?.message });
    }
    writeRestoreState({
      status: 'failed',
      phase: 'failed',
      finishedAt: Date.now(),
      updatedAt: Date.now(),
      error: String(err?.message || e).slice(0, 500),
      rolledBack,
      safetyFile: fs.existsSync(safetyFile) ? safetyFile : null,
    });
    log('error', `بازیابی ناموفق بود${rolledBack ? ' و نسخهٔ ایمنی بازگردانده شد' : ''}: ${err.message}`);
    onAfterRestore?.(null);
    throw err;
  } finally {
    setRestoreRunning(false);
    for (const file of [stageFile]) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* بی‌اثر */
      }
    }
    try {
      fs.rmSync(tilesStageDir, { recursive: true, force: true });
    } catch {
      /* بی‌اثر */
    }
    try {
      fs.rmSync(attachmentsStageDir, { recursive: true, force: true });

    } catch {
      /* بی‌اثر */
    }
    try {
      fs.rmSync(keyStageFile, { force: true });
    } catch {
      /* بی‌اثر */
    }
  }
}


export { restoreBackup };
