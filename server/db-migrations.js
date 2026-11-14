/**
 * NetWatch — Migrationهای نسخه‌بندی‌شده و به‌روزرسانی آمار Query.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logEvent } from './logger.mjs';
import { DbError, DB_ERROR_CODES } from './db-errors.js';
import { assertSqlIdentifier } from './db-safety.js';
import { SCHEMA_VERSION } from './db-constants.js';

export function createMigrationRunner({ db, dbPath, dbExisted, log }) {
/**
 * پشتیبان فایلی پیش از Migration. قبل از هر تغییر ساختار، یک کپی کامل و
 * قابل‌بازیابی از پایگاه‌داده ساخته می‌شود؛ اگر Migration نیمه‌کاره بماند،
 * اپراتور می‌تواند همین فایل را بازگرداند.
 * @returns {string|null} مسیر فایل پشتیبان
 */
function backupBeforeMigration(fromVersion) {
  if (!dbExisted) return null;
  if (String(dbPath).startsWith(':')) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${dbPath}.pre-migration-v${fromVersion}-${stamp}`;
  const tmp = `${dest}.tmp-${process.pid}`;
  try {
    // VACUUM INTO یک عکس منطقی کامل از اتصال می‌سازد و تراکنش‌های تأییدشده‌ای
    // را که هنوز در WAL هستند نیز شامل می‌شود. کپی خام فایل اصلی بدون WAL
    // می‌تواند پشتیبان را ناقص بگذارد.
    db.prepare('VACUUM INTO ?').run(tmp);
    try {
      fs.chmodSync(tmp, 0o600);
    } catch {
      /* مجوز فایل روی بعضی فایل‌سیستم‌ها قابل تغییر نیست */
    }
    fs.renameSync(tmp, dest);
    logEvent('info', 'db_pre_migration_backup', { fromVersion, toVersion: SCHEMA_VERSION, file: path.basename(dest) });
    return dest;
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* بی‌اثر */
    }
    // اگر پشتیبان ساخته نشود، Migration انجام نمی‌شود؛ ادامه روی دادهٔ بدون
    // نسخهٔ پشتیبان، ریسک غیرقابل‌بازگشت می‌سازد.
    throw new DbError(DB_ERROR_CODES.BACKUP_INVALID, `پشتیبان پیش از Migration ساخته نشد: ${e.message}`, { status: 500 });
  }
}

function currentSchemaVersion() {
  try {
    return Number(db.prepare('PRAGMA user_version').get()?.user_version) || 0;
  } catch {
    return 0;
  }
}

function hasColumn(table, column) {
  try {
    // نام جدول/ستون هرگز از ورودی کاربر نمی‌آید؛ با این حال اعتبارسنجی می‌شود
    // تا الگوی «درج رشته در SQL» در هیچ مسیری تکرار نشود.
    const t = assertSqlIdentifier(table, 'نام جدول');
    return db
      .prepare(`PRAGMA table_info(${t})`)
      .all()
      .some((c) => c.name === column);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Migrationهای نسخه‌بندی‌شده                                         */
/* ------------------------------------------------------------------ */
/*
 * هر تغییر ساختار یک گام شماره‌دار است و پس از اعمال، در جدول
 * `schema_migrations` ثبت می‌شود. `PRAGMA user_version` هم در همان تراکنش
 * به‌روزرسانی می‌شود تا حتی با قطع ناگهانی، «نیمه‌مهاجرت» رخ ندهد.
 * گام‌ها idempotent هستند (CREATE IF NOT EXISTS / بررسی ستون) تا اجرای دوباره
 * روی پایگاه‌داده‌ای که user_version ندارد ولی ساختارش کامل است، بی‌خطر باشد.
 */

/** گام ۲: ستون‌های تاب‌آوری، ایندکس‌ها و قیدهای یکتایی (Phase 1) */
function applyResilienceMigration() {
  // زمان‌بندی صریح بررسی بعدی هر تجهیز؛ به موتور اجازه می‌دهد در هر ثانیه به‌جای
  // پیمایش همه تجهیزات، فقط تجهیزات سررسیدشده را با ایندکس بخواند (مقیاس ۱۰۰۰+)
  if (!hasColumn('devices', 'next_check_at')) {
    db.exec('ALTER TABLE devices ADD COLUMN next_check_at INTEGER NOT NULL DEFAULT 0');
  }
  // اگر ستون در نسخهٔ میانی بدون مقدار پیش‌فرض ساخته شده باشد، NULL یعنی «هیچ‌وقت سررسید
  // نمی‌شود» و آن تجهیز هرگز بررسی نخواهد شد؛ پس همهٔ NULL‌ها به ۰ برگردانده می‌شوند.
  db.exec('UPDATE devices SET next_check_at = 0 WHERE next_check_at IS NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_devices_due ON devices(enabled, monitoring_enabled, next_check_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_outages_started ON outages(started_at DESC)');
  // نام کاربری بدون توجه به بزرگی/کوچکی یکتا باشد (admin ≠ Admin)
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase ON users(username COLLATE NOCASE)');
  } catch {
    log('warn', 'ساخت ایندکس یکتای نام کاربری ناموفق بود (نام تکراری در دادهٔ موجود).');
  }
  // کمینه تأخیر روزانه برای گزارش‌های بلندمدتی که نمونهٔ خام‌شان هرس شده است
  if (!hasColumn('daily_stats', 'min_rtt')) {
    db.exec('ALTER TABLE daily_stats ADD COLUMN min_rtt REAL');
  }

  // زمان برنامه‌ریزی‌شده (سررسید) و زمان واقعی شروع هر بررسی. اختلاف این دو،
  // شاخص «تأخیر زمان‌بندی موتور» (Scheduling Lag) را می‌سازد؛ بدون ثبت آن،
  // عقب‌ماندگی موتور در بار بالا فقط به‌صورت غیرمستقیم دیده می‌شد.
  if (!hasColumn('samples', 'scheduled_at')) {
    db.exec('ALTER TABLE samples ADD COLUMN scheduled_at INTEGER');
  }
  if (!hasColumn('samples', 'started_at')) {
    db.exec('ALTER TABLE samples ADD COLUMN started_at INTEGER');
  }

  // Fencing Token: پایگاه‌داده‌های قدیمی ستون epoch ندارند. مقدار پیش‌فرض ۰
  // سازگار است؛ نخستین گرفتن قفل آن را به ۱ می‌رساند.
  if (!hasColumn('engine_lock', 'epoch')) {
    db.exec('ALTER TABLE engine_lock ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0');
  }
  db.exec('CREATE TABLE IF NOT EXISTS engine_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)');
  db.exec("INSERT OR IGNORE INTO engine_meta(key, value) VALUES ('leader_epoch', 0)");

  // «یک نتیجه برای هر عملیات»: unique روی (device_id, started_at) از ثبت
  // دوبارهٔ نتیجهٔ یک Probe توسط دو مسیر/فرآیند جلوگیری می‌کند. ردیف‌های قدیمی
  // که started_at ندارند مشمول قید جزئی نیستند. اگر دادهٔ قدیمی تکراری باشد،
  // ساخت ایندکس شکست می‌خورد؛ در آن حالت هشدار داده می‌شود و برنامه متوقف
  // نمی‌شود (Migration باید Backward Compatible باشد).
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_samples_operation ON samples(device_id, started_at) WHERE started_at IS NOT NULL');
  } catch (e) {
    log('warn', `ساخت قید یکتای نتیجهٔ عملیات ناموفق بود (دادهٔ تکراری قدیمی): ${e.message}`);
  }

  /* ایندکس‌های تکمیلی: هر یک بر اساس EXPLAIN QUERY PLAN پرس‌وجوهای واقعی
     برنامه اضافه شده‌اند (گزارش در docs/db-reliability-report.md). */
  db.exec(`
    -- ضدتکرار هشدار: recentAlert با duplicate_key جست‌وجو می‌کند
    CREATE INDEX IF NOT EXISTS idx_alerts_duplicate ON alerts(duplicate_key, created_at DESC);
    -- فهرست/حل هشدارهای یک تجهیز
    CREATE INDEX IF NOT EXISTS idx_alerts_device_status ON alerts(device_id, status, kind);
    -- قطعی باز هر تجهیز (و تضمین «حداکثر یک قطعی باز»)
    CREATE INDEX IF NOT EXISTS idx_outages_open ON outages(device_id) WHERE open = 1;
    -- هرس قطعی‌های بسته‌شده بر اساس زمان شروع
    CREATE INDEX IF NOT EXISTS idx_outages_closed_started ON outages(started_at) WHERE open = 0;
    -- نگهداری سابقهٔ تعمیرات متصل به قطعی (هرس نباید پیوند را قطع کند)
    CREATE INDEX IF NOT EXISTS idx_maint_outage ON maintenance_records(outage_id);
    -- پنجره‌های تعمیرات فعال هر تجهیز/سراسری
    CREATE INDEX IF NOT EXISTS idx_windows_device ON maintenance_windows(device_id, enabled);
    -- شمارش موفق/ناموفق هر تجهیز بدون پیمایش کل نمونه‌ها
    CREATE INDEX IF NOT EXISTS idx_samples_device_ok ON samples(device_id, ok, ts DESC);
    -- فهرست تجهیزات بر اساس نوع/اولویت (فیلترهای پرکاربرد فهرست)
    CREATE INDEX IF NOT EXISTS idx_devices_type ON devices(device_type);
    CREATE INDEX IF NOT EXISTS idx_devices_priority ON devices(priority);
    -- تجمیع هشدارها/قطعی‌ها به تفکیک بازه (گزارش‌ها بدون زیرپرس‌وجوی همبسته)
    CREATE INDEX IF NOT EXISTS idx_alerts_device_created ON alerts(device_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_outages_device_window ON outages(device_id, started_at, ended_at);
    -- فیلتر bbox نقشه: فقط تجهیزات دارای مختصات در ایندکس می‌آیند
    CREATE INDEX IF NOT EXISTS idx_devices_geo ON devices(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
  `);
  // «حداکثر یک قطعی باز برای هر تجهیز» نه فقط یک قاعدهٔ کد، بلکه یک قید
  // پایگاه‌داده می‌شود. اگر موتور وسط ثبت قطعی از کار بیفتد یا نسخهٔ قدیمی
  // ردیف تکراری ساخته باشد، این قید جلوی ادامهٔ خرابی را می‌گیرد.
  try {
    const dupes = db.prepare('SELECT device_id, COUNT(*) AS c FROM outages WHERE open = 1 GROUP BY device_id HAVING c > 1').all();
    for (const d of dupes) {
      const rows = db.prepare('SELECT id, started_at FROM outages WHERE device_id = ? AND open = 1 ORDER BY started_at ASC, id ASC').all(d.device_id);
      for (const extra of rows.slice(1)) {
        db.prepare(
          `UPDATE outages SET open = 0, ended_at = COALESCE(ended_at, ?),
             duration_sec = COALESCE(duration_sec, MAX(1, CAST((? - started_at) / 1000 AS INTEGER)))
           WHERE id = ?`
        ).run(extra.started_at, extra.started_at, extra.id);
      }
      log('warn', `قطعی باز تکراری برای تجهیز #${d.device_id} تجمیع شد (${rows.length - 1} ردیف بسته شد).`);
    }
    // ایندکس قدیمی (غیریکتا) با همان نام باید پیش از ساخت نسخهٔ یکتا حذف شود.
    const existing = db.prepare("SELECT name, \"unique\" AS u FROM pragma_index_list('outages') WHERE name = 'idx_outages_open'").get();
    if (existing && !existing.u) db.exec('DROP INDEX idx_outages_open');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_outages_open ON outages(device_id) WHERE open = 1');
  } catch (e) {
    log('warn', `ساخت قید یکتای قطعی باز ناموفق بود: ${e.message}`);
  }

  // آمار بهینه‌ساز فقط وقتی جدول‌ها داده دارند معنا دارد؛ یک‌بار در هر راه‌اندازی
  // این کار ارزان است و برنامه‌ریز را از پیمایش کامل جدا می‌کند.
  try {
    db.exec('PRAGMA optimize');
  } catch {
    /* بی‌اثر */
  }
}

/** گام ۳: جداول و ایندکس‌های Data Retention و وضعیت زمان اجرا (Phase 2) */
function applyRetentionMigration() {
  db.exec(`
    -- هر اجرای Retention (خودکار/دستی/آزمایشی) یک ردیف durable دارد؛ وضعیت
    -- پس از Crash هم از همین‌جا خوانده می‌شود.
    CREATE TABLE IF NOT EXISTS retention_runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at    INTEGER NOT NULL,
      finished_at   INTEGER,
      trigger       TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | manual | engine | cli
      actor         TEXT NOT NULL DEFAULT '',
      dry_run       INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'running', -- running | completed | stopped | failed | interrupted
      stage         TEXT NOT NULL DEFAULT '',
      deleted       TEXT NOT NULL DEFAULT '{}', -- JSON: {samples: n, outages: n, …}
      scanned       INTEGER NOT NULL DEFAULT 0,
      deleted_rows  INTEGER NOT NULL DEFAULT 0,
      freed_bytes   INTEGER NOT NULL DEFAULT 0,
      batches       INTEGER NOT NULL DEFAULT 0,
      duration_ms   INTEGER,
      error         TEXT NOT NULL DEFAULT '',
      policy        TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_retention_runs_started ON retention_runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_retention_runs_status ON retention_runs(status, started_at DESC);

    -- قفل تک‌نمونه‌ای Retention: از اجرای هم‌زمان دو نسخه (سرور + CLI) جلوگیری
    -- می‌کند. قفل منقضی‌شده پس از Crash با lease تازه گرفته می‌شود.
    CREATE TABLE IF NOT EXISTS retention_state (
      id                INTEGER PRIMARY KEY CHECK (id = 1),
      lock_owner        TEXT,
      lock_expires_at   INTEGER NOT NULL DEFAULT 0,
      -- درخواست توقف از فرآیند دیگر (بین دو Batch خوانده می‌شود)
      stop_requested    INTEGER NOT NULL DEFAULT 0,
      last_run_id       INTEGER,
      last_started_at   INTEGER,
      last_finished_at  INTEGER,
      last_status       TEXT NOT NULL DEFAULT 'never',
      last_deleted_rows INTEGER NOT NULL DEFAULT 0,
      last_freed_bytes  INTEGER NOT NULL DEFAULT 0,
      next_run_at       INTEGER,
      updated_at        INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO retention_state(id, updated_at) VALUES (1, 0);

    -- وضعیت کوچک زمان اجرا (مثلاً آخرین مشاهدهٔ ساعت دیوار)؛ مقدارها JSON متنی‌اند
    CREATE TABLE IF NOT EXISTS runtime_state (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- ایندکس‌های کلید خارجی که SQLite خودکار نمی‌سازد؛ بدون آن‌ها حذف/به‌روزرسانی
    -- والد (گروه، لایه، قاعدهٔ هشدار) نیازمند پیمایش کامل جدول فرزند است.
    CREATE INDEX IF NOT EXISTS idx_devices_layer ON devices(map_layer_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_rule ON alerts(rule_id);
    CREATE INDEX IF NOT EXISTS idx_alert_rules_group ON alert_rules(scope_group_id);
    -- کمینه/بیشینهٔ قطعی‌ها بر اساس پایان؛ گزارش‌های بازه‌ای بدون اسکن کامل
    CREATE INDEX IF NOT EXISTS idx_outages_ended ON outages(ended_at) WHERE ended_at IS NOT NULL;
  `);
}

/** گام ۴: قفل حساب، Idle Timeout و ثبت تغییر رمز (Phase 3) */
function applyAuthSecurityMigration() {
  // شمارندهٔ تلاش ناموفق و زمان پایان قفل؛ پیش‌فرض ۰/NULL یعنی حساب باز است.
  if (!hasColumn('users', 'failed_login_count')) {
    db.exec('ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!hasColumn('users', 'locked_until')) {
    db.exec('ALTER TABLE users ADD COLUMN locked_until INTEGER');
  }
  if (!hasColumn('users', 'password_changed_at')) {
    db.exec('ALTER TABLE users ADD COLUMN password_changed_at INTEGER');
  }
  // آخرین بازدید برای Idle Timeout و پاک‌سازی نشست‌های بی‌فعالیت.
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen_at)');
  // ردیف‌های قدیمی که مقدار NULL دارند نباید باعث خطای مقایسه شوند.
  db.exec('UPDATE users SET failed_login_count = 0 WHERE failed_login_count IS NULL');
}

/** گام ۵: ایندکس‌های عملکردی (Phase 5) — بر پایهٔ EXPLAIN QUERY PLAN */
function applyPerformanceIndexesMigration() {
  db.exec(`
    -- فهرست هشدارهای فعال و شمارش آن‌ها: پیش‌تر status را از ایندکس می‌خواند و
    -- سپس با TEMP B-TREE مرتب می‌کرد؛ با هشدارهای زیاد این مرتب‌سازی گران بود.
    CREATE INDEX IF NOT EXISTS idx_alerts_status_created ON alerts(status, created_at DESC);
    -- شمارش قطعی‌های باز داشبورد (ended_at IS NULL) بدون اسکن جدول بزرگ outages
    CREATE INDEX IF NOT EXISTS idx_outages_ended_open ON outages(ended_at) WHERE ended_at IS NULL;
    -- سری روزانهٔ یک تجهیز در جزئیات تجهیز/گزارش (پوشش device_id + day)
    CREATE INDEX IF NOT EXISTS idx_daily_device_day ON daily_stats(device_id, day);
  `);
  try {
    db.exec('PRAGMA optimize');
  } catch {
    /* بی‌اثر */
  }
}

/**
 * گام ۱۵: دیاگرام‌های ماژولار شبکه.
 *
 * هر دیاگرام یک «فایل مستقل» است: نام، توضیح و تمام اجزای بوم (تجهیزات،
 * شکل‌ها، یادداشت‌ها و ارتباط‌ها) در ستون `data` همان ردیف ذخیره می‌شوند.
 * ساختار درختی با `parent_id` ساخته می‌شود؛ حذف یک دیاگرام، زیرمجموعه‌هایش
 * را هم حذف می‌کند (ON DELETE CASCADE) و هیچ دیاگرام دیگری تغییر نمی‌کند.
 * `revision` برای جلوگیری از بازنویسی هم‌زمان دو تب است.
 *
 * گام‌های ۶ تا ۹، ۱۱ و ۱۴ (ماژول حذف‌شدهٔ توپولوژی/دیاگرام قبلی) بازنشسته
 * شده‌اند و این گام، جدول‌های باقی‌ماندهٔ آن‌ها را پاک می‌کند.
 */
function applyDiagramsMigration() {
  db.exec(`
    DROP TABLE IF EXISTS topology_versions;
    DROP TABLE IF EXISTS topology_paths;
    DROP TABLE IF EXISTS topology_links;
    DROP TABLE IF EXISTS topology_nodes;
    DROP TABLE IF EXISTS topology_site_devices;
    DROP TABLE IF EXISTS topology_sites;
    DROP TABLE IF EXISTS topology_link_telemetry;
    DROP TABLE IF EXISTS topology_hierarchy_connections;
    DROP TABLE IF EXISTS topology_hierarchy_nodes;

    CREATE TABLE IF NOT EXISTS diagrams (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id   INTEGER REFERENCES diagrams(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      data        TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
      revision    INTEGER NOT NULL DEFAULT 1,
      created_by  TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_diagrams_parent ON diagrams(parent_id);
    CREATE INDEX IF NOT EXISTS idx_diagrams_updated ON diagrams(updated_at DESC);
  `);
}

/**
 * گام ۱۰: قابلیت‌های مدیریتی و توسعه‌ای.
 *
 * • تاریخ نصب تجهیز (installed_at) برای فیلتر و گزارش‌گیری.
 * • عضویت چندگروهی (device_group_members) با Backfill از group_id قدیمی؛
 *   ستون group_id برای سازگاری کامل نسخه‌های قبلی حفظ می‌شود.
 * • قالب تجهیز (device_templates) با تنظیمات JSON و نسخهٔ اعمال.
 * • پیوست تجهیز (device_attachments) با فرادادهٔ فایل و مالک.
 *
 * همهٔ دستورها idempotent هستند تا اجرای دوباره روی پایگاه‌داده‌ای که
 * user_version ندارد ولی ساختارش کامل است، بی‌خطر باشد.
 */
function applyManagementExtensionsMigration() {
  if (!hasColumn('devices', 'installed_at')) {
    db.exec('ALTER TABLE devices ADD COLUMN installed_at INTEGER');
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_devices_installed ON devices(installed_at) WHERE installed_at IS NOT NULL;

    CREATE TABLE IF NOT EXISTS device_group_members (
      device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      added_at  INTEGER NOT NULL,
      PRIMARY KEY (device_id, group_id)
    );
    CREATE INDEX IF NOT EXISTS idx_device_group_members_group ON device_group_members(group_id, device_id);

    CREATE TABLE IF NOT EXISTS device_templates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      device_type TEXT NOT NULL DEFAULT '',
      settings    TEXT NOT NULL DEFAULT '{}',
      created_by  TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_attachments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      file_name    TEXT NOT NULL,
      stored_name  TEXT NOT NULL UNIQUE,
      mime         TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes   INTEGER NOT NULL DEFAULT 0,
      kind         TEXT NOT NULL DEFAULT 'file',
      uploaded_by  TEXT NOT NULL DEFAULT '',
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_device_attachments_device ON device_attachments(device_id, created_at DESC);
  `);
  // مهاجرت دادهٔ قبلی: هر تجهیزی که group_id دارد، عضو همان گروه می‌شود.
  db.prepare(
    `INSERT OR IGNORE INTO device_group_members(device_id, group_id, added_at)
     SELECT id, group_id, COALESCE(created_at, ?) FROM devices WHERE group_id IS NOT NULL`
  ).run(Date.now());
}

/**
 * گام ۲۱: مخزن اعتبارنامهٔ تجهیزات.
 *
 * هر تجهیز می‌تواند چند اعتبارنامه داشته باشد (SSH، پنل وب، SNMP، کنسول …).
 * نام کاربری، رمز و یادداشت با AES-256-GCM رمزنگاری می‌شوند؛ ستون‌های متنی
 * (عنوان، میزبان، برچسب‌ها) برای جست‌وجو و فیلتر رمزنگاری نمی‌شوند.
 *
 * `strength` (۰..۴) و `weak_reasons` در زمان ذخیره محاسبه می‌شوند تا فهرست
 * «رمزهای ضعیف» بدون رمزگشایی همهٔ ردیف‌ها قابل فیلتر باشد. حذف تجهیز،
 * اعتبارنامه را حذف نمی‌کند و فقط اتصالش را خالی می‌کند (ON DELETE SET NULL).
 */
function applyCredentialsVaultMigration() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id         INTEGER REFERENCES devices(id) ON DELETE SET NULL,
      label             TEXT NOT NULL DEFAULT '',
      kind              TEXT NOT NULL DEFAULT 'other',
      username_enc      TEXT NOT NULL DEFAULT '',
      secret_enc        TEXT NOT NULL DEFAULT '',
      notes_enc         TEXT NOT NULL DEFAULT '',
      host              TEXT NOT NULL DEFAULT '',
      port              INTEGER,
      tags              TEXT NOT NULL DEFAULT '',
      strength          INTEGER NOT NULL DEFAULT 0,
      weak_reasons      TEXT NOT NULL DEFAULT '[]',
      last_rotated_at   INTEGER,
      rotate_every_days INTEGER,
      created_by        TEXT NOT NULL DEFAULT '',
      updated_by        TEXT NOT NULL DEFAULT '',
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_credentials_device ON credentials(device_id);
    CREATE INDEX IF NOT EXISTS idx_credentials_kind ON credentials(kind);
    CREATE INDEX IF NOT EXISTS idx_credentials_strength ON credentials(strength);
    CREATE INDEX IF NOT EXISTS idx_credentials_updated ON credentials(updated_at DESC);
  `);
}

const MIGRATIONS = [
  { version: 1, name: 'baseline', up: () => {} },
  { version: 2, name: 'resilience', up: applyResilienceMigration },
  { version: 3, name: 'retention-policy', up: applyRetentionMigration },
  { version: 4, name: 'auth-security', up: applyAuthSecurityMigration },
  { version: 5, name: 'performance-indexes', up: applyPerformanceIndexesMigration },
  // گام‌های ۶ تا ۹، ۱۱ و ۱۴ به ماژول حذف‌شدهٔ توپولوژی تعلق داشتند. شماره‌ها
  // برای سازگاری با پایگاه‌داده‌های موجود حفظ شده‌اند، اما کاری انجام نمی‌دهند؛
  // جدول‌های باقی‌مانده در گام ۱۵ پاک می‌شوند.
  { version: 6, name: 'retired-topology', up: () => {} },
  { version: 7, name: 'retired-topology-live', up: () => {} },
  { version: 8, name: 'retired-topology-analysis', up: () => {} },
  { version: 9, name: 'retired-topology-history', up: () => {} },
  { version: 10, name: 'management-extensions', up: applyManagementExtensionsMigration },
  { version: 11, name: 'retired-snmp-removal', up: () => {} },
  { version: 12, name: 'service-availability', up: applyServiceAvailabilityMigration },
  { version: 13, name: 'attachment-limit-50mb', up: applyAttachmentLimitMigration },
  { version: 14, name: 'retired-topology-hierarchy', up: () => {} },
  { version: 15, name: 'modular-diagrams', up: applyDiagramsMigration },
  { version: 16, name: 'retired-network-discovery', up: applyDiscoveryRemovalMigration },
  { version: 17, name: 'diagram-attachments', up: applyDiagramAttachmentsMigration },
  { version: 18, name: 'device-identity-and-types', up: applyDeviceIdentityMigration },
  { version: 19, name: 'device-credentials', up: applyDeviceCredentialsMigration },
  { version: 20, name: 'device-sites', up: applySitesMigration },
  { version: 21, name: 'credentials-vault', up: applyCredentialsVaultMigration },
  { version: 22, name: 'user-extra-permissions', up: applyUserExtraPermissionsMigration },
  { version: 23, name: 'device-tags-reverse-index', up: applyDeviceTagReverseIndexMigration },
  { version: 24, name: 'server-monitoring', up: applyServerMonitoringMigration },
  { version: 25, name: 'server-alert-thresholds', up: applyServerAlertThresholdsMigration },
];

/**
 * گام ۲۲: مجوز اختصاصی کاربر.
 *
 * فقط مجوزهای قابل‌اعطا (فعلاً credentials:reveal) در این ستون می‌نشینند و
 * نقش پایه را تغییر نمی‌دهند. مقدار پیش‌فرض [] یعنی هیچ مجوز اضافه‌ای ندارد.
 */
function applyUserExtraPermissionsMigration() {
  if (!hasColumn('users', 'extra_permissions')) {
    db.exec("ALTER TABLE users ADD COLUMN extra_permissions TEXT NOT NULL DEFAULT '[]'");
  }
}

/**
 * گام ۲۴: پایش ماژولار سرورها.
 *
 * سرور از تجهیزات شبکه جدا نگه داشته می‌شود تا متریک‌های سنگین (تاریخچهٔ
 * CPU/RAM/شبکه/دما) و اعتبارنامهٔ BMC، جدول devices را شلوغ نکنند. هر سرور
 * می‌تواند هم‌زمان از Agent ویندوز (متریک‌های OS) و BMC (دما/سلامت سخت‌افزار)
 * داده بگیرد؛ `source` در تمام جدول‌های snapshot نگه داشته می‌شود تا دادهٔ دو
 * کانال روی هم بازنویسی نشود.
 */
/**
 * گام ۲۵: آستانه‌های هشدار سرور و اتصال هشدار سرور به مرکز هشدار.
 *
 * آستانه‌ها روی خود سرور ذخیره می‌شوند تا هر Supermicro آستانهٔ عملیاتی
 * خودش را داشته باشد. ستون `server_id` در جدول alerts اجازه می‌دهد هشدارهای
 * دما/CPU/RAM در همان مرکز هشدار و همان کانال SSE ثبت و نمایش داده شوند.
 */
function applyServerAlertThresholdsMigration() {
  if (!hasColumn('servers', 'alert_enabled')) {
    db.exec('ALTER TABLE servers ADD COLUMN alert_enabled INTEGER NOT NULL DEFAULT 1');
  }
  if (!hasColumn('servers', 'alert_cpu_pct')) {
    db.exec('ALTER TABLE servers ADD COLUMN alert_cpu_pct REAL NOT NULL DEFAULT 90');
  }
  if (!hasColumn('servers', 'alert_mem_pct')) {
    db.exec('ALTER TABLE servers ADD COLUMN alert_mem_pct REAL NOT NULL DEFAULT 90');
  }
  if (!hasColumn('servers', 'alert_temp_c')) {
    db.exec('ALTER TABLE servers ADD COLUMN alert_temp_c REAL NOT NULL DEFAULT 80');
  }
  if (!hasColumn('alerts', 'server_id')) {
    db.exec('ALTER TABLE alerts ADD COLUMN server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_alerts_server_status ON alerts(server_id, status)');
}

function applyServerMonitoringMigration() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      name                TEXT NOT NULL,
      os_hostname         TEXT NOT NULL DEFAULT '',
      os_ip               TEXT NOT NULL DEFAULT '',
      vendor              TEXT NOT NULL DEFAULT 'Supermicro',
      model               TEXT NOT NULL DEFAULT '',
      serial              TEXT NOT NULL DEFAULT '',
      location            TEXT NOT NULL DEFAULT '',
      rack                TEXT NOT NULL DEFAULT '',
      enabled             INTEGER NOT NULL DEFAULT 1,
      agent_key_hash      TEXT,
      agent_key_prefix    TEXT NOT NULL DEFAULT '',
      agent_registered_at INTEGER,
      bmc_ip              TEXT NOT NULL DEFAULT '',
      bmc_protocol        TEXT NOT NULL DEFAULT 'redfish', -- redfish | ipmi | demo | none
      bmc_username_enc    TEXT NOT NULL DEFAULT '',
      bmc_password_enc    TEXT NOT NULL DEFAULT '',
      bmc_verify_tls      INTEGER NOT NULL DEFAULT 1,
      bmc_ca_pem          TEXT NOT NULL DEFAULT '',
      bmc_system_id       TEXT NOT NULL DEFAULT '1',
      bmc_chassis_id      TEXT NOT NULL DEFAULT '1',
      poll_interval_sec   INTEGER NOT NULL DEFAULT 60,
      last_poll_at        INTEGER,
      last_poll_ok        INTEGER,
      last_poll_error     TEXT NOT NULL DEFAULT '',
      last_agent_at       INTEGER,
      last_agent_error    TEXT NOT NULL DEFAULT '',
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_servers_agent_key ON servers(agent_key_hash) WHERE agent_key_hash IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_servers_enabled ON servers(enabled);

    CREATE TABLE IF NOT EXISTS server_metrics (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id      INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      ts             INTEGER NOT NULL,
      source         TEXT NOT NULL DEFAULT 'agent', -- agent | redfish | ipmi | demo
      cpu_pct        REAL,
      mem_total_bytes INTEGER,
      mem_used_bytes INTEGER,
      mem_pct        REAL,
      disk_total_bytes INTEGER,
      disk_used_bytes  INTEGER,
      disk_max_pct   REAL,
      net_rx_bps     REAL,
      net_tx_bps     REAL,
      net_rx_errors  INTEGER,
      net_tx_errors  INTEGER,
      max_temp_c     REAL,
      power_watts    REAL,
      uptime_sec     INTEGER,
      health         TEXT NOT NULL DEFAULT 'unknown', -- ok | warning | critical | unknown
      raw_json       TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_server_metrics_server_ts ON server_metrics(server_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_server_metrics_ts ON server_metrics(ts);
    CREATE INDEX IF NOT EXISTS idx_server_metrics_source_ts ON server_metrics(server_id, source, ts DESC);

    CREATE TABLE IF NOT EXISTS server_inventory (
      server_id        INTEGER PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
      manufacturer     TEXT NOT NULL DEFAULT '',
      model            TEXT NOT NULL DEFAULT '',
      serial           TEXT NOT NULL DEFAULT '',
      bios_version     TEXT NOT NULL DEFAULT '',
      bmc_firmware     TEXT NOT NULL DEFAULT '',
      cpu_model        TEXT NOT NULL DEFAULT '',
      cpu_cores        INTEGER,
      cpu_threads      INTEGER,
      memory_total_bytes INTEGER,
      dimm_count       INTEGER,
      psu_count        INTEGER,
      os_name          TEXT NOT NULL DEFAULT '',
      os_version       TEXT NOT NULL DEFAULT '',
      raw_json         TEXT NOT NULL DEFAULT '{}',
      updated_at       INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS server_disks (
      server_id      INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      disk_key       TEXT NOT NULL,
      source         TEXT NOT NULL DEFAULT 'agent',
      kind           TEXT NOT NULL DEFAULT 'volume', -- volume | physical
      name           TEXT NOT NULL DEFAULT '',
      mount          TEXT NOT NULL DEFAULT '',
      filesystem     TEXT NOT NULL DEFAULT '',
      total_bytes    INTEGER,
      free_bytes     INTEGER,
      used_pct       REAL,
      health         TEXT NOT NULL DEFAULT 'unknown',
      temperature_c  REAL,
      wear_pct       REAL,
      read_errors    INTEGER,
      write_errors   INTEGER,
      power_on_hours INTEGER,
      updated_at     INTEGER NOT NULL,
      PRIMARY KEY (server_id, disk_key)
    );
    CREATE INDEX IF NOT EXISTS idx_server_disks_server ON server_disks(server_id);

    CREATE TABLE IF NOT EXISTS server_nics (
      server_id   INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      nic_key     TEXT NOT NULL,
      source      TEXT NOT NULL DEFAULT 'agent',
      name        TEXT NOT NULL DEFAULT '',
      mac         TEXT NOT NULL DEFAULT '',
      speed_bps   REAL,
      rx_bps      REAL,
      tx_bps      REAL,
      rx_errors   INTEGER,
      tx_errors   INTEGER,
      link_status TEXT NOT NULL DEFAULT 'unknown',
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (server_id, nic_key)
    );
    CREATE INDEX IF NOT EXISTS idx_server_nics_server ON server_nics(server_id);

    CREATE TABLE IF NOT EXISTS server_sensors (
      server_id      INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      sensor_key     TEXT NOT NULL,
      source         TEXT NOT NULL DEFAULT 'redfish', -- redfish | ipmi
      name           TEXT NOT NULL DEFAULT '',
      sensor_type    TEXT NOT NULL DEFAULT 'other', -- temperature | fan | voltage | power | other
      reading        REAL,
      unit           TEXT NOT NULL DEFAULT '',
      status         TEXT NOT NULL DEFAULT 'unknown',
      upper_critical REAL,
      upper_caution  REAL,
      lower_caution  REAL,
      lower_critical REAL,
      updated_at     INTEGER NOT NULL,
      PRIMARY KEY (server_id, sensor_key)
    );
    CREATE INDEX IF NOT EXISTS idx_server_sensors_server ON server_sensors(server_id);
  `);
}

/**
 * گام ۲۳: ایندکس معکوس تگ‌ها.
 *
 * کلید اصلی `device_tags(device_id, tag_id)` پرس‌وجوهای «تجهیزات یک تگ» را
 * پوشش نمی‌دهد؛ شمارش همبسته در فهرست تگ‌ها برای هر تگ یک SCAN کامل بود.
 * این ایندکس همان پرس‌وجو و `EXISTS` فیلتر تگ را به SEARCH تبدیل می‌کند.
 */
function applyDeviceTagReverseIndexMigration() {
  db.exec('CREATE INDEX IF NOT EXISTS idx_device_tags_tag ON device_tags(tag_id, device_id)');
}

/**
 * گام ۲۰: ایستگاه.
 *
 * تجهیزاتی که در یک مکان جغرافیایی مشترک قرار دارند در یک «ایستگاه» زیرمجموعهٔ
 * گروه جمع می‌شوند تا روی نقشه یک نشانگر (با فهرست تجهیزاتش) داشته باشند.
 * هر تجهیز حداکثر عضو یک ایستگاه است؛ `site_id` با حذف ایستگاه خالی می‌شود.
 */
function applySitesMigration() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      group_id   INTEGER REFERENCES groups(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sites_group ON sites(group_id);
  `);
  if (!hasColumn('devices', 'site_id')) {
    db.exec('ALTER TABLE devices ADD COLUMN site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_devices_site ON devices(site_id)');
}

/**
 * گام ۱۹: اعتبارنامهٔ دسترسی تجهیز (نام کاربری و رمز عبور).
 *
 * هر دو مقدار با AES-256-GCM رمزنگاری می‌شوند و فقط رشتهٔ رمزشده در ستون‌ها
 * می‌ماند. نمایش نام کاربری از مسیر سریالایز و رمز عبور فقط با درخواست صریح
 * و مجوز `devices:write` رمزگشایی می‌شود.
 */
function applyDeviceCredentialsMigration() {
  if (!hasColumn('devices', 'access_username_enc')) {
    db.exec("ALTER TABLE devices ADD COLUMN access_username_enc TEXT NOT NULL DEFAULT ''");
  }
  if (!hasColumn('devices', 'access_password_enc')) {
    db.exec("ALTER TABLE devices ADD COLUMN access_password_enc TEXT NOT NULL DEFAULT ''");
  }
}

/**
 * گام ۱۸: هویت فیزیکی تجهیز و فهرست انواع تجهیز.
 *
 * • `mac_address` و `asset_tag` (پلاک اموال) به مشخصات تجهیز اضافه می‌شوند؛
 *   هر دو متنی و اختیاری‌اند و در جست‌وجو/خروجی هم می‌آیند.
 * • `device_types` فهرست مرجع انواع تجهیز است تا مدیر بتواند نوع تازه بسازد؛
 *   مقدار نوع روی خود تجهیز همچنان متن است تا دادهٔ قبلی دست‌نخورده بماند.
 *   انواع موجود از همان ردیف‌های تجهیزات و فهرست پیش‌فرض پر می‌شوند.
 */
function applyDeviceIdentityMigration() {
  if (!hasColumn('devices', 'mac_address')) {
    db.exec("ALTER TABLE devices ADD COLUMN mac_address TEXT NOT NULL DEFAULT ''");
  }
  if (!hasColumn('devices', 'asset_tag')) {
    db.exec("ALTER TABLE devices ADD COLUMN asset_tag TEXT NOT NULL DEFAULT ''");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_types (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      color      TEXT NOT NULL DEFAULT '#2563eb',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_devices_asset_tag ON devices(asset_tag);
    CREATE INDEX IF NOT EXISTS idx_devices_mac ON devices(mac_address);
  `);
  const seed = db.prepare('INSERT OR IGNORE INTO device_types(name, color, created_at) VALUES (?,?,?)');
  const now = Date.now();
  for (const name of ['روتر', 'سوئیچ', 'فایروال', 'سرور', 'دوربین IP', 'اکسس‌پوینت', 'UPS شبکه', 'مودم', 'NVR', 'کنترلر', 'سایر']) {
    seed.run(name, '#2563eb', now);
  }
  for (const row of db.prepare("SELECT DISTINCT TRIM(device_type) AS name FROM devices WHERE device_type IS NOT NULL AND TRIM(device_type) <> ''").all()) {
    seed.run(row.name, '#2563eb', now);
  }
}

/**
 * گام ۱۷: پیوست دیاگرام (لوگو، نقشهٔ طبقه، عکس رک).
 *
 * تصویرهای روی بوم دیاگرام از همان سامانهٔ پیوست‌ها ذخیره می‌شوند؛ فقط مالک
 * فایل به‌جای تجهیز، یک دیاگرام است. حذف دیاگرام ردیف‌های آن را Cascade می‌کند
 * و فایل بی‌استفاده در Sweep بعدی پاک می‌شود.
 */
function applyDiagramAttachmentsMigration() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS diagram_attachments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      diagram_id   INTEGER NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
      file_name    TEXT NOT NULL,
      stored_name  TEXT NOT NULL,
      mime         TEXT NOT NULL,
      size_bytes   INTEGER NOT NULL DEFAULT 0,
      kind         TEXT NOT NULL DEFAULT 'image',
      uploaded_by  TEXT NOT NULL DEFAULT '',
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_diagram_attachments_diagram ON diagram_attachments(diagram_id);
  `);
}

/**
 * گام ۱۶: حذف کامل ماژول «کشف شبکه».
 *
 * نتایج اسکن عمر کوتاهی دارند و محدوده‌ها هم پیکربندی همان ماژول بودند؛ با
 * حذف قابلیت، جدول‌ها و کلیدهای تنظیمات آن هم پاک می‌شوند تا داده‌ای یتیم و
 * بی‌استفاده در پایگاه‌داده نماند. هیچ جدول دیگری وابسته به آن‌ها نیست.
 */
function applyDiscoveryRemovalMigration() {
  db.exec(`
    DROP TABLE IF EXISTS discovery_results;
    DROP TABLE IF EXISTS discovery_ranges;
    DELETE FROM settings WHERE key GLOB 'discovery_*';
  `);
}

/**
 * گام ۱۳: سقف حجم هر پیوست از ۵/۲۰ مگابایت به ۵۰ مگابایت افزایش می‌یابد.
 * مقدار قبلی در پایگاه‌داده‌های موجود (۵) بدون تغییر، سقف واقعی را پایین نگه
 * می‌داشت؛ این گام فقط مقادیر کمتر از ۵۰ را بالا می‌برد.
 */
function applyAttachmentLimitMigration() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'attachment_max_mb'").get();
  if (!row) return;
  let current;
  try {
    current = Number(JSON.parse(row.value));
  } catch {
    current = Number(row.value);
  }
  if (!Number.isFinite(current) || current < 50) {
    db.prepare("INSERT INTO settings(key, value) VALUES ('attachment_max_mb', '50') ON CONFLICT(key) DO UPDATE SET value = '50'").run();
  }
}

/**
 * گام ۱۲: تفکیک دسترسی شبکه از سلامت سرویس.
 *
 * وضعیت `devices.status` فقط بر مبنای دسترسی شبکه (ICMP یا پاسخ TCP) تعیین
 * می‌شود؛ ستون‌های service_* نتیجهٔ سنجش سرویس روی یک پورت مشخص را جدا نگه
 * می‌دارند تا «پورت بسته» با «میزبان قطع» اشتباه نشود.
 */
function applyServiceAvailabilityMigration() {
  if (!hasColumn('devices', 'service_status')) {
    db.exec("ALTER TABLE devices ADD COLUMN service_status TEXT NOT NULL DEFAULT 'unknown'");
  }
  if (!hasColumn('devices', 'service_port')) {
    db.exec('ALTER TABLE devices ADD COLUMN service_port INTEGER');
  }
  if (!hasColumn('devices', 'service_checked_at')) {
    db.exec('ALTER TABLE devices ADD COLUMN service_checked_at INTEGER');
  }
}

/**
 * اجرای یک گام مهاجرت در یک تراکنش.
 *
 * ثبت در `schema_migrations`، تغییر `PRAGMA user_version` و خود تغییر ساختار در
 * همان تراکنش انجام می‌شوند؛ اگر هر بخشی شکست بخورد کل گام (شامل DDL و داده)
 * برمی‌گردد و نسخهٔ ثبت‌شده روی آخرین گام موفق می‌ماند (BUG-24). جدا بودن این
 * تابع از `runMigrations` امکان آزمون سناریوی شکست در میانهٔ مهاجرت را می‌دهد.
 */
function applyMigrationStep(step) {
  const version = Number(step?.version);
  if (!Number.isInteger(version) || version < 1) {
    throw new DbError(DB_ERROR_CODES.MIGRATION_FAILED, `شمارهٔ گام مهاجرت نامعتبر است: ${step?.version}`, {
      status: 500,
    });
  }
  const name = String(step?.name || `migration-${version}`).slice(0, 120);
  const startedAt = Date.now();
  try {
    db.transaction(
      () => {
        step.up();
        db.prepare('INSERT OR IGNORE INTO schema_migrations(version, name, applied_at, duration_ms) VALUES (?,?,?,?)').run(
          version,
          name,
          startedAt,
          Date.now() - startedAt
        );
        db.exec('PRAGMA user_version = ' + version);
      },
      { label: `migration.v${version}` }
    );
    logEvent('info', 'db_migration_applied', {
      version,
      name,
      durationMs: Date.now() - startedAt,
    });
    return true;
  } catch (e) {
    throw new DbError(
      DB_ERROR_CODES.MIGRATION_FAILED,
      `مهاجرت ساختار داده به نسخهٔ ${version} (${name}) ناموفق بود و کل گام برگشت داده شد: ${e.message}`,
      { status: 500, detail: { version, name } }
    );
  }
}

/**
 * اجرای گام‌های مهاجرت تا SCHEMA_VERSION.
 * پایگاه‌دادهٔ موجود پیش از هر تغییر یک نسخهٔ فایلی می‌گیرد (backupBeforeMigration).
 */
function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0
    )
  `);
  const current = currentSchemaVersion();
  const record = db.prepare('INSERT OR IGNORE INTO schema_migrations(version, name, applied_at, duration_ms) VALUES (?,?,?,?)');
  // گام‌هایی که پیش‌تر (نسخه‌های قبلی برنامه) اعمال شده‌اند فقط ثبت می‌شوند.
  for (const m of MIGRATIONS) {
    if (m.version <= current) record.run(m.version, m.name, Date.now(), 0);
  }
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    applyMigrationStep(m);
  }
  // ترمیم idempotent: نسخه‌های میانی که گام ۳ را کامل‌تر ثبت کرده‌اند نباید
  // ستون تازهٔ توقف را کم داشته باشند.
  if (!hasColumn('retention_state', 'stop_requested')) {
    db.exec('ALTER TABLE retention_state ADD COLUMN stop_requested INTEGER NOT NULL DEFAULT 0');
  }
}


/**
 * به‌روزرسانی آمار برنامه‌ریز پرس‌وجو (ANALYZE تقریبی).
 *
 * بدون آمار، تجمیع بازهٔ گزارش‌ها روی `idx_samples_ts` می‌رود و برای گروه‌بندی
 * یک TEMP B-TREE از صدها هزار ردیف می‌سازد؛ با آمار، برنامه‌ریز
 * `idx_samples_device_ts` را انتخاب می‌کند که هم مرتب‌سازی نمی‌خواهد و هم
 * ۲۰ تا ۲۵ درصد سریع‌تر است (اندازه‌گیری: ۷۸۰ → ۵۴۵ms برای گزارش ۷ روزهٔ
 * ۵٬۰۰۰ تجهیز / ۷۲۰ هزار نمونه).
 *
 * `PRAGMA optimize` کافی نیست: تجربه نشان داد آن فقط جدول‌های بی‌آمار را
 * تحلیل می‌کند و آمار کهنه را تازه نمی‌کند. `analysis_limit` اما تحلیل را به
 * حداکثر ۴۰۰ ردیف به ازای هر ایندکس محدود می‌کند؛ روی جدول یک‌میلیون‌ردیفی
 * حدود ۱۵ms طول می‌کشد و شمار ردیف‌ها دقیق و آمار توزیع تقریبی می‌ماند.
 *
 * @returns {boolean} آیا آمار به‌روزرسانی شد
 */
function refreshQueryStats() {
  try {
    db.exec('PRAGMA analysis_limit = 400');
    db.exec('ANALYZE');
    return true;
  } catch (e) {
    // اشغال‌بودن پایگاه‌داده توسط موتور مانع تحلیل نمی‌شود؛ در اجراهای بعدی دوباره تلاش می‌شود.
    log('warn', `به‌روزرسانی آمار برنامه‌ریز پرس‌وجو ناموفق بود: ${e.message}`);
    return false;
  }
}


  function initializeMigrations() {
    const before = currentSchemaVersion();
    if (dbExisted && before < SCHEMA_VERSION) backupBeforeMigration(before);
    runMigrations();
    try {
      if (currentSchemaVersion() !== SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    } catch (e) {
      log('warn', `ثبت نسخهٔ ساختار داده ناموفق بود: ${e.message}`);
    }
  }

  return { applyMigrationStep, runMigrations, refreshQueryStats, initializeMigrations };
}
