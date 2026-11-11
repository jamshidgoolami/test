/**
 * NetWatch — اعتبارسنجی Backup پیش از Restore.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_VERSION } from './db.js';
import { inspectSqliteFile, tableCounts } from './backup-integrity.js';
import { DbError, DB_ERROR_CODES } from './db-errors.js';
import { fileSizeBytes } from './db-safety.js';
import {
  BACKUP_FORMAT,
  SECRETS_DIR,
  CREDENTIAL_KEY_BACKUP,
  readManifest,
  sha256File,
} from './backup-files.js';

/** مسیر فایل پایگاه‌دادهٔ درون یک پشتیبان (پوشه یا فایل مستقیم) */
function resolveBackupDb(source) {
  if (!source) throw new DbError(DB_ERROR_CODES.BACKUP_INVALID, 'مسیر پشتیبان مشخص نشده است.', { status: 400 });
  const resolved = path.resolve(String(source));
  const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
  if (!stat) throw new DbError(DB_ERROR_CODES.BACKUP_INVALID, `مسیر پشتیبان یافت نشد: ${resolved}`, { status: 404 });
  if (stat.isDirectory()) {
    const manifest = readManifest(resolved);
    if (!manifest) throw new DbError(DB_ERROR_CODES.BACKUP_INVALID, 'مانیفست پشتیبان یافت نشد؛ مجموعهٔ پشتیبان ناقص است.', { status: 400 });
    return { dir: resolved, dbFile: path.join(resolved, 'netwatch.db'), manifest };
  }
  return { dir: path.dirname(resolved), dbFile: resolved, manifest: null };
}

/**
 * بررسی صحت پشتیبان پیش از هر بازیابی.
 * @param {string} source مسیر پوشهٔ پشتیبان یا فایل .db
 */
function verifyBackup(source) {
  const report = {
    ok: false,
    errors: [],
    warnings: [],
    dbFile: null,
    manifest: null,
    mbtiles: [],
    attachments: [],
    credentialsKey: null,
    integrity: null,
  };
  try {
    const resolved = resolveBackupDb(source);
    report.dbFile = resolved.dbFile;
    report.manifest = resolved.manifest;
    if (!fs.existsSync(resolved.dbFile)) {
      report.errors.push('فایل پایگاه‌دادهٔ پشتیبان وجود ندارد.');
      return report;
    }
    // ۱) checksum باید با مانیفست بخورد (تشخیص دستکاری/کپی ناقص)
    if (resolved.manifest) {
      const expected = resolved.manifest.db?.sha256;
      const actual = sha256File(resolved.dbFile);
      report.dbSha256 = actual;
      if (expected && expected !== actual) {
        report.errors.push('checksum فایل پشتیبان با مانیفست مطابقت ندارد.');
      }
      if (resolved.manifest.format !== BACKUP_FORMAT) {
        report.errors.push(`نسخهٔ قالب پشتیبان پشتیبانی نمی‌شود (${resolved.manifest.format}).`);
      }
      const backupSchema = Number(resolved.manifest.schemaVersion ?? resolved.manifest.db?.userVersion ?? 0);
      if (backupSchema > SCHEMA_VERSION) {
        report.errors.push(`نسخهٔ ساختار پشتیبان (${backupSchema}) از نسخهٔ برنامه (${SCHEMA_VERSION}) جدیدتر است.`);
      }
      if (resolved.manifest.db?.size && Number(resolved.manifest.db.size) !== fileSizeBytes(resolved.dbFile)) {
        report.errors.push('اندازهٔ فایل پشتیبان با مانیفست مطابقت ندارد.');
      }
      report.counts = tableCounts(resolved.dbFile);
      const expectedCounts = resolved.manifest.db?.counts || {};
      for (const key of ['devices', 'outages', 'alerts', 'credentials']) {
        if (expectedCounts[key] != null && report.counts[key] != null && expectedCounts[key] !== report.counts[key]) {
          report.errors.push(`تعداد ${key} با مانیفست مطابقت ندارد.`);
        }
      }
      for (const tile of resolved.manifest.mbtiles || []) {
        const file = path.join(resolved.dir, 'mbtiles', path.basename(tile.name));
        if (!fs.existsSync(file)) {
          report.errors.push(`فایل نقشهٔ پشتیبان غایب است: ${tile.name}`);
          continue;
        }
        const sha = sha256File(file);
        if (tile.sha256 && sha !== tile.sha256) report.errors.push(`checksum نقشهٔ ${tile.name} نامعتبر است.`);
        report.mbtiles.push({ name: tile.name, path: file, size: fileSizeBytes(file), sha256: sha });
      }

      // پیوست‌ها: هر ورودی مانیفست باید موجود و با checksum یکسان باشد.
      for (const attachment of resolved.manifest.attachments || []) {
        const file = path.join(resolved.dir, 'attachments', path.basename(attachment.name));
        if (!fs.existsSync(file)) {
          report.errors.push(`فایل پیوست پشتیبان غایب است: ${attachment.name}`);
          continue;
        }
        const sha = sha256File(file);
        if (attachment.sha256 && sha !== attachment.sha256) {
          report.errors.push(`checksum پیوست ${attachment.name} نامعتبر است.`);
        }
        if (attachment.size != null && Number(attachment.size) !== fileSizeBytes(file)) {
          report.errors.push(`اندازهٔ پیوست ${attachment.name} با مانیفست مطابقت ندارد.`);
        }
        report.attachments.push({ name: attachment.name, path: file, size: fileSizeBytes(file), sha256: sha });
      }

      // کلید رمزنگاری: فقط نسخهٔ فایلی در مجموعه کپی می‌شود؛ منبع env باید
      // جداگانه در Secret Manager نگهداری شود.
      const key = resolved.manifest.credentialsKey;
      if (key) {
        report.credentialsKey = { source: key.source || 'none', file: null, sha256: null };
        if (key.source === 'file') {
          const keyFile = path.join(resolved.dir, SECRETS_DIR, path.basename(key.file || CREDENTIAL_KEY_BACKUP));
          if (!fs.existsSync(keyFile)) {
            report.errors.push('فایل کلید رمزنگاری در مجموعهٔ پشتیبان غایب است.');
          } else {
            const sha = sha256File(keyFile);
            if (key.sha256 && sha !== key.sha256) report.errors.push('checksum کلید رمزنگاری نامعتبر است.');
            report.credentialsKey.file = keyFile;
            report.credentialsKey.sha256 = sha;
          }
        } else if (key.source === 'env') {
          report.warnings.push('کلید رمزنگاری از متغیر محیطی می‌آید و داخل پشتیبان نیست؛ همان کلید را جداگانه برای Disaster Recovery نگه دارید.');
        } else if (Number(report.counts?.credentials || 0) > 0) {
          report.errors.push('اعتبارنامهٔ رمزنگاری‌شده در پشتیبان هست اما کلید رمزنگاری همراه آن نیست.');
        }
      }
    }
    // ۲) integrity_check و ساختار
    const info = inspectSqliteFile(resolved.dbFile);
    report.integrity = info;
    if (!info.ok) report.errors.push(...info.errors);
    report.ok = report.errors.length === 0;
  } catch (e) {
    report.errors.push(e.message);
    report.ok = false;
  }
  return report;
}


export { verifyBackup };
