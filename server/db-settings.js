/**
 * NetWatch — تنظیمات پیش‌فرض، اعتبارسنجی و ذخیره‌سازی.
 */
import { normalizeCidrList } from './net-policy.js';
import { DEFAULT_SETTINGS } from './db-constants.js';

export function createSettingsStore({ db, transaction, log }) {
/** درج تنظیمات پیش‌فرض غایب؛ پس از Restore هم فراخوانی می‌شود */
function ensureDefaultSettings() {
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  transaction(() => {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, JSON.stringify(v));
  }, { label: 'settings.defaults' });
}


/**
 * خواندن تنظیمات با اولویت: متغیر محیطی > پایگاه‌داده > مقدار پیش‌فرض.
 * متغیرهای محیطی برای استقرار (systemd/docker) هستند و در پایگاه‌داده ذخیره
 * نمی‌شوند؛ پس تغییرشان با ویرایش UI اثر ندارد و نیاز به راه‌اندازی مجدد دارد.
 */
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return { ...out, ...envSettings };
}

/* ------------------------------------------------------------------ */
/* اعتبارسنجی تنظیمات                                                  */
/* ------------------------------------------------------------------ */

// مقدارهای غیرمنطقی تنظیمات می‌توانند برنامه را از کار بیندازند: بازه منفی يا صفر
// باعث می‌شود موتور بدون وقفه Ping بزند، max_workers بزرگ تعداد هم‌زمانی را منفجر
// می‌کند و retention_days منفی همهٔ رکوردهای تاریخی را حذف می‌کند. پس همهٔ مقادیر
// ورودی در همین یک نقطه مرزگذاری می‌شوند.
const NUM_RANGES = {
  ping_interval: [5, 86400],
  timeout_ms: [100, 30000],
  retries: [0, 5],
  packet_count: [1, 10],
  max_workers: [1, 512],
  latency_threshold: [0, 60000],
  loss_threshold: [0, 100],
  failures_for_offline: [1, 50],
  successes_for_online: [1, 50],
  retention_days: [1, 3650],
  tcp_port: [1, 65535],
  timezone_offset_minutes: [-720, 840],
  alert_cooldown: [0, 604800],
  alert_delay: [0, 86400],
  map_default_zoom: [0, 22],
  // حدود پایین، الزامات سیاست را تضمین می‌کنند: حسابرسی و قطعی‌ها حداقل ۳۶۵ روز.
  audit_retention_days: [365, 36500],
  samples_retention_days: [1, 3650],
  daily_stats_retention_days: [365, 36500],
  outages_retention_days: [365, 36500],
  alerts_retention_days: [30, 3650],
  engine_log_retention_days: [7, 3650],
  retention_interval_minutes: [15, 10080],
  retention_batch_size: [100, 50000],
  retention_max_rows_per_run: [1000, 5000000],
  backup_interval_hours: [1, 168],
  backup_keep: [1, 60],
  backup_daily_keep: [1, 60],
  backup_weekly_keep: [0, 52],
  checkpoint_interval_minutes: [1, 1440],
};

const ENUMS = {
  engine_mode: ['auto', 'icmp', 'tcp', 'simulate'],
  chart_default_range: ['15m', '1h', '6h', '24h', '7d', '30d', '90d'],
  calendar: ['jalali', 'gregorian'],
};

const BOOLEAN_KEYS = [
  'engine_enabled',
  'alerting_enabled',
  'suppression_enabled',
  'notify_browser',
  'map_show_labels',
  'backup_enabled',
  'backup_prune_enabled',
  'retention_enabled',
  'retention_legal_hold',
  'retention_prune_backups',
  // دسترسی‌های حساس Probe فقط با تنظیم صریح مدیر (پیش‌فرض خاموش)
  'probe_allow_link_local',
  'probe_allow_metadata',
  'probe_allow_transition',
];

/* ------------------------------------------------------------------ */
/* پیکربندی از طریق متغیرهای محیطی                                     */
/* ------------------------------------------------------------------ */

const ENV_SETTINGS = {
  NETWATCH_PING_INTERVAL: 'ping_interval',
  NETWATCH_TIMEOUT_MS: 'timeout_ms',
  NETWATCH_MAX_WORKERS: 'max_workers',
  NETWATCH_RETRIES: 'retries',
  NETWATCH_PACKET_COUNT: 'packet_count',
  NETWATCH_RETENTION_DAYS: 'retention_days',
  NETWATCH_ENGINE_MODE: 'engine_mode',
  NETWATCH_TCP_PORT: 'tcp_port',
};

const envSettings = {};
for (const [envKey, setting] of Object.entries(ENV_SETTINGS)) {
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') continue;
  if (setting in ENUMS) {
    if (ENUMS[setting].includes(String(raw))) envSettings[setting] = String(raw);
    else console.error(`[config] مقدار ${envKey}=${raw} نامعتبر است و نادیده گرفته شد.`);
    continue;
  }
  const value = Number(String(raw).trim());
  const range = NUM_RANGES[setting];
  if (!Number.isFinite(value) || !range || value < range[0] || value > range[1]) {
    console.error(`[config] مقدار ${envKey}=${raw} نامعتبر است و نادیده گرفته شد.`);
    continue;
  }
  envSettings[setting] = value;
}
if (Object.keys(envSettings).length) {
  console.log(`[config] مقادیر ناشی از متغیر محیطی: ${Object.keys(envSettings).join(', ')}`);
}
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const WIDGET_KEYS = ['device_detail_widgets', 'dashboard_widgets'];
const WIDGET_SIZES = ['sm', 'md', 'lg', 'full'];
const WIDGET_HEIGHTS = ['sm', 'md', 'lg', 'xl'];
// ارتفاع پیکسلی ویجت با کشیدن لبهٔ پایین تغییر می‌کند؛ همان مرزها در کلاینت هم
// اعمال می‌شوند تا مقدار دستکاری‌شده نتواند ارتفاع صفر یا غیرمعقول بسازد.
const WIDGET_HEIGHT_PX_MIN = 180;
const WIDGET_HEIGHT_PX_MAX = 1400;

/** چیدمان ویجت‌ها را به شکل امن نرمال می‌کند: حداکثر ۴۰ ویجت، اندازهٔ مجاز و ترتیب عددی */
function cleanWidgets(value) {
  if (!Array.isArray(value)) return null;
  const out = value
    .slice(0, 40)
    .map((item, i) => {
      // height قدیمی برای سازگاری حفظ می‌شود، اما heightPx مرجع اصلی ارتفاع است.
      // undefined/خالی نباید به صفر تبدیل و به کف بازه چسبانده شود.
      const rawHeightPx = item?.heightPx;
      const heightPx =
        rawHeightPx == null || rawHeightPx === ''
          ? null
          : coerceNumber(rawHeightPx, [WIDGET_HEIGHT_PX_MIN, WIDGET_HEIGHT_PX_MAX]);
      return {
        id: String(item?.id ?? '').trim().slice(0, 48),
        visible: item?.visible === false || item?.visible === 0 || item?.visible === '0' ? 0 : 1,
        size: WIDGET_SIZES.includes(item?.size) ? item.size : 'md',
        height: WIDGET_HEIGHTS.includes(item?.height) ? item.height : 'sm',
        ...(heightPx == null ? {} : { heightPx: Math.round(heightPx) }),
        order: Number.isFinite(Number(item?.order)) ? Math.max(0, Math.min(999, Number(item.order))) : i,
      };
    })
    .filter((w) => w.id);
  return out.length || value.length === 0 ? out : null;
}

function cleanStringList(value, maxItems = 30, maxLen = 60) {
  if (!Array.isArray(value)) return null;
  const out = value
    .map((v) => String(v ?? '').trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
  return out.length ? out : null;
}

function coerceNumber(value, [min, max]) {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/**
 * تنظیمات رسیده از کلاینت را اعتبارسنجی و مرزگذاری می‌کند.
 * @returns {{ clean: object, rejected: string[] }}
 */
function sanitizeSettings(patch = {}) {
  const clean = {};
  const rejected = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    if (k in NUM_RANGES) {
      const n = coerceNumber(v, NUM_RANGES[k]);
      if (n == null) rejected.push(k);
      else clean[k] = n;
      continue;
    }
    if (k in ENUMS) {
      const s = String(v);
      if (ENUMS[k].includes(s)) clean[k] = s;
      else rejected.push(k);
      continue;
    }
    if (BOOLEAN_KEYS.includes(k)) {
      clean[k] = v === true || v === 1 || v === '1' || v === 'true';
      continue;
    }
    if (k === 'suppression_start' || k === 'suppression_end' || k === 'retention_run_time') {
      const s = String(v).trim();
      if (TIME_RE.test(s)) clean[k] = s;
      else rejected.push(k);
      continue;
    }
    if (k === 'probe_allowed_cidrs') {
      const list = normalizeCidrList(v);
      if (list && list.length) clean[k] = list;
      else rejected.push(k);
      continue;
    }
    if (k === 'site_name') {
      const s = String(v ?? '').trim().slice(0, 80);
      if (s) clean[k] = s;
      else rejected.push(k);
      continue;
    }
    if (k === 'repair_causes' || k === 'repair_actions') {
      const list = cleanStringList(v);
      if (list) clean[k] = list;
      else rejected.push(k);
      continue;
    }
    if (WIDGET_KEYS.includes(k)) {
      const widgets = cleanWidgets(v);
      if (widgets) clean[k] = widgets;
      else rejected.push(k);
      continue;
    }
    if (k === 'map_default_center') {
      const lat = Number(Array.isArray(v) ? v[0] : NaN);
      const lng = Number(Array.isArray(v) ? v[1] : NaN);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        clean[k] = [Number(lat.toFixed(5)), Number(lng.toFixed(5))];
      } else rejected.push(k);
      continue;
    }
    clean[k] = v;
  }
  return { clean, rejected };
}

function setSettings(patch = {}) {
  const { clean, rejected } = sanitizeSettings(patch);
  if (rejected.length) log('warn', `مقدار نامعتبر برای تنظیمات نادیده گرفته شد: ${rejected.join(', ')}`);
  const stmt = db.prepare(
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  // همهٔ کلیدها با هم یا هیچ‌کدام؛ تنظیم نیمه‌اعمال‌شده می‌تواند موتور را در
  // وضعیت ناسازگار (مثلاً بازهٔ صفر + آستانهٔ جدید) رها کند.
  transaction(() => {
    for (const [k, v] of Object.entries(clean)) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      stmt.run(k, JSON.stringify(v));
    }
  }, { label: 'settings.save' });
  return getSettings();
}


  return { ensureDefaultSettings, getSettings, sanitizeSettings, setSettings };
}
