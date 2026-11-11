/**
 * NetWatch — ساخت مجموعهٔ پشتیبان.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, DB_PATH, MBTILES_DIR, getSettings, log, requireDiskSpace } from './db.js';
import { logEvent } from './logger.mjs';
import { inspectSqliteFile, tableCounts } from './backup-integrity.js';
import { ATTACHMENTS_DIR } from './attachments.js';
import { CREDENTIAL_KEY_FILE, credentialKeySource } from './credential-crypto.js';
import { DbError, DB_ERROR_CODES, logDbError } from './db-errors.js';
import { fileSizeBytes } from './db-safety.js';
import {
  APP_VERSION,
  BACKUP_DIR,
  BACKUP_FORMAT,
  MANIFEST,
  SECRETS_DIR,
  CREDENTIAL_KEY_BACKUP,
  ensureDir,
  sha256File,
  fsyncPath,
  copyFileDurable,
  writeJsonDurable,
  stampName,
  mbtilesFiles,
  attachmentFiles,
  attachmentsBytes,
} from './backup-files.js';
import { isBackupRunning, isRestoreRunning, setBackupRunning } from './backup-state.js';
import { pruneBackupsByPolicy, pruneBackups } from './backup-retention.js';

/**
 * ساخت یک مجموعهٔ پشتیبان کامل (پایگاه‌داده + MBTiles).
 *
 * @param {{includeMbtiles?: boolean, keep?: number, reason?: string}} [options]
 * @returns {{name: string, dir: string, manifest: object}}
 */
function createBackup({ includeMbtiles = true, includeAttachments = true, keep = null, reason = 'manual' } = {}) {
  if (isRestoreRunning()) throw new DbError(DB_ERROR_CODES.BUSY, 'بازیابی در جریان است؛ پشتیبان‌گیری ممکن نیست.', { status: 409 });
  if (isBackupRunning()) throw new DbError(DB_ERROR_CODES.BUSY, 'یک پشتیبان‌گیری دیگر در جریان است.', { status: 409 });
  if (String(DB_PATH).startsWith(':')) throw new DbError(DB_ERROR_CODES.BACKUP_INVALID, 'برای پایگاه‌دادهٔ درون‌حافظه‌ای پشتیبان‌گیری فایلی ممکن نیست.', { status: 400 });
  const settings = getSettings();
  const keepCount = Number(keep ?? settings.backup_keep ?? 7);
  const startedAt = Date.now();
  setBackupRunning(true);
  let workDir = null;
  try {
    ensureDir(BACKUP_DIR);
    // برآورد محافظه‌کارانه: پایگاه‌داده + MBTiles + فضای موقت برای VACUUM
    const dbBytes = Math.max(fileSizeBytes(DB_PATH), 1024 * 1024);
    const tilesBytes = includeMbtiles ? mbtilesFiles().reduce((sum, f) => sum + fileSizeBytes(path.join(MBTILES_DIR, f)), 0) : 0;
    const attachmentBytes = includeAttachments ? attachmentsBytes() : 0;
    const keyBytes = credentialKeySource() === 'file' ? fileSizeBytes(CREDENTIAL_KEY_FILE) : 0;
    requireDiskSpace(dbBytes * 2 + tilesBytes + attachmentBytes + keyBytes + 8 * 1024 * 1024, 'ساخت پشتیبان');

    // ۱) انتقال WAL به فایل اصلی تا عکس لحظه‌ای شامل همهٔ تراکنش‌های تأییدشده باشد
    const checkpoint = db.checkpoint('TRUNCATE');
    logEvent('info', 'backup_checkpoint', checkpoint);

    // ۲) نوشتن عکس لحظه‌ای در پوشهٔ موقت (هیچ پشتیبان نیمه‌کاره‌ای دیده نمی‌شود)
    const name = `${stampName()}-${crypto.randomBytes(3).toString('hex')}`;
    workDir = path.join(BACKUP_DIR, `.partial-${name}`);
    ensureDir(workDir);
    const sqliteTmp = path.join(workDir, 'netwatch.db.tmp');
    db.prepare('VACUUM INTO ?').run(sqliteTmp);
    fsyncPath(sqliteTmp);
    const verification = inspectSqliteFile(sqliteTmp);
    if (!verification.ok) {
      throw new DbError(DB_ERROR_CODES.BACKUP_INVALID, `پشتیبان ساخته‌شده معتبر نیست: ${verification.errors.join(' | ')}`, {
        status: 500,
        detail: verification,
      });
    }
    const dbFile = path.join(workDir, 'netwatch.db');
    fs.renameSync(sqliteTmp, dbFile);
    try {
      // VACUUM INTO فایل را با umask سیستم می‌سازد (روی بسیاری از سرورها 644).
      // پشتیبان شامل کاربران/حسابرسی است و باید مثل خود پایگاه‌داده فقط برای
      // مالک خواندنی باشد.
      fs.chmodSync(dbFile, 0o600);
    } catch {
      /* فایل‌سیستم بدون پشتیبانی chmod */
    }
    fsyncPath(workDir);

    // ۳) فایل‌های MBTiles در همان مجموعه؛ اگر فایلی هنگام کپی تغییر کند،
    //    کپی دوباره انجام می‌شود تا checksum با محتوای پایدار بخورد.
    const mbtiles = [];
    if (includeMbtiles) {
      ensureDir(path.join(workDir, 'mbtiles'));
      for (const fileName of mbtilesFiles()) {
        const src = path.join(MBTILES_DIR, fileName);
        const before = fs.statSync(src);
        const dest = path.join(workDir, 'mbtiles', fileName);
        copyFileDurable(src, dest);
        const after = fs.statSync(src);
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
          copyFileDurable(src, dest);
        }
        const finalStat = fs.statSync(src);
        mbtiles.push({
          name: fileName,
          size: fileSizeBytes(dest),
          sha256: sha256File(dest),
          sourceSize: finalStat.size,
          sourceMtimeMs: finalStat.mtimeMs,
        });
      }
    }

    // ۳-ب) پیوست‌ها (تجهیز و دیاگرام) بخشی از وضعیت بازیابی‌شدنی‌اند؛ بدون
    // آن‌ها پایگاه‌داده به ردیف‌هایی اشاره می‌کند که فایلشان وجود ندارد.
    const attachments = [];
    if (includeAttachments) {
      ensureDir(path.join(workDir, 'attachments'));
      for (const fileName of attachmentFiles()) {
        const src = path.join(ATTACHMENTS_DIR, fileName);
        let before;
        try {
          before = fs.statSync(src);
        } catch {
          continue; // پیوست هم‌زمان حذف شده است
        }
        const dest = path.join(workDir, 'attachments', fileName);
        copyFileDurable(src, dest);
        let after;
        try {
          after = fs.statSync(src);
        } catch {
          fs.rmSync(dest, { force: true });
          continue;
        }
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
          copyFileDurable(src, dest);
        }
        attachments.push({
          name: fileName,
          size: fileSizeBytes(dest),
          sha256: sha256File(dest),
        });
      }
    }

    // ۳-ج) کلید رمزنگاری: فایل مستقل و ۰۶۰۰ در secrets/. اگر کلید از env
    // می‌آید، در پشتیبان کپی نمی‌شود و اپراتور باید همان راز را جداگانه در
    // Secret Manager نگه دارد؛ مانیفست این را صریح ثبت می‌کند.
    const keySource = credentialKeySource();
    const credentialsKey = {
      source: keySource,
      file: null,
      size: null,
      sha256: null,
    };
    if (keySource === 'file') {
      ensureDir(path.join(workDir, SECRETS_DIR));
      const dest = path.join(workDir, SECRETS_DIR, CREDENTIAL_KEY_BACKUP);
      copyFileDurable(CREDENTIAL_KEY_FILE, dest);
      credentialsKey.file = `${SECRETS_DIR}/${CREDENTIAL_KEY_BACKUP}`;
      credentialsKey.size = fileSizeBytes(dest);
      credentialsKey.sha256 = sha256File(dest);
    } else if (keySource === 'env') {
      credentialsKey.note = 'کلید از NETWATCH_CREDENTIAL_KEY می‌آید و باید جدا از این پشتیبان نگهداری شود.';
    } else {
      credentialsKey.note = 'کلید رمزنگاری روی این نصب وجود ندارد؛ اگر اعتبارنامه‌ای ثبت شده باشد بازیابی آن ناقص است.';
    }

    // ۴) مانیفست: تنها راه شناسایی یک پشتیبان معتبر
    const counts = tableCounts(dbFile);
    if (credentialsKey.source === 'none' && Number(counts.credentials || 0) > 0) {
      throw new DbError(
        DB_ERROR_CODES.BACKUP_INVALID,
        'اعتبارنامهٔ رمزنگاری‌شده در پایگاه‌داده وجود دارد اما کلید رمزنگاری در دسترس نیست؛ پشتیبان بدون کلید برای Disaster Recovery ناقص است.',
        { status: 500 }
      );
    }
    const manifest = {
      format: BACKUP_FORMAT,
      app: 'netwatch',
      appVersion: APP_VERSION,
      schemaVersion: verification.userVersion,
      name,
      reason,
      createdAt: new Date().toISOString(),
      createdAtMs: startedAt,
      dbPath: DB_PATH,
      db: {
        file: 'netwatch.db',
        size: fileSizeBytes(dbFile),
        sha256: sha256File(dbFile),
        integrity: verification.errors.length ? 'failed' : 'ok',
        pageCount: verification.pageCount,
        userVersion: verification.userVersion,
        counts,
      },
      mbtiles,
      attachments,
      attachmentBytes: attachments.reduce((sum, item) => sum + item.size, 0),
      credentialsKey,
      checkpoint,
      settings: {
        journalMode: db.walInfo().journalMode,
        synchronous: db.walInfo().synchronous,
      },
      durationMs: Date.now() - startedAt,
    };
    writeJsonDurable(path.join(workDir, MANIFEST), manifest);

    // ۵) انتشار اتمیک مجموعه
    const finalDir = path.join(BACKUP_DIR, name);
    fs.renameSync(workDir, finalDir);
    workDir = null;
    fsyncPath(BACKUP_DIR);

    // با keep صریح، رفتار قبلی (سقف کل) حفظ می‌شود؛ در حالت پیش‌فرض، سیاست
    // روزانه/هفتگی (۷ روزانه + ۴ هفتگی) اعمال می‌شود.
    const pruned = keep == null
      ? pruneBackupsByPolicy({
          dailyKeep: Number(settings.backup_daily_keep) || keepCount,
          weeklyKeep: Number(settings.backup_weekly_keep) || 0,
        })
      : pruneBackups(keepCount);
    log('info', `پشتیبان کامل ساخته شد: ${name} (${Math.round(manifest.db.size / 1024)} کیلوبایت، ${mbtiles.length} فایل نقشه).`);
    logEvent('info', 'backup_created', {
      name,
      reason,
      dbBytes: manifest.db.size,
      mbtiles: mbtiles.length,
      attachments: attachments.length,
      credentialsKey: credentialsKey.source,
      durationMs: manifest.durationMs,
      pruned,
    });
    return { name, dir: finalDir, manifest };
  } catch (e) {
    // پشتیبان نیمه‌کاره پاک می‌شود؛ هیچ فایل ناقصی باقی نمی‌ماند.
    if (workDir) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* بی‌اثر */
      }
    }
    const err = logDbError('backup.create', e);
    log('error', `ساخت پشتیبان ناموفق بود: ${err.message}`);
    throw err;
  } finally {
    setBackupRunning(false);
  }
}


export { createBackup };
