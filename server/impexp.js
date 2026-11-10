/**
 * NetWatch — ورود و خروج اطلاعات (Excel / CSV)
 * ----------------------------------------------------------------
 * کاملاً محلی؛ از کتابخانه SheetJS استفاده می‌کند و هیچ ارتباطی با اینترنت ندارد.
 */
import * as XLSX from 'xlsx';
import { isValidIp } from './ping.js';
import { assertSpreadsheetContent } from './file-guard.js';

/** نگاشت سرستون‌های فارسی/انگلیسی به فیلدهای داخلی */
const COLUMN_MAP = {
  name: 'name',
  نام: 'name',
  'نام تجهیز': 'name',
  'نام دستگاه': 'name',
  ip: 'ip',
  'آدرس ip': 'ip',
  'آدرس آیپی': 'ip',
  address: 'ip',
  hostname: 'hostname',
  'نام هاست': 'hostname',
  type: 'device_type',
  'نوع': 'device_type',
  'نوع تجهیز': 'device_type',
  'نوع دستگاه': 'device_type',
  device_type: 'device_type',
  group: 'group',
  'گروه': 'group',
  'دسته': 'group',
  'دستهبندی': 'group',
  location: 'location',
  'موقعیت': 'location',
  'محل استقرار': 'location',
  'محل': 'location',
  building: 'building',
  'ساختمان': 'building',
  rack: 'rack',
  'رک': 'rack',
  latitude: 'latitude',
  lat: 'latitude',
  'عرض جغرافیایی': 'latitude',
  longitude: 'longitude',
  lng: 'longitude',
  lon: 'longitude',
  'طول جغرافیایی': 'longitude',
  vendor: 'vendor',
  'سازنده': 'vendor',
  'برند': 'vendor',
  model: 'model',
  'مدل': 'model',
  serial: 'serial',
  'سریال': 'serial',
  owner: 'owner',
  'مسئول': 'owner',
  'مالک': 'owner',
  priority: 'priority',
  'اولویت': 'priority',
  notes: 'notes',
  'توضیحات': 'notes',
  tags: 'tags',
  'تگ': 'tags',
  'تگها': 'tags',
  enabled: 'enabled',
  'فعال': 'enabled',
  monitoring: 'monitoring_enabled',
  'مانیتورینگ': 'monitoring_enabled',
  'مانیتورینگ فعال': 'monitoring_enabled',
  'برچسب': 'tags',
  'برچسب‌ها': 'tags',
  'برچسب ها': 'tags',
  'تگ های تجهیز': 'tags',
  serial_number: 'serial',
  'شماره سریال': 'serial',
  'mac address': 'mac_address',
  mac: 'mac_address',
  'mac_address': 'mac_address',
  'آدرس mac': 'mac_address',
  'آدرس مک': 'mac_address',
  'مک آدرس': 'mac_address',
  'asset tag': 'asset_tag',
  'asset_tag': 'asset_tag',
  asset: 'asset_tag',
  'پلاک': 'asset_tag',
  'پلاک اموال': 'asset_tag',
  'شماره اموال': 'asset_tag',
  'کد اموال': 'asset_tag',
  ping_interval: 'ping_interval',
  'بازه ping': 'ping_interval',
  'بازه بررسی': 'ping_interval',
  timeout_ms: 'timeout_ms',
  'زمان انتظار': 'timeout_ms',
  'زمان انتظار پاسخ': 'timeout_ms',
};

export const EXPORT_HEADERS = [
  ['name', 'نام تجهیز'],
  ['ip', 'آدرس IP'],
  ['hostname', 'نام هاست'],
  ['device_type', 'نوع تجهیز'],
  ['group', 'گروه'],
  ['location', 'محل استقرار'],
  ['building', 'ساختمان'],
  ['rack', 'رک'],
  ['latitude', 'عرض جغرافیایی'],
  ['longitude', 'طول جغرافیایی'],
  ['vendor', 'سازنده'],
  ['model', 'مدل'],
  ['serial', 'سریال'],
  ['mac_address', 'آدرس MAC'],
  ['asset_tag', 'پلاک اموال'],
  ['owner', 'مسئول'],
  ['priority', 'اولویت'],
  ['ping_interval', 'بازه بررسی (ثانیه)'],
  ['timeout_ms', 'زمان انتظار (میلی‌ثانیه)'],
  ['tags', 'تگ‌ها'],
  ['enabled', 'فعال'],
  ['monitoring_enabled', 'مانیتورینگ فعال'],
  ['notes', 'توضیحات'],
  ['status', 'وضعیت'],
  ['last_rtt_ms', 'آخرین تأخیر (ms)'],
  ['uptime_pct', 'دسترس‌پذیری (٪)'],
  ['loss_pct', 'افت بسته (٪)'],
];

function foldKey(key) {
  return String(key ?? '')
    .replace(/\u200c/g, ' ')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * کلید مقایسه‌ای سرستون؛ چیزهایی که نویسندهٔ فایل ممکن است متفاوت بنویسد
 * یکسان می‌شوند تا سرستون‌های خودِ خروجی/قالب هم دوباره قابل ورود باشند:
 *   • نیم‌فاصله (ZWNJ) که foldKey به فاصله تبدیل می‌کند
 *   • یکای داخل پرانتز در انتها: «بازه بررسی (ثانیه)» ≡ «بازه بررسی»
 *   • فاصله، زیرخط، نقطه و خط تیره: «MAC Address» ≡ «mac_address»
 * پیش‌تر کلیدهای COLUMN_MAP نرمال نمی‌شدند و سرستون «تگ‌ها» (که خروجی خود
 * برنامه است) به `تگ_ها` تبدیل می‌شد؛ نتیجه این بود که تگ‌های فایل Excel در
 * ورود گروهی نادیده گرفته می‌شدند.
 */
function lookupKey(key) {
  return foldKey(key)
    .replace(/\s*[([{][^)\]}]*[)\]}]?\s*$/g, '')
    .replace(/[\s_.-]+/g, '');
}

const COLUMN_LOOKUP = new Map(Object.entries(COLUMN_MAP).map(([k, v]) => [lookupKey(k), v]));

/** نگاشت سرستون به فیلد داخلی؛ کلیدهای ناشناخته به snake_case تبدیل می‌شوند. */
export function normalizeKey(key) {
  const k = lookupKey(key);
  return COLUMN_LOOKUP.get(k) || foldKey(key).replace(/\s+/g, '_');
}

/** نگاشت سرستون‌های فایل علامت‌های نقشه (نام، نوع، مختصات) */
const MARKER_COLUMN_MAP = {
  name: 'name',
  'نام': 'name',
  'نام علامت': 'name',
  'نام نشان': 'name',
  'نام نشانه': 'name',
  'عنوان': 'name',
  title: 'name',
  type: 'type',
  'نوع': 'type',
  'نوع علامت': 'type',
  'نوع نشان': 'type',
  'دسته': 'type',
  latitude: 'latitude',
  lat: 'latitude',
  'عرض جغرافیایی': 'latitude',
  'عرض': 'latitude',
  longitude: 'longitude',
  lng: 'longitude',
  lon: 'longitude',
  'طول جغرافیایی': 'longitude',
  'طول': 'longitude',
  notes: 'notes',
  'توضیحات': 'notes',
  'یادداشت': 'notes',
  color: 'color',
  'رنگ': 'color',
  icon: 'icon',
  'آیکون': 'icon',
};

const MARKER_LOOKUP = new Map(Object.entries(MARKER_COLUMN_MAP).map(([k, v]) => [lookupKey(k), v]));

export function normalizeMarkerKey(key) {
  const k = lookupKey(key);
  return MARKER_LOOKUP.get(k) || foldKey(key).replace(/\s+/g, '_');
}

export const MARKER_EXPORT_HEADERS = [
  ['name', 'نام علامت'],
  ['type', 'نوع علامت'],
  ['latitude', 'عرض جغرافیایی'],
  ['longitude', 'طول جغرافیایی'],
  ['notes', 'توضیحات'],
];

// سقف تعداد ردیف‌های ورودی: هر ردیف به یک شیء جداگانه تبدیل و اعتبارسنجی می‌شود؛
// فایل‌های ناخواسته (مثلاً CSV چند صد هزار سطری) حافظهٔ سرور را تمام می‌کنند.
const IMPORT_ROWS_ENV = Number(process.env.NETWATCH_MAX_IMPORT_ROWS);
export const MAX_IMPORT_ROWS =
  Number.isFinite(IMPORT_ROWS_ENV) && IMPORT_ROWS_ENV >= 100 && IMPORT_ROWS_ENV <= 200000
    ? Math.floor(IMPORT_ROWS_ENV)
    : 50000;
// سقف ستون‌ها: یک CSV چند مگابایتی با میلیون‌ها ویرگول می‌تواند آرایهٔ عظیم
// بسازد، در حالی که تعداد ردیف کم است. فایل واقعی تجهیزات به‌ندرت از ۲۰۰ ستون
// بیشتر می‌شود.
export const MAX_IMPORT_COLUMNS = 200;

/**
 * جلوگیری از CSV Formula Injection: اگر متن با یکی از نویسه‌های شروع فرمول
 * (=، +، -، @، tab، CR) آغاز شود، با یک آپاستروف پیشوند می‌شود تا Excel/Sheets
 * آن را فرمول اجرا نکند. عددهای واقعی دست‌نخورده می‌مانند.
 */
export function sanitizeSpreadsheetValue(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function parseBuffer(buffer, filename = '', keyFn = normalizeKey) {
  // ۱) محتوای واقعی فایل ملاک است، نه پسوند/MIME. بررسی ZIP Bomb و مسیر داخلی
  //    آرشیو هم همین‌جا انجام می‌شود تا SheetJS هرگز آرشیو مشکوک را باز نکند.
  assertSpreadsheetContent(buffer, filename, { maxRows: MAX_IMPORT_ROWS, maxColumns: MAX_IMPORT_COLUMNS });
  // ۲) پارس؛ خطای کتابخانه به خطای ۴۰۰ کاربر تبدیل می‌شود و هرگز ۵۰۰/کرش نمی‌دهد.
  // ورودی CSV به‌صورت صریح UTF-8 رمزگشایی می‌شود: SheetJS بدون BOM، متن فارسی را
  // با یک کدگذاری تک‌بایتی می‌خواند و سرستون‌ها به‌هم‌ریخته می‌شوند. فایل CSV
  // ذخیره‌شده با Excel یا ویرایشگرهای متن معمولاً BOM ندارد.
  // (گزینهٔ `codepage` در نسخهٔ رسمی SheetJS جدول‌های کدگذاری را همراه ندارد.)
  let wb;
  try {
    wb = /\.csv$/i.test(String(filename || ''))
      ? XLSX.read(new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, ''), { type: 'string' })
      : XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    const error = new Error('فایل صفحه‌گسترده قابل خواندن نیست؛ فایل خراب یا با قالب نادرست است.');
    error.status = 400;
    error.code = 'BAD_FILE_CONTENT';
    throw error;
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
  if (!matrix.length) return { headers: [], rows: [] };
  if ((matrix[0]?.length || 0) > MAX_IMPORT_COLUMNS) {
    const error = new Error(`تعداد ستون‌های فایل (${matrix[0].length}) بیش از حد مجاز است؛ حداکثر ${MAX_IMPORT_COLUMNS} ستون پشتیبانی می‌شود.`);
    error.status = 400;
    error.code = 'BAD_FILE_CONTENT';
    throw error;
  }
  if (matrix.length - 1 > MAX_IMPORT_ROWS) {
    const error = new Error(`تعداد ردیف‌های فایل (${matrix.length - 1}) بیش از حد مجاز است؛ حداکثر ${MAX_IMPORT_ROWS} ردیف در هر بار ورود پشتیبانی می‌شود.`);
    error.status = 400;
    error.code = 'BAD_FILE_CONTENT';
    throw error;
  }
  const rawHeaders = matrix[0].map((h) => String(h ?? '').trim());
  const keys = rawHeaders.map(keyFn);
  const rows = [];
  for (let i = 1; i < matrix.length; i++) {
    const arr = matrix[i];
    if (!arr || arr.every((c) => String(c ?? '').trim() === '')) continue;
    const obj = { __row: i + 1 };
    keys.forEach((k, idx) => {
      if (!k) return;
      let v = arr[idx];
      if (v instanceof Date) v = v.toISOString();
      obj[k] = typeof v === 'string' ? v.trim() : v;
    });
    rows.push(obj);
  }
  return { headers: rawHeaders, keys, rows, sheetName };
}

export function toBool(v, fallback = 1) {
  if (v === '' || v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on', 'فعال', 'بله', 'آری', 'دارد'].includes(s)) return 1;
  if (['0', 'false', 'no', 'n', 'off', 'غیرفعال', 'خیر', 'ندارد'].includes(s)) return 0;
  return fallback;
}

const PRIORITIES = ['low', 'normal', 'high', 'critical'];
const PRIORITY_FA = { 'کم': 'low', 'عادی': 'normal', 'متوسط': 'normal', 'بالا': 'high', 'بحرانی': 'critical', 'حیاتی': 'critical' };

/** آدرس MAC را به قالب `AA:BB:CC:DD:EE:FF` تبدیل می‌کند (مقدار نامعتبر خالی می‌شود). */
function normalizeMacValue(value) {
  const hex = String(value ?? '').replace(/[\s:.-]/g, '').toLowerCase();
  return /^[0-9a-f]{12}$/.test(hex) ? hex.toUpperCase().match(/.{2}/g).join(':') : '';
}

export function normalizePriority(v) {
  if (v == null || v === '') return 'normal';
  const s = String(v).trim().toLowerCase();
  if (PRIORITY_FA[s]) return PRIORITY_FA[s];
  return PRIORITIES.includes(s) ? s : 'normal';
}

/**
 * اعتبارسنجی ردیف‌های ورودی
 * @returns {{ valid: Array, errors: Array, duplicates: Array }}
 */
export function validateRows(rows, existing = []) {
  const byIp = new Map(existing.map((d) => [String(d.ip).trim(), d]));
  const seen = new Map();
  const valid = [];
  const errors = [];
  const duplicates = [];

  for (const r of rows) {
    const issues = [];
    const name = String(r.name ?? '').trim();
    const ip = String(r.ip ?? '').trim();
    if (!name) issues.push('نام تجهیز وارد نشده است');
    if (!ip) issues.push('آدرس IP وارد نشده است');
    else if (!isValidIp(ip)) issues.push(`آدرس IP نامعتبر: ${ip}`);
    if (ip && seen.has(ip)) issues.push(`IP تکراری در فایل (ردیف ${seen.get(ip)})`);
    if (ip && byIp.has(ip)) issues.push(`IP تکراری در سیستم — تجهیز «${byIp.get(ip).name}»`);

    const lat = r.latitude === '' || r.latitude == null ? null : Number(r.latitude);
    const lng = r.longitude === '' || r.longitude == null ? null : Number(r.longitude);
    if (lat != null && (Number.isNaN(lat) || lat < -90 || lat > 90)) issues.push('عرض جغرافیایی نامعتبر');
    if (lng != null && (Number.isNaN(lng) || lng < -180 || lng > 180)) issues.push('طول جغرافیایی نامعتبر');
    const rawMac = String(r.mac_address ?? '').trim();
    if (rawMac && !/^[0-9a-f]{12}$/.test(rawMac.replace(/[\s:.-]/g, '').toLowerCase())) {
      issues.push(`آدرس MAC نامعتبر: ${rawMac}`);
    }

    const record = {
      row: r.__row,
      name,
      ip,
      hostname: String(r.hostname ?? '').trim(),
      device_type: String(r.device_type ?? 'سوئیچ').trim() || 'سوئیچ',
      group: String(r.group ?? '').trim(),
      location: String(r.location ?? '').trim(),
      building: String(r.building ?? '').trim(),
      rack: String(r.rack ?? '').trim(),
      latitude: lat,
      longitude: lng,
      vendor: String(r.vendor ?? '').trim(),
      model: String(r.model ?? '').trim(),
      serial: String(r.serial ?? '').trim(),
      mac_address: normalizeMacValue(r.mac_address),
      asset_tag: String(r.asset_tag ?? '').trim(),
      owner: String(r.owner ?? '').trim(),
      priority: normalizePriority(r.priority),
      notes: String(r.notes ?? '').trim(),
      tags: String(r.tags ?? '')
        .split(/[,،;|]/)
        .map((t) => t.trim())
        .filter(Boolean),
      enabled: toBool(r.enabled, 1),
      monitoring_enabled: toBool(r.monitoring_enabled, 1),
      ping_interval: r.ping_interval === '' || r.ping_interval == null ? null : Number(r.ping_interval) || null,
      timeout_ms: r.timeout_ms === '' || r.timeout_ms == null ? null : Number(r.timeout_ms) || null,
    };

    if (ip && !seen.has(ip)) seen.set(ip, r.__row);
    if (issues.length) {
      errors.push({ ...record, issues });
      if (issues.some((x) => x.includes('تکراری'))) duplicates.push({ ...record, issues });
    } else {
      valid.push(record);
    }
  }
  return { valid, errors, duplicates };
}

export function buildWorkbook(rows, headers = EXPORT_HEADERS) {
  const keys = headers.map((h) => h[0]);
  const labels = headers.map((h) => h[1]);
  const data = rows.map((r) =>
    Object.fromEntries(
      labels.map((label, i) => [label, r[keys[i]] == null ? '' : sanitizeSpreadsheetValue(r[keys[i]])])
    )
  );
  const ws = XLSX.utils.json_to_sheet(data, { header: labels });
  ws['!cols'] = labels.map((l) => ({ wch: Math.max(12, Math.min(34, String(l).length + 12)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Devices');
  return wb;
}

export function workbookToBuffer(wb, format = 'xlsx') {
  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { forceQuotes: false });
    return Buffer.from('\uFEFF' + csv, 'utf8'); // BOM برای نمایش صحیح فارسی در Excel
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * اعتبارسنجی ردیف‌های ورودی علامت‌های نقشه.
 * @returns {{ valid: Array, errors: Array }}
 */
export function validateMarkerRows(rows, existingTypes = []) {
  const knownTypes = new Set(existingTypes.map((t) => String(t).trim()));
  const valid = [];
  const errors = [];
  for (const r of rows) {
    const issues = [];
    const name = String(r.name ?? '').trim();
    const type = String(r.type ?? '').trim();
    const lat = r.latitude === '' || r.latitude == null ? NaN : Number(r.latitude);
    const lng = r.longitude === '' || r.longitude == null ? NaN : Number(r.longitude);
    if (!name) issues.push('نام علامت وارد نشده است');
    if (!type) issues.push('نوع علامت وارد نشده است');
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) issues.push('عرض جغرافیایی نامعتبر');
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) issues.push('طول جغرافیایی نامعتبر');
    const record = {
      row: r.__row,
      name,
      type,
      latitude: Number.isFinite(lat) ? lat : null,
      longitude: Number.isFinite(lng) ? lng : null,
      notes: String(r.notes ?? '').trim().slice(0, 500),
      color: String(r.color ?? '').trim(),
      icon: String(r.icon ?? '').trim(),
      newType: !!type && !knownTypes.has(type),
    };
    if (issues.length) errors.push({ ...record, issues });
    else valid.push(record);
  }
  return { valid, errors };
}

export function buildMarkerWorkbook(rows) {
  const keys = MARKER_EXPORT_HEADERS.map((h) => h[0]);
  const labels = MARKER_EXPORT_HEADERS.map((h) => h[1]);
  const data = rows.map((r) =>
    Object.fromEntries(labels.map((label, i) => [label, r[keys[i]] == null ? '' : sanitizeSpreadsheetValue(r[keys[i]])]))
  );
  const ws = XLSX.utils.json_to_sheet(data, { header: labels });
  ws['!cols'] = labels.map((l) => ({ wch: Math.max(14, Math.min(34, String(l).length + 12)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Markers');
  return wb;
}

/** ردیف‌های نمونه برای فایل «علامت‌های نقشه» */
export function markerTemplateRows() {
  return [
    {
      name: 'نصب سوئیچ — ساختمان اداری',
      type: 'تجهیز در حال نصب',
      latitude: 35.7289,
      longitude: 51.3896,
      notes: 'این ردیف نمونه است و می‌توانید حذفش کنید.',
    },
    {
      name: 'نصب اکسس‌پوینت — طبقه ۳',
      type: 'تجهیز در حال نصب',
      latitude: 35.7312,
      longitude: 51.4021,
      notes: '',
    },
    {
      name: 'خرابی فیبر — مسیر شمالی',
      type: 'محل حادثه و خرابی',
      latitude: 35.7402,
      longitude: 51.3711,
      notes: 'نیازمند بازدید فوری',
    },
    {
      name: 'بازدید ماهانه — شعبه غرب',
      type: 'نقطه بازدید دوره‌ای',
      latitude: 35.8355,
      longitude: 50.9915,
      notes: '',
    },
  ];
}

/* --------------------- ورود/خروجی خزانهٔ رمز عبور --------------------- */

/** سرستون‌های پذیرفته‌شده در فایل ورودی رمزها (فارسی/انگلیسی) */
const CREDENTIAL_COLUMN_MAP = {
  label: 'label',
  title: 'label',
  name: 'label',
  'عنوان': 'label',
  'نام': 'label',
  'نام ورود': 'label',
  'title/نام': 'label',
  site: 'host',
  url: 'host',
  'سایت': 'host',
  'آدرس سایت': 'host',
  'نشانی': 'host',
  host: 'host',
  'میزبان': 'host',
  port: 'port',
  'پورت': 'port',
  username: 'username',
  user: 'username',
  login: 'username',
  'نام کاربری': 'username',
  'یوزر': 'username',
  'کاربر': 'username',
  password: 'secret',
  pass: 'secret',
  secret: 'secret',
  'رمز': 'secret',
  'رمز عبور': 'secret',
  'پسورد': 'secret',
  'گذرواژه': 'secret',
  notes: 'notes',
  note: 'notes',
  'یادداشت': 'notes',
  'توضیحات': 'notes',
  tags: 'tags',
  'برچسب': 'tags',
  'برچسب‌ها': 'tags',
  'برچسب ها': 'tags',
  'تگ': 'tags',
  'تگ‌ها': 'tags',
  device: 'device',
  'تجهیز': 'device',
  'نام تجهیز': 'device',
  'دستگاه': 'device',
  kind: 'kind',
  type: 'kind',
  'نوع': 'kind',
  'نوع دسترسی': 'kind',
};

const CREDENTIAL_LOOKUP = new Map(Object.entries(CREDENTIAL_COLUMN_MAP).map(([k, v]) => [lookupKey(k), v]));

/** نگاشت سرستون فایل رمزها؛ سرستون ناشناخته به snake_case تبدیل می‌شود. */
export function normalizeCredentialKey(key) {
  const k = lookupKey(key);
  return CREDENTIAL_LOOKUP.get(k) || foldKey(key).replace(/\s+/g, '_');
}

/** ستون‌های فایل خروجی/نمونهٔ رمزها */
export const CREDENTIAL_EXPORT_HEADERS = [
  ['label', 'عنوان'],
  ['username', 'نام کاربری'],
  ['secret', 'رمز عبور'],
  ['host', 'میزبان'],
  ['port', 'پورت'],
  ['device', 'تجهیز'],
  ['kind', 'نوع'],
  ['tags', 'برچسب‌ها'],
  ['notes', 'توضیحات'],
];

/**
 * ساخت فایل Excel رمزها.
 * فقط فیلدهای متنی از Formula Injection پاک می‌شوند؛ ستون رمز دست‌نخورده
 * می‌ماند تا خروجی/ورود مجدد، رمز را دقیقاً همان‌طور که هست برگرداند.
 */
export function buildCredentialWorkbook(rows) {
  const keys = CREDENTIAL_EXPORT_HEADERS.map((h) => h[0]);
  const labels = CREDENTIAL_EXPORT_HEADERS.map((h) => h[1]);
  const data = rows.map((row) =>
    Object.fromEntries(
      labels.map((label, index) => {
        const key = keys[index];
        const raw = row[key] == null ? '' : row[key];
        return [label, key === 'secret' ? raw : sanitizeSpreadsheetValue(raw)];
      })
    )
  );
  const ws = XLSX.utils.json_to_sheet(data, { header: labels });
  ws['!cols'] = labels.map((label) => ({ wch: Math.max(16, Math.min(40, String(label).length + 12)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Credentials');
  return wb;
}

export function templateRows() {
  return [
    {
      name: 'نمونه — سوئیچ دسترسی',
      ip: '192.168.10.20',
      device_type: 'سوئیچ',
      group: 'سوئیچ‌های دسترسی',
      location: 'تهران — ساختمان اداری',
      latitude: 35.7289,
      longitude: 51.3896,
      vendor: 'Cisco',
      serial: 'FOC2145X0AB',
      mac_address: '00:1A:2B:3C:4D:5E',
      asset_tag: 'AST-10045',
      owner: 'تیم شبکه',
      priority: 'normal',
      tags: 'حیاتی, نقطه لبه',
      enabled: 1,
      monitoring_enabled: 1,
      notes: 'این ردیف نمونه است و می‌توانید حذفش کنید.',
    },
  ];
}
