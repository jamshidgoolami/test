/**
 * NetWatch — اتصال SQLite، PRAGMAها، Query و Transaction/SAVEPOINT.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { logEvent } from './logger.mjs';
import { DbError, DB_ERROR_CODES, logDbError } from './db-errors.js';
import { normalizeBindParams } from './db-safety.js';
import { SYNC_MODE } from './db-constants.js';
import { recordQuery } from './metrics.js';

const BUSY_TIMEOUT_MS = (() => {
  const n = Number(process.env.NETWATCH_BUSY_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 100 && n <= 60000 ? Math.floor(n) : 5000;
})();
const WAL_AUTOCHECKPOINT_PAGES = 1000;
const JOURNAL_SIZE_LIMIT = 64 * 1024 * 1024;

class DatabaseHandle {
  constructor(file) {
    this.file = file;
    this.raw = null;
    this.txDepth = 0;
    this.statements = new Map();
    this.closed = false;
    this._open();
  }

  _open() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.raw = new DatabaseSync(this.file);
    this.closed = false;
    this.statements.clear();
    this.txDepth = 0;
    this._applyPragmas();
  }

  _applyPragmas() {
    const raw = this.raw;
    const skipped = (name, err) => logEvent('warn', 'db_pragma_failed', { name, message: err?.message });
    try {
      raw.exec('PRAGMA journal_mode = WAL');
    } catch (e) {
      skipped('journal_mode', e);
    }
    try {
      raw.exec(`PRAGMA synchronous = ${SYNC_MODE}`);
    } catch (e) {
      skipped('synchronous', e);
    }
    raw.exec('PRAGMA foreign_keys = ON');
    raw.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    raw.exec(`PRAGMA wal_autocheckpoint = ${WAL_AUTOCHECKPOINT_PAGES}`);
    raw.exec(`PRAGMA journal_size_limit = ${JOURNAL_SIZE_LIMIT}`);
    // شمارنده‌های داخلی SQLite برای افزایش امنیت در برابر حافظهٔ خراب
    try {
      raw.exec('PRAGMA trusted_schema = OFF');
    } catch (e) {
      skipped('trusted_schema', e);
    }
  }

  _assertOpen() {
    if (this.closed || !this.raw) {
      throw new DbError(DB_ERROR_CODES.NOT_OPEN, 'اتصال پایگاه‌داده بسته است.', { status: 503 });
    }
  }

  _statement(sql) {
    this._assertOpen();
    let stmt = this.statements.get(sql);
    if (!stmt) {
      try {
        stmt = this.raw.prepare(sql);
      } catch (e) {
        throw logDbError('db.prepare', e, { sql, force: true });
      }
      // سقف کش: پرس‌وجوهای داینامیک (IN با تعداد متغیر) نباید حافظه را بی‌نهایت رشد دهند
      if (this.statements.size >= 512) this.statements.clear();
      this.statements.set(sql, stmt);
    }
    return stmt;
  }

  _run(kind, sql, args) {
    const params = normalizeBindParams(args, sql);
    const isTx = this.txDepth > 0;
    let lastError = null;
    // سنجهٔ تأخیر Query: هزینهٔ performance.now ناچیز است و برای صفحهٔ Application
    // Health و شناسایی Queryهای کند در همین فرآیند لازم است.
    const started = performance.now();
    // داخل تراکنش تلاش دوباره انجام نمی‌شود؛ تراکنش باید یک‌جا Rollback شود.
    for (let attempt = 0; attempt < (isTx ? 1 : 2); attempt++) {
      try {
        const result = this._statement(sql)[kind](...params);
        recordQuery(sql, performance.now() - started);
        return result;
      } catch (e) {
        lastError = e;
        if (isTx || !/busy|locked/i.test(`${e?.message || ''} ${e?.code || ''}`)) break;
        sleepSync(50 * (attempt + 1));
      }
    }
    recordQuery(sql, performance.now() - started, true);
    throw logDbError(`db.${kind}`, lastError, { sql, force: true });
  }

  prepare(sql) {
    const text = String(sql ?? '');
    if (!text.trim()) throw new DbError(DB_ERROR_CODES.BINDING, 'دستور SQL خالی است.', { status: 400 });
    const handle = this;
    return {
      source: text,
      run: (...args) => handle._run('run', text, args),
      get: (...args) => handle._run('get', text, args),
      all: (...args) => handle._run('all', text, args),
      iterate: (...args) => handle._statement(text).iterate(...normalizeBindParams(args, text)),
    };
  }

  exec(sql) {
    this._assertOpen();
    try {
      return this.raw.exec(String(sql ?? ''));
    } catch (e) {
      throw logDbError('db.exec', e, { sql, force: true });
    }
  }

  /**
   * اجرای یک عملیات منطقی چندمرحله‌ای به‌صورت اتمیک.
   * فراخوانی تودرتو با SAVEPOINT پشتیبانی می‌شود؛ خطا در هر مرحله کل عملیات
   * (یا فقط بلوک داخلی) را به حالت قبل برمی‌گرداند.
   *
   * @template T
   * @param {() => T} fn عملیات همگام؛ Promise مجاز نیست (قفل نوشتن باز می‌ماند)
   * @param {{immediate?: boolean, label?: string}} [options]
   * @returns {T}
   */
  transaction(fn, { immediate = true, label = 'tx' } = {}) {
    this._assertOpen();
    if (typeof fn !== 'function') throw new TypeError('transaction(fn) نیازمند تابع است.');
    const outer = this.txDepth === 0;
    const savepoint = `nw_sp_${++txSeq}`;
    this.raw.exec(outer ? (immediate ? 'BEGIN IMMEDIATE' : 'BEGIN') : `SAVEPOINT ${savepoint}`);
    this.txDepth++;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        throw new DbError(DB_ERROR_CODES.BINDING, 'تراکنش باید همگام باشد؛ تابع async داده نشود.', { status: 500 });
      }
      this.txDepth--;
      this.raw.exec(outer ? 'COMMIT' : `RELEASE ${savepoint}`);
      return result;
    } catch (err) {
      this.txDepth = Math.max(0, this.txDepth - 1);
      try {
        if (outer) this.raw.exec('ROLLBACK');
        else {
          this.raw.exec(`ROLLBACK TO ${savepoint}`);
          this.raw.exec(`RELEASE ${savepoint}`);
        }
      } catch (rollbackErr) {
        logEvent('error', 'db_rollback_failed', {
          label,
          message: rollbackErr?.message,
          cause: err?.message,
        });
      }
      if (err instanceof DbError) throw err;
      // خطاهای غیرپایگاه‌داده (اعتبارسنجی/کسب‌وکار) بدون تغییر و بدون لاگ
      // «db_error» عبور می‌کنند تا عیب‌یابی گمراه نشود.
      const normalized = logDbError(`transaction.${label}`, err);
      throw normalized === err ? err : normalized;
    }
  }

  /** Checkpoint امن: محتوای WAL به فایل اصلی منتقل و فایل WAL کوتاه می‌شود */
  checkpoint(mode = 'TRUNCATE') {
    this._assertOpen();
    const safe = ['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE'].includes(String(mode).toUpperCase())
      ? String(mode).toUpperCase()
      : 'TRUNCATE';
    try {
      const row = this.raw.prepare(`PRAGMA wal_checkpoint(${safe})`).get();
      return {
        mode: safe,
        busy: Number(row?.busy ?? 0),
        logFrames: Number(row?.log ?? 0),
        checkpointedFrames: Number(row?.checkpointed ?? 0),
      };
    } catch (e) {
      throw logDbError('db.checkpoint', e);
    }
  }

  /** وضعیت فایل‌های WAL/SHM برای گزارش سلامت */
  walInfo() {
    const size = (p) => {
      try {
        return fs.statSync(p).size;
      } catch {
        return 0;
      }
    };
    return {
      journalMode: this.raw ? this.raw.prepare('PRAGMA journal_mode').get()?.journal_mode : null,
      synchronous: this.raw ? this.raw.prepare('PRAGMA synchronous').get()?.synchronous : null,
      walBytes: size(`${this.file}-wal`),
      shmBytes: size(`${this.file}-shm`),
      dbBytes: size(this.file),
    };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.statements.clear();
    try {
      this.raw?.close();
    } catch (e) {
      logEvent('warn', 'db_close_failed', { message: e?.message });
    }
    this.raw = null;
  }

  /** بازگشایی پس از Restore؛ Prepared Statementها با SQL از نو ساخته می‌شوند */
  reopen() {
    this.close();
    this._open();
    return this;
  }
}

let txSeq = 0;

/** خواب همگام کوچک برای تلاش دوبارهٔ SQLITE_BUSY (بدون async در مسیر تراکنش) */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* بی‌اثر */
  }
}


export { DatabaseHandle };
