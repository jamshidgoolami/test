/**
 * NetWatch — انتقال گروهی تجهیزات
 * ----------------------------------------------------------------
 * منطق Import/Export، Preview و ورود مختصات جغرافیایی از Route جدا شده
 * است. این ماژول فقط داده برمی‌گرداند یا تراکنش را اجرا می‌کند؛ تعیین
 * Content-Type، Status Code و پیام خطای HTTP در Route می‌ماند.
 */
import { db, getSettings, transaction, requireDiskSpace } from '../db.js';
import { listDevices, getDevice, createDevice, parseListQuery } from '../store.js';
import { runJob } from '../jobs.js';
import { isValidIp } from '../ping.js';
import { templateRows, EXPORT_HEADERS } from '../impexp.js';
import { jalaliLabelFromMs } from '../jalali.js';

/** ساخت ردیف‌های خروجی تجهیزات با همان حذف اعتبارنامه و نگاشت قبلی. */
function exportRows(query) {
  const filters = { ...parseListQuery({ ...query, page: '1', pageSize: '500' }) };
  let rows;
  if (query.ids) {
    const ids = String(query.ids)
      .split(',')
      .map((n) => Number(n))
      .filter(Boolean);
    rows = ids.map((id) => getDevice(id)).filter(Boolean);
  } else {
    filters.pageSize = 5000;
    rows = listDevices(filters).items;
  }
  return rows.map((d) => {
    // خروجی فایل نباید اعتبارنامهٔ دسترسی را به یک فایل بدون رمز منتقل کند.
    const { accessUsername: _accessUsername, hasAccessPassword: _hasAccessPassword, ...row } = d;
    return {
      ...row,
      priority: d.priority,
      tags: (d.tags || []).map((t) => t.name).join(', '),
      enabled: d.enabled ? 1 : 0,
      monitoring_enabled: d.monitoringEnabled ? 1 : 0,
      location: d.location,
      group: d.groupName,
      device_type: d.deviceType,
      mac_address: d.macAddress,
      asset_tag: d.assetTag,
      latitude: d.latitude,
      longitude: d.longitude,
      last_rtt_ms: d.lastRtt,
      uptime_pct: d.uptimePct,
      loss_pct: d.lossPct,
      status: d.status,
      installed_at: d.installedAt ? jalaliLabelFromMs(d.installedAt, getSettings().timezone_offset_minutes) : '',
    };
  });
}

/** خروجی فایل تجهیزات؛ Buffer آماده برای Route. */
export async function buildDeviceExport(query) {
  const format = String(query.format || 'csv').toLowerCase() === 'xlsx' ? 'xlsx' : 'csv';
  const data = exportRows(query);
  // ساخت Excel/CSV در Worker انجام می‌شود تا رشتهٔ اصلی سرور در طول پردازش
  // فایل بزرگ (هزاران ردیف) قفل نشود.
  const result = await runJob('export', { rows: data, headers: EXPORT_HEADERS, format }, { timeoutMs: 120000 });
  return { format, buffer: Buffer.from(result.buffer) };
}

/** فایل قالب خالی برای ورود گروهی. */
export async function buildDeviceTemplate(query) {
  const format = String(query.format || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
  const result = await runJob(
    'export',
    { rows: templateRows(), headers: EXPORT_HEADERS, format },
    { timeoutMs: 30000 }
  );
  return { format, buffer: Buffer.from(result.buffer) };
}

/** پیش‌نمایش ورود گروهی؛ خروجی دقیقاً همان پاسخ قبلی Route است. */
export async function previewDeviceImport(file) {
  const existing = db.prepare('SELECT id, name, ip FROM devices').all();
  // پارس و اعتبارسنجی فایل در Worker؛ بدنهٔ درخواست در حافظه می‌ماند اما
  // CPU سرور برای پاسخ‌دهی به بقیهٔ APIها آزاد است.
  const result = await runJob(
    'devicesPreview',
    { buffer: file.buffer, filename: file.originalname, existing },
    { timeoutMs: 120000 }
  );
  const knownGroups = new Set(
    db
      .prepare('SELECT name FROM groups')
      .all()
      .map((r) => r.name)
  );
  const knownTags = new Set(
    db
      .prepare('SELECT name FROM tags')
      .all()
      .map((r) => r.name)
  );
  // پاسخ پیش‌نمایش برای فایل ۵۰٬۰۰۰ ردیفی نباید ده‌ها مگابایت JSON شود؛
  // رابط کاربری فقط شمارش‌ها و چند نمونهٔ خطا را نشان می‌دهد. شمارش کامل در
  // summary می‌ماند و نمونه‌ها سقف دارند تا حافظهٔ کلاینت/سرور کنترل شود.
  const PREVIEW_ITEMS = 200;
  return {
    fileName: file.originalname,
    headers: result.headers,
    totalRows: result.totalRows,
    valid: result.valid.slice(0, PREVIEW_ITEMS),
    errors: result.errors.slice(0, PREVIEW_ITEMS),
    duplicates: result.duplicates.slice(0, PREVIEW_ITEMS),
    truncated: {
      valid: result.valid.length > PREVIEW_ITEMS,
      errors: result.errors.length > PREVIEW_ITEMS,
      duplicates: result.duplicates.length > PREVIEW_ITEMS,
    },
    summary: {
      valid: result.valid.length,
      invalid: result.errors.length,
      duplicates: result.duplicates.length,
      newGroups: [...new Set(result.valid.map((r) => r.group).filter(Boolean))].filter((g) => !knownGroups.has(g)),
      newTags: [...new Set(result.valid.flatMap((r) => r.tags))].filter((t) => !knownTags.has(t)),
    },
  };
}

/** ثبت اتمیک ورود گروهی؛ خطا همان‌طور که هست به Route می‌رسد. */
export async function commitDeviceImport(file, { onlyValid = true } = {}) {
  const existing = db.prepare('SELECT id, name, ip FROM devices').all();
  const { valid, errors } = await runJob(
    'devicesParse',
    { buffer: file.buffer, filename: file.originalname, existing },
    { timeoutMs: 120000 }
  );
  const list = onlyValid ? valid : [...valid, ...errors.filter((e) => e.ip && isValidIp(e.ip))];
  // پیش از نوشتن دستهٔ بزرگ، فضای دیسک بررسی می‌شود؛ در غیر این صورت پر شدن
  // دیسک وسط کار، همهٔ ردیف‌ها را با خطای پایگاه‌داده برمی‌گرداند.
  requireDiskSpace(list.length * 1024 + 4 * 1024 * 1024, `ورود گروهی ${list.length} تجهیز`);
  // ورود گروهی یک عملیات اتمیک است: اگر یک ردیف شکست بخورد، هیچ تجهیزی ثبت
  // نمی‌شود (پیش‌تر ردیف‌های موفق باقی می‌ماندند و کاربر فکر می‌کرد همه ثبت شده).
  const result = transaction(
    () => {
      let inserted = 0;
      for (const r of list) {
        try {
          createDevice(r, { source: 'import' });
          inserted++;
        } catch (e) {
          const err = new Error(`ردیف «${r.name ?? ''}» (${r.ip ?? ''}) ثبت نشد: ${e.message}`);
          err.importIndex = inserted;
          throw err;
        }
      }
      db.prepare('INSERT INTO engine_log(ts, level, message) VALUES (?,?,?)').run(
        Date.now(),
        'info',
        `ورود گروهی: ${inserted} تجهیز افزوده شد.`
      );
      return { inserted };
    },
    { label: 'devices.import' }
  );
  return { inserted: result.inserted, skipped: onlyValid ? errors.length : 0 };
}

/**
 * خروجی مختصات جغرافیایی.
 *
 * با `markers=1` علامت‌های نقشه هم در همان فایل می‌آیند و ستون «نوع رکورد»
 * تجهیز را از علامت جدا می‌کند؛ پارامترهای `group` و `types` فهرست را به گروه
 * تجهیزات و انواع علامت انتخاب‌شده در دیالوگ صفحهٔ نقشه محدود می‌کنند.
 */
export async function buildGeoExport(query) {
  const format = String(query.format || 'csv').toLowerCase() === 'xlsx' ? 'xlsx' : 'csv';
  // انتخاب چندگروهی دیالوگ نقشه: `groups` فهرست نام گروه‌ها با کاما است و
  // `__none_selected__` یعنی کاربر هیچ گروهی را انتخاب نکرده است. پارامتر
  // تک‌گروهی `group` برای سازگاری با فراخوانی‌های قدیمی حفظ می‌شود.
  const group = String(query.group || '').trim();
  const hasGroupsParam = query.groups !== undefined;
  const groups = String(query.groups || '')
    .split(',')
    .map((g) => g.trim())
    .filter((g) => g && g !== '__none_selected__')
    .slice(0, 200);
  const includeMarkers = String(query.markers || '') === '1';
  const typeIds = String(query.types || '')
    .split(',')
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v > 0);

  const where = ['d.latitude IS NOT NULL', 'd.longitude IS NOT NULL'];
  const params = [];
  if (hasGroupsParam && !groups.length) {
    // هیچ گروهی انتخاب نشده است؛ فایل فقط علامت‌ها را در بر می‌گیرد.
    where.push('0 = 1');
  } else if (groups.length) {
    const named = groups.filter((g) => g !== '__none__');
    const clauses = [];
    if (named.length) {
      const ph = named.map(() => '?').join(',');
      clauses.push(
        `g.name IN (${ph})`,
        `EXISTS (
           SELECT 1 FROM device_group_members m JOIN groups mg ON mg.id = m.group_id
           WHERE m.device_id = d.id AND mg.name IN (${ph}))`
      );
      params.push(...named, ...named);
    }
    if (groups.includes('__none__')) {
      clauses.push(
        '(d.group_id IS NULL AND NOT EXISTS (SELECT 1 FROM device_group_members m WHERE m.device_id = d.id))'
      );
    }
    where.push(`(${clauses.join(' OR ')})`);
  } else if (group === '__none__') {
    // بدون گروه: نه ستون قدیمی group_id و نه عضویت چندگروهی
    where.push('d.group_id IS NULL AND NOT EXISTS (SELECT 1 FROM device_group_members m WHERE m.device_id = d.id)');
  } else if (group) {
    where.push(
      `(g.name = ? OR EXISTS (
         SELECT 1 FROM device_group_members m JOIN groups mg ON mg.id = m.group_id
         WHERE m.device_id = d.id AND mg.name = ?))`
    );
    params.push(group, group);
  }
  const deviceRows = db
    .prepare(
      `SELECT d.name, d.ip, d.device_type AS type, d.location, d.latitude, d.longitude, d.status, COALESCE(g.name,'') AS group_name
       FROM devices d LEFT JOIN groups g ON g.id = d.group_id
       WHERE ${where.join(' AND ')}
       ORDER BY d.name`
    )
    .all(...params);

  const markerRows = includeMarkers
    ? db
        .prepare(
          `SELECT m.name, m.latitude, m.longitude, m.notes, COALESCE(t.name,'') AS type_name
           FROM map_markers m LEFT JOIN marker_types t ON t.id = m.type_id
           ${typeIds.length ? `WHERE m.type_id IN (${typeIds.map(() => '?').join(',')})` : ''}
           ORDER BY m.name`
        )
        .all(...typeIds)
    : [];

  const rows = includeMarkers
    ? [
        ...deviceRows.map((r) => ({
          'نوع رکورد': 'تجهیز',
          نام: r.name,
          'آدرس IP': r.ip,
          نوع: r.type,
          گروه: r.group_name,
          موقعیت: r.location,
          'عرض جغرافیایی': r.latitude,
          'طول جغرافیایی': r.longitude,
          وضعیت: r.status,
        })),
        ...markerRows.map((r) => ({
          'نوع رکورد': 'علامت',
          نام: r.name,
          'آدرس IP': '',
          نوع: r.type_name,
          گروه: '',
          موقعیت: r.notes,
          'عرض جغرافیایی': r.latitude,
          'طول جغرافیایی': r.longitude,
          وضعیت: '',
        })),
      ]
    : deviceRows.map((r) => ({
        'نام تجهیز': r.name,
        'آدرس IP': r.ip,
        نوع: r.type,
        موقعیت: r.location,
        'عرض جغرافیایی': r.latitude,
        'طول جغرافیایی': r.longitude,
        وضعیت: r.status,
      }));
  const headers = Object.keys(
    rows[0] ||
      (includeMarkers
        ? {
            'نوع رکورد': '',
            نام: '',
            'آدرس IP': '',
            نوع: '',
            گروه: '',
            موقعیت: '',
            'عرض جغرافیایی': '',
            'طول جغرافیایی': '',
            وضعیت: '',
          }
        : {
            'نام تجهیز': '',
            'آدرس IP': '',
            نوع: '',
            موقعیت: '',
            'عرض جغرافیایی': '',
            'طول جغرافیایی': '',
            وضعیت: '',
          })
  ).map((k) => [k, k]);
  const result = await runJob('export', { rows, headers, format }, { timeoutMs: 120000 });
  return { format, buffer: Buffer.from(result.buffer) };
}

/** ورود مختصات؛ خروجی شمارش و خطاهای همان مسیر قبلی است. */
export async function importGeoFile(file) {
  const { rows } = await runJob('parse', { buffer: file.buffer, filename: file.originalname }, { timeoutMs: 120000 });
  let updated = 0;
  const errors = [];
  const upd = db.prepare('UPDATE devices SET latitude = ?, longitude = ?, updated_at = ? WHERE ip = ?');
  const byName = db.prepare('SELECT id FROM devices WHERE name = ?');
  for (const r of rows) {
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    const ip = String(r.ip ?? '').trim();
    const name = String(r.name ?? '').trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      errors.push({ row: r.__row, reason: 'مختصات نامعتبر' });
      continue;
    }
    if (ip) {
      const n = upd.run(lat, lng, Date.now(), ip).changes;
      if (n) {
        updated += n;
        continue;
      }
    }
    if (name) {
      const d = byName.get(name);
      if (d) {
        db.prepare('UPDATE devices SET latitude=?, longitude=?, updated_at=? WHERE id=?').run(
          lat,
          lng,
          Date.now(),
          d.id
        );
        updated++;
        continue;
      }
    }
    errors.push({ row: r.__row, reason: 'تجهیزی با این IP یا نام یافت نشد' });
  }
  return { updated, errors };
}
