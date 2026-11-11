/**
 * NetWatch — مسیرها، نسخه Schema و ثابت‌های عمومی لایه دیتابیس.
 */
import fs from 'node:fs';
import { config } from './config.js';

export const DATA_DIR = config.dataDir;
export const MBTILES_DIR = config.mbtilesDir;
export const DB_PATH = config.dbPath;

export const DB_EXISTED = (() => {
  try {
    return !String(DB_PATH).startsWith(':') && fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 0;
  } catch {
    return false;
  }
})();

export const SCHEMA_VERSION = 22;

const VALID_SYNC = new Set(['OFF', 'NORMAL', 'FULL', 'EXTRA']);
/**
 * synchronous=FULL در حالت WAL یعنی هر COMMIT پیش از پاسخ، به دیسک می‌رود؛
 * با NORMAL آخرین تراکنش‌ها در قطع برق/کرنل‌پنیک از دست می‌روند. برای سامانه‌ای
 * که سابقهٔ قطعی و تعمیراتش سند عملیاتی است، دوام تأییدشده اولویت دارد.
 * با NETWATCH_SQLITE_SYNC=NORMAL می‌توان برای نصب‌های پرنوشت به حالت سریع‌تر
 * برگشت (به‌صورت آگاهانه).
 */
export const SYNC_MODE = (() => {
  const raw = String(process.env.NETWATCH_SQLITE_SYNC || 'FULL').toUpperCase();
  return VALID_SYNC.has(raw) ? raw : 'FULL';
})();


export const STATUS = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  WARNING: 'warning',
  UNKNOWN: 'unknown',
  MAINTENANCE: 'maintenance',
};

export const DEFAULT_SETTINGS = {
  site_name: 'مرکز پایش شبکه',
  engine_enabled: true,
  // پیش‌فرض عملیاتی: «خودکار» یعنی پایش واقعی (ICMP و در صورت نبود مجوز، TCP).
  // شبیه‌سازی هرگز به‌صورت خودکار و پنهان اجرا نمی‌شود؛ برای دمو/آموزش باید
  // صریحاً انتخاب شود (تنظیمات یا NETWATCH_ENGINE_MODE=simulate).
  engine_mode: 'auto', // auto | icmp | tcp | simulate
  ping_interval: 30, // ثانیه — بازه پیش‌فرض ارسال Ping
  timeout_ms: 1200,
  retries: 1, // تعداد تلاش مجدد
  packet_count: 3, // تعداد packet در هر بررسی
  max_workers: 128, // همزمانی موتور مانیتورینگ
  latency_threshold: 150, // آستانه مجاز تأخیر (ms)
  loss_threshold: 10, // آستانه مجاز packet loss (٪)
  failures_for_offline: 3, // شکست متوالی برای تشخیص Offline
  successes_for_online: 2, // پاسخ موفق متوالی برای Recovery
  // مدت نگهداری رکوردهای خام. کلید قدیمی برای سازگاری حفظ شده است؛ سیاست
  // رسمی Phase 2 در کلیدهای samples_retention_days و… نگهداری می‌شود و
  // Settings UI همان‌ها را ویرایش می‌کند.
  retention_days: 90,
  // ---- Data Retention Policy (Phase 2) ----
  // همهٔ مقادیر از UI/API قابل تغییرند و در جدول settings ذخیره می‌شوند.
  retention_enabled: true,
  retention_run_time: '03:00', // زمان اجرای روزانه به وقت محلی (timezone_offset_minutes)
  retention_interval_minutes: 1440, // حداقل فاصلهٔ دو اجرای خودکار
  retention_batch_size: 5000, // رکورد در هر تراکنش
  retention_max_rows_per_run: 100000, // سقف کل رکوردهای هر اجرا (اجرای کوتاه و قابل توقف)
  samples_retention_days: 90,
  daily_stats_retention_days: 365,
  outages_retention_days: 365,
  alerts_retention_days: 180,
  engine_log_retention_days: 30,
  // الزام قانونی/قراردادی: با فعال‌بودن این پرچم هیچ حذفی انجام نمی‌شود تا مدیر
  // سیاست را آگاهانه تغییر دهد. سیاست مدیر همیشه بر پیش‌فرض‌ها مقدم است.
  retention_legal_hold: false,
  // Retention هرگز به‌طور پیش‌فرض فایل پشتیبان را حذف نمی‌کند؛ هرس پشتیبان
  // وظیفهٔ زمان‌بند پشتیبان با سیاست مستقل است.
  retention_prune_backups: false,
  chart_default_range: '1h', // بازه پیش‌فرض نمودارها
  tcp_port: 80,
  calendar: 'jalali',
  timezone_offset_minutes: 210, // Asia/Tehran
  alerting_enabled: true,
  alert_cooldown: 600,
  alert_delay: 0,
  suppression_enabled: false,
  suppression_start: '23:00',
  suppression_end: '06:00',
  notify_browser: true,
  repair_causes: [
    'مشکلات زیرساخت فیبر نوری',
    'مشکلات شبکه',
    'قطعی برق',
    'هنگ کردن سوئیچ',
    'سوختن یا خرابی تجهیز',
    'اختلال نرم‌افزاری',
    'نگهداری پیشگیرانه',
    'سایر',
  ],
  repair_actions: [
    'تعویض تجهیز',
    'تعمیر تجهیز',
    'تعویض قطعه',
    'اصلاح زیرساخت',
    'رفع مشکل شبکه',
    'به‌روزرسانی نرم‌افزار',
    'سایر',
  ],
  map_default_center: [35.6892, 51.389],
  map_default_zoom: 6,
  map_show_labels: true,
  // چیدمان ویجت‌های صفحه جزئیات تجهیز و داشبورد (خالی = چیدمان پیش‌فرض)
  device_detail_widgets: [],
  dashboard_widgets: [],
  // Probe و اسکن فعال فقط روی این محدوده‌ها مجاز است (پیش‌فرض: شبکه‌های خصوصی)
  // Link-Local (169.254/16، fe80::/10) و Cloud Metadata عمداً در پیش‌فرض
  // نیستند؛ فعال‌سازی آن‌ها نیازمند پرچم صریح مدیر است (سیاست در net-policy.js).
  probe_allowed_cidrs: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '::1/128', 'fc00::/7'],
  probe_allow_link_local: false,
  probe_allow_metadata: false,
  probe_allow_transition: false,
  // حداکثر حجم هر پیوست تجهیز (مگابایت) — نوع فایل هم فهرست سفید است.
  attachment_max_mb: 50,
  // نگهداری گزارش حسابرسی (روز) — حداقل ۳۶۵ روز طبق سیاست
  audit_retention_days: 365,
  // پشتیبان‌گیری خودکار و سیاست Checkpoint
  backup_enabled: true,
  backup_interval_hours: 24,
  backup_keep: 7, // سازگاری با نسخه‌های قبلی (سقف کل)
  backup_prune_enabled: true,
  backup_daily_keep: 7, // ۷ نسخهٔ روزانه
  backup_weekly_keep: 4, // ۴ نسخهٔ هفتگی (GFS)
  checkpoint_interval_minutes: 15,
};
