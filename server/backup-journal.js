/**
 * NetWatch — Journal فایل‌های Restore.
 *
 * این ماژول عمداً به db.js وابسته نیست تا db.js بتواند پیش از بازکردن اتصال،
 * Journal را بازیابی کند. هر فایل پیش از تغییر، نسخهٔ قبلی خود را در پوشهٔ
 * Journal می‌گیرد و ورودی آن durable ثبت می‌شود. Rollback معکوس انجام می‌شود.
 */
import fs from 'node:fs';
import path from 'node:path';

const FSYNC_UNSUPPORTED = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS']);

function fsyncPath(target) {
  let fd;
  try {
    fd = fs.openSync(target, 'r');
  } catch (e) {
    if (FSYNC_UNSUPPORTED.has(e?.code)) return;
    throw e;
  }
  try {
    fs.fsyncSync(fd);
  } catch (e) {
    // فقط نبود پشتیبانی فایل‌سیستم قابل اغماض است؛ EIO/ENOSPC/EBADF و مانند
    // آن‌ها باید عملیات را متوقف کنند تا Journal به‌اشتباه durable تلقی نشود.
    if (!FSYNC_UNSUPPORTED.has(e?.code)) throw e;
  } finally {
    fs.closeSync(fd);
  }
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* بی‌اثر */
  }
  return dir;
}

function copyDurable(from, to) {
  ensurePrivateDir(path.dirname(to));
  fs.copyFileSync(from, to);
  try {
    fs.chmodSync(to, 0o600);
  } catch {
    /* بی‌اثر */
  }
  fsyncPath(to);
}

export function readRestoreJournal(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeRestoreJournal(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  fsyncPath(path.dirname(file));
}

export function createRestoreJournalDir(dataDir, startedAt) {
  const dir = path.join(dataDir, `.restore-journal-${startedAt}-${process.pid}`);
  ensurePrivateDir(dir);
  return dir;
}

/**
 * نسخهٔ قبلی یک فایل را در Journal نگه می‌دارد.
 * هنوز هیچ تغییری روی فایل مقصد انجام نشده است.
 */
export function stagePreviousFile({ journalDir, index, type, target }) {
  const name = path.basename(target);
  let existed = false;
  let backup = null;
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`فایل مقصد ${name} یک فایل معمولی نیست.`);
    }
    existed = true;
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
  if (existed) {
    backup = path.join(journalDir, 'previous', `${String(index).padStart(3, '0')}-${type}-${name}`);
    copyDurable(target, backup);
  }
  return {
    type,
    name,
    target,
    backup,
    existed,
    tmp: `${target}.restore-tmp-${process.pid}`,
  };
}

/** نصب اتمیک یک فایل Stage‌شده روی مقصد (پس از ثبت durable ورودی Journal). */
export function installStagedFile(operation, stagedPath, { mode = 0o600 } = {}) {
  ensurePrivateDir(path.dirname(operation.target));
  fs.copyFileSync(stagedPath, operation.tmp);
  try {
    fs.chmodSync(operation.tmp, mode);
  } catch {
    /* بی‌اثر */
  }
  fsyncPath(operation.tmp);
  fs.renameSync(operation.tmp, operation.target);
  fsyncPath(path.dirname(operation.target));
}

/**
 * بازگرداندن همهٔ فایل‌های تغییرکرده به وضعیت پیش از Restore.
 * برای فایل‌هایی که قبلاً وجود نداشتند، فایل جدید حذف می‌شود.
 */
export function rollbackFileOperations(operations = []) {
  const errors = [];
  let restored = 0;
  let removed = 0;
  for (const operation of [...operations].reverse()) {
    if (!operation || typeof operation.target !== 'string') continue;
    try {
      if (operation.tmp) fs.rmSync(operation.tmp, { force: true });
      if (operation.existed) {
        if (!operation.backup || !fs.existsSync(operation.backup)) {
          throw new Error(`نسخهٔ قبلی ${operation.name} در Journal یافت نشد.`);
        }
        const tmp = `${operation.target}.restore-rollback-${process.pid}`;
        copyDurable(operation.backup, tmp);
        fs.renameSync(tmp, operation.target);
        fsyncPath(path.dirname(operation.target));
        restored += 1;
      } else {
        fs.rmSync(operation.target, { force: true });
        fsyncPath(path.dirname(operation.target));
        removed += 1;
      }
    } catch (e) {
      errors.push(`${operation.type || 'file'}:${operation.name || '?'}: ${e?.message || e}`);
    }
  }
  return { ok: errors.length === 0, restored, removed, errors };
}

/** پاک‌سازی فایل‌های موقت نصب در پوشه‌های داده. */
export function cleanupRestoreTempFiles(dirs = []) {
  for (const dir of dirs) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (name.includes('.restore-tmp-')) fs.rmSync(path.join(dir, name), { force: true });
      }
    } catch {
      /* پوشه وجود ندارد */
    }
  }
}

/** فقط پوشهٔ Journal متعلق به همین DATA_DIR حذف می‌شود. */
export function cleanupRestoreJournal(journalDir, dataDir) {
  if (!journalDir || typeof journalDir !== 'string') return false;
  const resolved = path.resolve(journalDir);
  if (path.dirname(resolved) !== path.resolve(dataDir)) return false;
  if (!path.basename(resolved).startsWith('.restore-journal-')) return false;
  try {
    fs.rmSync(resolved, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
