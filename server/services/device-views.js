/**
 * NetWatch — نماهای سبک تجهیزات
 * ----------------------------------------------------------------
 * Queryهای Map و Sparkline از Route جدا شده‌اند تا منطق دامنه و ساخت
 * پاسخ JSON در یک جای مشخص بماند. هیچ تصمیم HTTP در این ماژول گرفته
 * نمی‌شود؛ ورودی همان query string و خروجی همان بدنهٔ قبلی است.
 */
import { db } from '../db.js';
import { parseListQuery, buildDeviceWhere } from '../store.js';
import { RANGE_BUCKETS, RANGE_MS } from './device-series.js';

/** سری نمونه‌ای سبک برای نمودار کارت‌های فهرست تجهیزات */
export function sparklinesPayload(query) {
  const ids = String(query.ids || '')
    .split(',')
    .map(Number)
    .filter(Boolean)
    .slice(0, 300);
  const range = String(query.range || '1h');
  if (!ids.length) return { range, series: {} };
  const bucket = RANGE_BUCKETS[range] || RANGE_BUCKETS['1h'];
  const from = Date.now() - (RANGE_MS[range] || RANGE_MS['1h']);
  const ph = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT device_id, (ts / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS bucket,
              AVG(CASE WHEN ok=1 THEN rtt_ms END) AS rtt,
              AVG(ok) * 100 AS availability
       FROM samples WHERE device_id IN (${ph}) AND ts >= ?
       GROUP BY device_id, bucket ORDER BY bucket`
    )
    .all(bucket.ms, bucket.ms, ...ids, from);
  const series = {};
  for (const r of rows) {
    if (!series[r.device_id]) series[r.device_id] = [];
    series[r.device_id].push({
      t: r.bucket,
      rtt: r.rtt == null ? null : Math.round(r.rtt * 100) / 100,
      loss: r.availability == null ? 0 : Math.round((100 - r.availability) * 10) / 10,
    });
  }
  return { range, bucketMs: bucket.ms, series };
}

// سقف پاسخ نقشه برای حفظ حافظه؛ اما بسیار بالاتر از محدودیت قبلی (۵۰۰) است،
// پس صدها/هزاران تجهیز دارای مختصات قابل نمایش‌اند. محدودهٔ جغرافیایی
// (bbox) تعداد Markerها را در نمای نزدیک به‌طور طبیعی کم می‌کند.
const MAP_MAX_DEVICES = (() => {
  const n = Number(process.env.NETWATCH_MAP_MAX);
  return Number.isFinite(n) && n >= 1000 ? Math.min(50000, Math.floor(n)) : 25000;
})();
const MAP_STATUSES = ['online', 'warning', 'offline', 'maintenance', 'unknown'];

/** bbox=minLng,minLat,maxLng,maxLat (اختیاری، با اعتبارسنجی و مرزگذاری) */
function parseBbox(raw) {
  if (!raw) return null;
  const parts = String(raw)
    .split(',')
    .map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  let [minLng, minLat, maxLng, maxLat] = parts;
  minLng = clamp(minLng, -180, 180);
  maxLng = clamp(maxLng, -180, 180);
  minLat = clamp(minLat, -90, 90);
  maxLat = clamp(maxLat, -90, 90);
  if (minLat > maxLat) [minLat, maxLat] = [maxLat, minLat];
  return { minLng, minLat, maxLng, maxLat, wrap: minLng > maxLng };
}

/**
 * API اختصاصی نقشه.
 *
 * تفاوت کلیدی با فهرست تجهیزات:
 *   • تعداد کل، تعداد دارای مختصات و تعداد بدون مختصات مستقل محاسبه می‌شوند.
 *   • فیلتر محدودهٔ جغرافیایی (bbox) و زوم از کلاینت می‌آید تا فقط نقاط نمای
 *     فعلی منتقل شوند؛ اما آمار سراسری فیلترها هم برگردانده می‌شود.
 *   • payload سبک است (بدون تاریخچه/تگ/فیلدهای تزئینی) تا هزاران Marker بدون
 *     فشار حافظه پاسخ داده شوند.
 */
export function mapPayload(query) {
  // فهرست تجهیزات نقشه می‌تواند تجهیزات بدون مختصات را هم برگرداند
  // (`includeMissing=1`) تا کاربر از همان فهرست تجهیز را بکشد/انتخاب کند و
  // موقعیتش را ثبت کند؛ نشانگرها فقط برای تجهیزات دارای مختصات ساخته می‌شوند.
  const includeMissing = String(query.includeMissing || '') === '1';
  const withGeoFilters = parseListQuery({ ...query, geo: 'with' });
  const withGeoWhere = buildDeviceWhere(withGeoFilters);
  // تعداد کل مستقل از وجود مختصات است
  const totalWhere = buildDeviceWhere({ ...withGeoFilters, geo: '' });
  const join = 'FROM devices d LEFT JOIN groups g ON g.id = d.group_id LEFT JOIN sites s ON s.id = d.site_id';
  const total = db.prepare(`SELECT COUNT(*) AS c ${join} ${totalWhere.clause}`).get(...totalWhere.params).c;
  const withGeo = db.prepare(`SELECT COUNT(*) AS c ${join} ${withGeoWhere.clause}`).get(...withGeoWhere.params).c;

  const stats = Object.fromEntries(MAP_STATUSES.map((s) => [s, 0]));
  for (const row of db
    .prepare(`SELECT d.status, COUNT(*) AS c ${join} ${withGeoWhere.clause} GROUP BY d.status`)
    .all(...withGeoWhere.params)) {
    stats[row.status] = row.c;
  }

  // با includeMissing فهرست باید کامل باشد؛ فیلتر bbox فقط برای نشانگرهای
  // دارای مختصات معنا دارد و اعمالش تجهیزات بدون موقعیت را حذف می‌کرد.
  const bbox = includeMissing ? null : parseBbox(query.bbox);
  const params = [...(includeMissing ? totalWhere.params : withGeoWhere.params)];
  let bboxSql = '';
  if (bbox) {
    if (bbox.wrap) {
      bboxSql = ' AND d.latitude >= ? AND d.latitude <= ? AND (d.longitude >= ? OR d.longitude <= ?)';
      params.push(bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng);
    } else {
      bboxSql = ' AND d.latitude >= ? AND d.latitude <= ? AND d.longitude >= ? AND d.longitude <= ?';
      params.push(bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng);
    }
  }
  const limit = Math.min(
    MAP_MAX_DEVICES,
    Math.max(100, parseInt(query.limit || String(MAP_MAX_DEVICES), 10) || MAP_MAX_DEVICES)
  );
  const rows = db
    .prepare(
      `SELECT d.id, d.name, d.ip, d.status, d.latitude, d.longitude, d.location,
              d.device_type, d.last_rtt_ms, d.priority, d.map_layer_id, d.site_id, s.name AS site_name,
              g.name AS group_name
       ${join}
       ${includeMissing ? totalWhere.clause : withGeoWhere.clause}${bboxSql}
       ORDER BY CASE d.status WHEN 'offline' THEN 0 WHEN 'warning' THEN 1 WHEN 'maintenance' THEN 2 ELSE 3 END, d.name
       LIMIT ?`
    )
    .all(...params, limit + 1);

  const truncated = rows.length > limit;
  const items = (truncated ? rows.slice(0, limit) : rows).map((r) => ({
    id: r.id,
    name: r.name,
    ip: r.ip,
    status: r.status,
    latitude: r.latitude,
    longitude: r.longitude,
    deviceType: r.device_type,
    groupName: r.group_name || null,
    siteId: r.site_id ?? null,
    siteName: r.site_name || null,
    lastRtt: r.last_rtt_ms,
    priority: r.priority,
    location: r.location || '',
    mapLayerId: r.map_layer_id,
  }));

  return {
    items,
    total,
    withGeo,
    missingGeo: Math.max(0, total - withGeo),
    returned: items.length,
    truncated,
    stats,
    bbox: bbox ? [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat] : null,
    zoom: Math.min(22, Math.max(0, Number(query.zoom) || 0)),
    generatedAt: Date.now(),
  };
}
