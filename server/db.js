/**
 * NetWatch — هماهنگ‌کنندهٔ لایه پایگاه‌داده.
 *
 * مسئولیت‌ها به ماژول‌های تخصصی تقسیم شده‌اند:
 *   • db-connection: اتصال، Query، Transaction/SAVEPOINT
 *   • db-constants: مسیرها، نسخهٔ Schema، تنظیمات پیش‌فرض
 *   • db-schema: Schema پایه
 *   • db-migrations: Migrationها و آمار Query
 *   • db-settings / db-log / db-seed / db-health
 *   • db-recovery: Recovery قبل از بازکردن اتصال
 *
 * این فایل ترتیب راه‌اندازی قبلی را حفظ می‌کند و Exportهای عمومی را بازمی‌گرداند.
 */
import fs from 'node:fs';
import { DatabaseHandle } from './db-connection.js';
import {
  DATA_DIR,
  MBTILES_DIR,
  DB_PATH,
  DB_EXISTED,
  SCHEMA_VERSION,
  SYNC_MODE,
  STATUS,
  DEFAULT_SETTINGS,
} from './db-constants.js';
import { SCHEMA_SQL } from './db-schema.js';
import { recoverInterruptedRestoreBeforeOpen } from './db-recovery.js';
import { createMigrationRunner } from './db-migrations.js';
import { createSettingsStore } from './db-settings.js';
import { createLog } from './db-log.js';
import { createHealth } from './db-health.js';
import { createSeed } from './db-seed.js';
import { assertDiskSpace, freeDiskBytes } from './db-safety.js';

export { DATA_DIR, MBTILES_DIR, DB_PATH, SCHEMA_VERSION, SYNC_MODE, STATUS, DEFAULT_SETTINGS };

// دادهٔ عملیاتی (پایگاه‌داده، پشتیبان، نقشه) فقط برای مالک سرویس قابل دسترس
// باشد؛ پوشهٔ داده ۰۷۰۰ و فایل‌های حساس ۰۶۰۰.
for (const dir of [DATA_DIR, MBTILES_DIR]) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
  } catch {
    /* سیستم فایل/پلتفرم ممکن است chmod را پشتیبانی نکند */
  }
}

// Recovery مرحله پنجم باید پیش از هر اتصال SQLite اجرا شود.
recoverInterruptedRestoreBeforeOpen({
  dataDir: DATA_DIR,
  dbPath: DB_PATH,
  mbtilesDir: MBTILES_DIR,
});

export const db = new DatabaseHandle(DB_PATH);
// فایل پایگاه‌داده شامل هش رمز و نشست‌هاست؛ مجوز فایل محدود می‌شود.
if (!String(DB_PATH).startsWith(':')) {
  try {
    fs.chmodSync(DB_PATH, 0o600);
  } catch {
    /* بی‌اثر */
  }
}

db.exec(SCHEMA_SQL);

/** کمکی عمومی: اجرای اتمیک عملیات چندمرحله‌ای */
export function transaction(fn, options) {
  return db.transaction(fn, options);
}

/** بررسی فضای دیسک پیش از نوشتن سنگین (Import، Backup، Restore) */
export function requireDiskSpace(bytes, label) {
  return assertDiskSpace(DATA_DIR, bytes, label);
}

export function diskSpace() {
  const free = freeDiskBytes(DATA_DIR);
  return {
    freeBytes: free,
    minFreeBytes: Number(process.env.NETWATCH_MIN_FREE_BYTES) || 64 * 1024 * 1024,
  };
}

export const log = createLog({ db });

const migrations = createMigrationRunner({
  db,
  dbPath: DB_PATH,
  dbExisted: DB_EXISTED,
  log,
});
migrations.initializeMigrations();
migrations.refreshQueryStats();
// نمونه‌ها با هر چرخهٔ موتور زیاد می‌شوند و آمار کهنه، برنامه‌ریز را به
// پیمایش کامل برمی‌گرداند؛ هر ۶ ساعت دوباره تحلیل می‌شود. تایمر unref است
// تا تست‌ها و اسکریپت‌ها را زنده نگه ندارد.
const queryStatsTimer = setInterval(() => migrations.refreshQueryStats(), 6 * 3600 * 1000);
queryStatsTimer.unref?.();

export const applyMigrationStep = migrations.applyMigrationStep;
export const runMigrations = migrations.runMigrations;
export const refreshQueryStats = migrations.refreshQueryStats;

const health = createHealth({ db });
export const checkDatabaseHealth = health.checkDatabaseHealth;
export const verifyDatabaseAtStartup = health.verifyDatabaseAtStartup;

const settings = createSettingsStore({ db, transaction, log });
export const ensureDefaultSettings = settings.ensureDefaultSettings;
export const getSettings = settings.getSettings;
export const sanitizeSettings = settings.sanitizeSettings;
export const setSettings = settings.setSettings;

ensureDefaultSettings();

export const seedIfEmpty = createSeed({ db, transaction, STATUS });

if (process.argv[1] && process.argv[1].endsWith('db.js')) {
  const created = seedIfEmpty({ force: process.argv.includes('--force') });
  console.log(created ? 'seed: done' : 'seed: skipped (already has devices)');
  console.log('db:', DB_PATH);
}
