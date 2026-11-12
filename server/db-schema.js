/**
 * NetWatch — Schema پایه و idempotent نصب تازه.
 * هیچ تغییری در نام جدول/ستون/Index ایجاد نشده است.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- قفل رهبری موتور: فقط یک فرآیند در هر لحظه Ping می‌زند
CREATE TABLE IF NOT EXISTS engine_lock (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  owner      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Fencing Token: با هر انتقال مالکیت یک واحد افزایش می‌یابد. نتیجهٔ عملیاتی
  -- که epoch قدیمی دارد، پس از تغییر رهبری ثبت نمی‌شود.
  epoch      INTEGER NOT NULL DEFAULT 0
);

-- شمارندهٔ پایدار دورهٔ رهبری (Fencing Token). جدا از ردیف قفل نگه داشته
-- می‌شود تا حتی پس از حذف ردیف در خاموشی تمیز، شمارنده تکرار نشود.
CREATE TABLE IF NOT EXISTS engine_meta (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO engine_meta(key, value) VALUES ('leader_epoch', 0);

-- احراز هویت: رمز فقط به‌صورت هش Argon2id (و scrypt قدیمی برای مهاجرت)؛ نقش admin | operator | viewer
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',
  display_name  TEXT DEFAULT '',
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  -- Phase 3: قفل حساب پس از تلاش‌های ناموفق و زمان آخرین تغییر رمز
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until       INTEGER,
  password_changed_at INTEGER,
  -- مجوزهای اختصاصیِ قابل‌اعطا (JSON array)؛ نقش پایه را جایگزین نمی‌کند.
  extra_permissions  TEXT NOT NULL DEFAULT '[]'
);

-- نشست‌ها: توکن خام هرگز ذخیره نمی‌شود، فقط هش SHA-256 آن
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_hash    TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ip           TEXT DEFAULT '',
  user_agent   TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen_at);

-- گزارش حسابرسی: هر عملیات تغییردهنده و رویداد امنیتی. مقادیر حساس هرگز ذخیره نمی‌شوند.
CREATE TABLE IF NOT EXISTS audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             INTEGER NOT NULL,
  actor_id       INTEGER,
  actor_username TEXT NOT NULL DEFAULT '',
  actor_role     TEXT NOT NULL DEFAULT '',
  action         TEXT NOT NULL,
  target_type    TEXT DEFAULT '',
  target_id      TEXT DEFAULT '',
  method         TEXT DEFAULT '',
  path           TEXT DEFAULT '',
  ip             TEXT DEFAULT '',
  user_agent     TEXT DEFAULT '',
  status         INTEGER,
  success        INTEGER NOT NULL DEFAULT 1,
  details        TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_username);

CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  color       TEXT DEFAULT '#3b82f6',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,
  color        TEXT DEFAULT '#f59e0b',
  show_on_map  INTEGER NOT NULL DEFAULT 1,
  icon         TEXT DEFAULT 'tag',
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS map_layers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  kind          TEXT NOT NULL DEFAULT 'builtin', -- builtin | mbtiles | empty
  file_name     TEXT,
  min_zoom      INTEGER DEFAULT 0,
  max_zoom      INTEGER DEFAULT 19,
  attribution   TEXT DEFAULT '',
  visible       INTEGER NOT NULL DEFAULT 1,
  is_default    INTEGER NOT NULL DEFAULT 0,
  tile_count    INTEGER DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  group_id    INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sites_group ON sites(group_id);

CREATE TABLE IF NOT EXISTS devices (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  name                      TEXT NOT NULL,
  ip                        TEXT NOT NULL,
  hostname                  TEXT DEFAULT '',
  device_type               TEXT DEFAULT 'سوئیچ',
  group_id                  INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  site_id                   INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  location                  TEXT DEFAULT '',
  building                  TEXT DEFAULT '',
  rack                      TEXT DEFAULT '',
  latitude                  REAL,
  longitude                 REAL,
  map_layer_id              INTEGER REFERENCES map_layers(id) ON DELETE SET NULL,
  vendor                    TEXT DEFAULT '',
  model                     TEXT DEFAULT '',
  serial                    TEXT DEFAULT '',
  firmware                  TEXT DEFAULT '',
  owner                     TEXT DEFAULT '',
  notes                     TEXT DEFAULT '',
  priority                  TEXT NOT NULL DEFAULT 'normal', -- low | normal | high | critical
  enabled                   INTEGER NOT NULL DEFAULT 1,
  monitoring_enabled        INTEGER NOT NULL DEFAULT 1,
  ping_interval             INTEGER, -- خالی = استفاده از مقدار عمومی
  timeout_ms                INTEGER,
  packet_count              INTEGER,
  retries                   INTEGER,
  latency_threshold         REAL,
  loss_threshold            REAL,
  status                    TEXT NOT NULL DEFAULT 'unknown',
  status_reason             TEXT DEFAULT '',
  -- تفکیک دسترسی شبکه (status) از سلامت سرویس روی پورت سنجیده‌شده
  service_status            TEXT NOT NULL DEFAULT 'unknown', -- unknown | available | unavailable
  service_port              INTEGER,
  service_checked_at        INTEGER,
  last_check_at             INTEGER,
  last_status_change_at     INTEGER,
  last_rtt_ms               REAL,
  min_rtt_ms                REAL,
  max_rtt_ms                REAL,
  avg_rtt_ms                REAL,
  loss_pct                  REAL DEFAULT 0,
  success_count             INTEGER NOT NULL DEFAULT 0,
  fail_count                INTEGER NOT NULL DEFAULT 0,
  consecutive_failures      INTEGER NOT NULL DEFAULT 0,
  consecutive_successes     INTEGER NOT NULL DEFAULT 0,
  uptime_pct                REAL DEFAULT 100,
  total_checks              INTEGER NOT NULL DEFAULT 0,
  last_outage_at            INTEGER,
  current_outage_id         INTEGER,
  current_outage_started_at INTEGER,
  last_recovery_at          INTEGER,
  created_at                INTEGER NOT NULL,
  updated_at                INTEGER NOT NULL,
  next_check_at             INTEGER NOT NULL DEFAULT 0 -- زمان سررسید بررسی بعدی (0 = بی‌درنگ)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
CREATE INDEX IF NOT EXISTS idx_devices_group ON devices(group_id);

CREATE TABLE IF NOT EXISTS device_tags (
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (device_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_device_tags_tag ON device_tags(tag_id, device_id);

CREATE TABLE IF NOT EXISTS samples (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id     INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  ts            INTEGER NOT NULL,
  rtt_ms        REAL,
  packets_sent  INTEGER NOT NULL DEFAULT 1,
  packets_recv  INTEGER NOT NULL DEFAULT 0,
  loss_pct      REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL,
  ok            INTEGER NOT NULL DEFAULT 0,
  mode          TEXT DEFAULT 'simulate'
);
CREATE INDEX IF NOT EXISTS idx_samples_device_ts ON samples(device_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts DESC);

CREATE TABLE IF NOT EXISTS outages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  duration_sec INTEGER,
  cause       TEXT DEFAULT 'Ping Timeout',
  detail      TEXT DEFAULT '',
  lat         REAL,
  lng         REAL,
  open        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_outages_device ON outages(device_id, started_at DESC);

CREATE TABLE IF NOT EXISTS daily_stats (
  device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  day         TEXT NOT NULL, -- YYYY-MM-DD (UTC)
  checks      INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  avg_rtt     REAL,
  min_rtt     REAL,
  max_rtt     REAL,
  loss_pct    REAL,
  outages     INTEGER NOT NULL DEFAULT 0,
  downtime_sec INTEGER NOT NULL DEFAULT 0,
  uptime_pct  REAL,
  PRIMARY KEY (device_id, day)
);
CREATE INDEX IF NOT EXISTS idx_daily_day ON daily_stats(day);

CREATE TABLE IF NOT EXISTS alert_rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  metric          TEXT NOT NULL DEFAULT 'offline', -- offline | latency | loss | recovery
  comparator      TEXT NOT NULL DEFAULT 'gte',
  threshold       REAL DEFAULT 0,
  duration_sec    INTEGER DEFAULT 0, -- تأخیر قبل از ثبت هشدار
  severity        TEXT NOT NULL DEFAULT 'warning', -- info | warning | critical
  scope_group_id  INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  cooldown_sec    INTEGER DEFAULT 600,
  apply_to_unmon  INTEGER NOT NULL DEFAULT 0,
  silent          INTEGER NOT NULL DEFAULT 0, -- در بازه سکوت قرار بگیرد
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id     INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  rule_id       INTEGER REFERENCES alert_rules(id) ON DELETE SET NULL,
  severity      TEXT NOT NULL DEFAULT 'warning',
  kind          TEXT NOT NULL DEFAULT 'offline', -- offline | latency | loss | recovery | maintenance
  title         TEXT NOT NULL,
  message       TEXT DEFAULT '',
  value         REAL,
  created_at    INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active', -- active | acknowledged | resolved | suppressed
  acknowledged_at INTEGER,
  acknowledged_by TEXT,
  resolved_at   INTEGER,
  notified      INTEGER NOT NULL DEFAULT 0,
  duplicate_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);

CREATE TABLE IF NOT EXISTS maintenance_records (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  outage_id    INTEGER REFERENCES outages(id) ON DELETE SET NULL,
  title        TEXT DEFAULT '',
  cause        TEXT NOT NULL DEFAULT 'سایر', -- علت خرابی
  action       TEXT NOT NULL DEFAULT 'سایر', -- اقدام انجام‌شده
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  downtime_sec INTEGER DEFAULT 0,
  technician   TEXT DEFAULT '',
  cost         REAL DEFAULT 0,
  description  TEXT DEFAULT '',
  notes        TEXT DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'closed', -- open | closed
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_maint_device ON maintenance_records(device_id, started_at DESC);

CREATE TABLE IF NOT EXISTS maintenance_windows (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id    INTEGER REFERENCES devices(id) ON DELETE CASCADE, -- خالی = سراسری
  title        TEXT DEFAULT 'پنجره تعمیرات',
  days         TEXT DEFAULT '0,1,2,3,4,5,6',
  start_time   TEXT DEFAULT '01:00',
  end_time     TEXT DEFAULT '03:00',
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS engine_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,
  level      TEXT NOT NULL DEFAULT 'info',
  message    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_engine_log_ts ON engine_log(ts DESC);

-- انواع «علامت» روی نقشه (مثل «تجهیز در حال نصب») که کاربر تعریف می‌کند
CREATE TABLE IF NOT EXISTS marker_types (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  color       TEXT DEFAULT '#0ea5e9',
  icon        TEXT DEFAULT 'map-pin',
  description TEXT DEFAULT '',
  created_at  INTEGER NOT NULL
);

-- جانمایی علامت‌ها روی نقشه؛ هر علامت یک نام مشخص و مختصات جغرافیایی دارد
CREATE TABLE IF NOT EXISTS map_markers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type_id     INTEGER REFERENCES marker_types(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  latitude    REAL NOT NULL,
  longitude   REAL NOT NULL,
  notes       TEXT DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_map_markers_type ON map_markers(type_id);
`;
