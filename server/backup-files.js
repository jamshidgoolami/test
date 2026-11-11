/**
 * NetWatch — فایل‌ها و مسیرهای مشترک Backup/Restore.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileSizeBytes } from './db-safety.js';
import { MBTILES_DIR } from './db.js';
import { ATTACHMENTS_DIR } from './attachments.js';
import { config } from './config.js';

export const APP_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
})();

export const BACKUP_FORMAT = 1;
export const BACKUP_DIR = config.backupDir;
export const MANIFEST = 'manifest.json';
export const STATE_FILE = '.scheduler-state.json';
export const RESTORE_STATE_FILE = '.restore-state.json';
export const SECRETS_DIR = 'secrets';
export const CREDENTIAL_KEY_BACKUP = 'device-credentials.key';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* پلتفرم/فایل‌سیستم بدون پشتیبانی chmod */
  }
  return dir;
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let read;
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, read));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function fsyncPath(target) {
  try {
    const fd = fs.openSync(target, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* fsync روی برخی فایل‌سیستم‌ها/پلتفرم‌ها پشتیبانی نمی‌شود */
  }
}

function copyFileDurable(from, to) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
  try {
    // پشتیبان پایگاه‌داده شامل دادهٔ کاربران و حسابرسی است.
    fs.chmodSync(to, 0o600);
  } catch {
    /* بی‌اثر */
  }
  fsyncPath(to);
}

function writeJsonDurable(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    /* بی‌اثر */
  }
  fs.renameSync(tmp, file);
  fsyncPath(path.dirname(file));
}


function stampName(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `netwatch-${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
  } catch {
    return null;
  }
}

function mbtilesFiles() {
  try {
    return fs
      .readdirSync(MBTILES_DIR)
      .filter((f) => /\.mbtiles$/i.test(f))
      .sort();
  } catch {
    return [];
  }
}

/** فایل‌های پیوست (بدون فایل‌های موقت `.trash-*`) */
function attachmentFiles() {
  try {
    return fs
      .readdirSync(ATTACHMENTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.trash-'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** اندازهٔ پیوست‌ها برای برآورد فضای پشتیبان */
function attachmentsBytes() {
  return attachmentFiles().reduce((sum, name) => sum + fileSizeBytes(path.join(ATTACHMENTS_DIR, name)), 0);
}


export {
  ensureDir,
  sha256File,
  fsyncPath,
  copyFileDurable,
  writeJsonDurable,
  stampName,
  readManifest,
  mbtilesFiles,
  attachmentFiles,
  attachmentsBytes,
};
