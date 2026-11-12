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
import {
  isRestoreRunning,
  setRestoreRunning,
  writeRestoreState,
  writeRestoreStateStrict,
} from './backup-state.js';
import {
  createRestoreJournalDir,
  stagePreviousFile,
  installStagedFile,
  rollbackFileOperations,
  cleanupRestoreJournal,
  cleanupRestoreTempFiles,
} from './backup-journal.js';
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

/** اگر پیش از Restore پایگاه‌داده‌ای نبوده، Rollback یعنی حذف دیتابیس نصب‌شده. */
function rollbackDatabaseInstall(safetyFile) {
  if (safetyFile && fs.existsSync(safetyFile)) return rollbackToSafety(safetyFile);
  removeWalShm();
  fs.rmSync(DB_PATH, { force: true });
  fsyncPath(path.dirname(DB_PATH));
  return true;
}

function missingAttachmentFiles() {
  const missing = [];
  for (const table of ['device_attachments', 'diagram_attachments']) {
    try {
      const rows = db.prepare(`SELECT stored_name FROM ${table}`).all();
      for (const row of rows) {
        const name = path.basename(String(row.stored_name || ''));
        if (name && !fs.existsSync(path.join(ATTACHMENTS_DIR, name))) missing.push(`${table}:${name}`);
      }
    } catch {
      /* جدول در نسخه‌های قدیمی/آزمون‌ها ممکن است غایب باشد */
    }
  }
  return missing;
}

function missingMapFiles() {
  try {
    return db
      .prepare("SELECT file_name FROM map_layers WHERE file_name IS NOT NULL AND file_name <> ''")
      .all()
      .map((row) => path.basename(String(row.file_name)))
      .filter((name) => name && !fs.existsSync(path.join(MBTILES_DIR, name)));
  } catch {
    return [];
  }
}

/**
 * پس از نصب: bytes/checksum فایل‌ها و ارجاع‌های دیتابیس به Attachment و MBTiles
 * باید با مجموعهٔ بازیابی‌شده بخوانند. این بررسی پیش از Write وضعیت completed
 * انجام می‌شود تا Crash/خطای I/O به «بازیابی موفق اما ناسازگار» تبدیل نشود.
 */
function verifyRestoredArtifacts({ verification, restoreMbtiles, restoredKey }) {
  if (restoreMbtiles) {
    for (const tile of verification.mbtiles) {
      const dest = path.join(MBTILES_DIR, path.basename(tile.name));
      if (!fs.existsSync(dest)) {
        throw new DbError(DB_ERROR_CODES.CORRUPT, `فایل نقشهٔ بازیابی‌شده غایب است: ${tile.name}`, { status: 500 });
      }
      if (tile.sha256 && sha256File(dest) !== tile.sha256) {
        throw new DbError(DB_ERROR_CODES.CORRUPT, `checksum نقشهٔ بازیابی‌شده نامعتبر است: ${tile.name}`, { status: 500 });
      }
    }
  }
  for (const attachment of verification.attachments) {
    const dest = path.join(ATTACHMENTS_DIR, path.basename(attachment.name));
    if (!fs.existsSync(dest)) {
      throw new DbError(DB_ERROR_CODES.CORRUPT, `پیوست بازیابی‌شده غایب است: ${attachment.name}`, { status: 500 });
    }
    if (attachment.sha256 && sha256File(dest) !== attachment.sha256) {
      throw new DbError(DB_ERROR_CODES.CORRUPT, `checksum پیوست بازیابی‌شده نامعتبر است: ${attachment.name}`, { status: 500 });
    }
  }
  if (restoredKey && verification.credentialsKey?.sha256) {
    if (sha256File(CREDENTIAL_KEY_FILE) !== verification.credentialsKey.sha256) {
      throw new DbError(DB_ERROR_CODES.CORRUPT, 'checksum کلید رمزنگاری بازیابی‌شده نامعتبر است.', { status: 500 });
    }
  }
  const missingAttachments = missingAttachmentFiles();
  if (missingAttachments.length) {
    throw new DbError(
      DB_ERROR_CODES.CORRUPT,
      `دیتابیس بازیابی‌شده به پیوست‌های غایب ارجاع می‌دهد: ${missingAttachments.join(', ')}`,
      { status: 500 }
    );
  }
  // حتی در حالت restoreMbtiles=false، پایگاه‌دادهٔ تازه باید فقط به فایل‌های
  // نقشه‌ای ارجاع دهد که در پوشهٔ فعلی موجودند؛ وگرنه Restore «موفق» اما
  // ناسازگار تحویل می‌دهد.
  const missingMaps = missingMapFiles();
  if (missingMaps.length) {
    throw new DbError(
      DB_ERROR_CODES.CORRUPT,
      `دیتابیس بازیابی‌شده به فایل‌های نقشهٔ غایب ارجاع می‌دهد: ${missingMaps.join(', ')}`,
      { status: 500 }
    );
  }
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
  let dbInstallStarted = false;
  let journalDir = null;
  const fileOperations = [];
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
    journalDir = createRestoreJournalDir(DATA_DIR, startedAt);

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
    writeRestoreStateStrict({
      status: 'in_progress',
      phase: 'safety_ready',
      startedAt,
      source: verification.dbFile,
      safetyFile: fs.existsSync(safetyFile) ? safetyFile : null,
      journalDir,
      dbInstallStarted: false,
      dbInstalled: false,
      fileOperations: [],
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
    dbInstallStarted = true;
    writeRestoreStateStrict({
      status: 'in_progress',
      phase: 'installing_db',
      dbInstallStarted: true,
      updatedAt: Date.now(),
    });
    db.close();
    closed = true;
    removeWalShm();
    fs.renameSync(stageFile, DB_PATH);
    installed = true;
    fsyncPath(DATA_DIR);
    writeRestoreStateStrict({
      status: 'in_progress',
      phase: 'installing_files',
      dbInstalled: true,
      updatedAt: Date.now(),
    });

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

    // ثبت Journal پیش از هر تغییر؛ نسخهٔ قبلی در پوشهٔ Journal durable می‌شود.
    const installFile = ({ type, target, stagedPath, mode = 0o600 }) => {
      const operation = stagePreviousFile({
        journalDir,
        index: fileOperations.length,
        type,
        target,
      });
      fileOperations.push(operation);
      writeRestoreStateStrict({
        phase: 'installing_files',
        fileOperations,
        updatedAt: Date.now(),
      });
      installStagedFile(operation, stagedPath, { mode });
      writeRestoreStateStrict({ fileOperations, updatedAt: Date.now() });
    };

    // ۵) نصب فایل‌های نقشهٔ تأییدشده
    const restoredTiles = [];
    for (const tile of stagedTiles) {
      installFile({ type: 'mbtiles', target: path.join(MBTILES_DIR, tile.name), stagedPath: tile.tmp });
      restoredTiles.push(tile.name);
    }

    // ۶) نصب پیوست‌ها؛ نام فایل‌ها تولیدی و یکتاست، بنابراین rename اتمیک است.
    const restoredAttachments = [];
    for (const attachment of stagedAttachments) {
      installFile({
        type: 'attachment',
        target: path.join(ATTACHMENTS_DIR, attachment.name),
        stagedPath: attachment.tmp,
      });
      restoredAttachments.push(attachment.name);
    }

    // ۷) کلید رمزنگاری آخر از همه نصب می‌شود: اگر مراحل قبلی شکست بخورند،
    // پایگاه‌داده به نسخهٔ ایمنی برمی‌گردد و کلید قدیمی دست‌نخورده می‌ماند.
    let restoredKey = false;
    if (stagedKey) {
      installFile({ type: 'key', target: CREDENTIAL_KEY_FILE, stagedPath: stagedKey });
      resetCredentialKeyCache();
      restoredKey = true;
    }

    verifyRestoredArtifacts({ verification, restoreMbtiles, restoredKey });

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
    writeRestoreStateStrict({
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
      requiresRecovery: false,
      dbInstallStarted: false,
      dbInstalled: true,
      fileOperations: [],
    });
    cleanupRestoreJournal(journalDir, DATA_DIR);
    log('info', `بازیابی از پشتیبان انجام شد: ${path.basename(verification.dbFile)} (${summary.durationMs}ms).`);
    logEvent('info', 'restore_completed', summary);
    onAfterRestore?.(summary);
    return summary;
  } catch (e) {
    const err = logDbError('backup.restore', e);
    let fileRollback = { ok: true, restored: 0, removed: 0, errors: [] };
    let dbRolledBack = false;
    let rollbackError = null;
    try {
      if (!closed) {
        db.close();
        closed = true;
      }
      fileRollback = rollbackFileOperations(fileOperations);
      resetCredentialKeyCache();
      if (dbInstallStarted) {
        dbRolledBack = rollbackDatabaseInstall(safetyFile);
      }
      db.reopen();
      closed = false;
    } catch (recoveryError) {
      rollbackError = recoveryError;
      logEvent('error', 'restore_rollback_failed', { message: recoveryError?.message });
    }
    const recoveryComplete = fileRollback.ok && !rollbackError && (!dbInstallStarted || dbRolledBack);
    if (recoveryComplete) {
      cleanupRestoreJournal(journalDir, DATA_DIR);
      cleanupRestoreTempFiles([MBTILES_DIR, ATTACHMENTS_DIR, path.dirname(CREDENTIAL_KEY_FILE)]);
    }
    writeRestoreState({
      status: 'failed',
      phase: recoveryComplete ? 'failed' : 'rollback_failed',
      finishedAt: Date.now(),
      updatedAt: Date.now(),
      error: String(err?.message || e).slice(0, 500),
      rolledBack: dbRolledBack || fileRollback.restored > 0 || fileRollback.removed > 0,
      requiresRecovery: !recoveryComplete,
      dbInstallStarted,
      dbInstalled: installed,
      fileRollback,
      rollbackError: rollbackError ? String(rollbackError.message || rollbackError).slice(0, 500) : null,
      safetyFile: fs.existsSync(safetyFile) ? safetyFile : null,
      journalDir,
      fileOperations,
    });
    log(
      'error',
      `بازیابی ناموفق بود${dbRolledBack ? ' و دیتابیس و فایل‌ها به وضعیت قبلی برگشتند' : ''}: ${err.message}`
    );
    onAfterRestore?.(null);
    throw err;
  } finally {
    setRestoreRunning(false);
    cleanupRestoreTempFiles([MBTILES_DIR, ATTACHMENTS_DIR, path.dirname(CREDENTIAL_KEY_FILE)]);
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
