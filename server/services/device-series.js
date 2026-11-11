/**
 * NetWatch — سرویس سری زمانی تجهیزات
 * ----------------------------------------------------------------
 * محاسبهٔ بازه، انتخاب باکت و کوئری نمونه‌ها از لایهٔ HTTP جدا شده است تا
 * مسیرها فقط اعتبارسنجی ورودی و قالب‌بندی پاسخ را انجام دهند.
 */
import { db } from '../db.js';

export const RANGE_BUCKETS = {
  '15m': { ms: 60 * 1000, label: '۱ دقیقه' },
  '1h': { ms: 60 * 1000, label: '۱ دقیقه' },
  '6h': { ms: 5 * 60 * 1000, label: '۵ دقیقه' },
  '24h': { ms: 15 * 60 * 1000, label: '۱۵ دقیقه' },
  '7d': { ms: 60 * 60 * 1000, label: '۱ ساعت' },
  '30d': { ms: 6 * 60 * 60 * 1000, label: '۶ ساعت' },
  '90d': { ms: 24 * 60 * 60 * 1000, label: '۱ روز' },
};
export const RANGE_MS = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

/* --------------------------- سری زمانی --------------------------- */

/**
 * باکت‌های مجاز برای پنجرهٔ زمانی دلخواه. بزرگ‌ترین مقدار (۱ روز) برای
 * نمای ماهانهٔ چند ماهه و کوچک‌ترین (۱ دقیقه) برای نمای ساعتی است.
 */
const ALLOWED_BUCKETS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];
const BUCKET_LABELS = new Map([
  [60_000, '۱ دقیقه'],
  [5 * 60_000, '۵ دقیقه'],
  [15 * 60_000, '۱۵ دقیقه'],
  [30 * 60_000, '۳۰ دقیقه'],
  [60 * 60_000, '۱ ساعت'],
  [6 * 60 * 60_000, '۶ ساعت'],
  [24 * 60 * 60_000, '۱ روز'],
]);
const MAX_WINDOW_MS = 370 * 24 * 60 * 60_000;
const MAX_WINDOW_POINTS = 4000;

function bucketLabel(bucketMs) {
  return BUCKET_LABELS.get(bucketMs) ?? `${Math.round(bucketMs / 60000)} دقیقه`;
}

/**
 * مقدار باکت را به یکی از گام‌های مجاز گرد می‌کند و اگر تعداد باکت‌های پنجره
 * از سقف پاسخ بیشتر شود، گام را بزرگ‌تر می‌کند تا پاسخ سنگین نشود.
 */
function normalizeBucket(requested, windowMs) {
  const value = Number(requested);
  let bucket = ALLOWED_BUCKETS.includes(value) ? value : ALLOWED_BUCKETS[3];
  while (windowMs / bucket > MAX_WINDOW_POINTS && bucket < ALLOWED_BUCKETS[ALLOWED_BUCKETS.length - 1]) {
    bucket = ALLOWED_BUCKETS[ALLOWED_BUCKETS.indexOf(bucket) + 1];
  }
  return bucket;
}

/** پرس‌وجوی مشترک سری زمانی؛ بازهٔ [from, to) و باکت مشخص. */
function querySeries(deviceId, from, to, bucketMs) {
  const rows = db
    .prepare(
      // پارامترهای عددی در node:sqlite به‌صورت REAL بایند می‌شوند؛ بدون CAST،
      // تقسیم اعشاری می‌شود و هر نمونهٔ خام یک «باکت» جدا می‌سازد.
      `SELECT (ts / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS bucket,
              COUNT(*) AS samples,
              SUM(ok) AS ok_count,
              AVG(CASE WHEN ok = 1 THEN rtt_ms END) AS rtt,
              MIN(CASE WHEN ok = 1 THEN rtt_ms END) AS min_rtt,
              MAX(CASE WHEN ok = 1 THEN rtt_ms END) AS max_rtt,
              AVG(CASE WHEN ok = 1 THEN 0 ELSE 100 END) AS loss,
              AVG(ok) * 100 AS availability
       FROM samples WHERE device_id = ? AND ts >= ? AND ts < ?
       GROUP BY bucket ORDER BY bucket ASC`
    )
    .all(bucketMs, bucketMs, Number(deviceId), from, to);
  return rows.map((r) => ({
    t: r.bucket,
    rtt: r.rtt == null ? null : Math.round(r.rtt * 100) / 100,
    minRtt: r.min_rtt == null ? null : Math.round(r.min_rtt * 100) / 100,
    maxRtt: r.max_rtt == null ? null : Math.round(r.max_rtt * 100) / 100,
    loss: r.loss == null ? 0 : Math.round(r.loss * 10) / 10,
    availability: r.availability == null ? 0 : Math.round(r.availability * 10) / 10,
    samples: r.samples,
    ok: r.ok_count || 0,
    down: r.samples - (r.ok_count || 0),
    status: (r.ok_count || 0) === 0 ? 'offline' : (r.availability || 0) < 99 ? 'warning' : 'online',
  }));
}

/**
 * سری زمانی تجهیز.
 *
 * `span` تعداد پنجره‌های هم‌اندازهٔ `range` است که پیش از اکنون خوانده می‌شود؛
 * با span=7 برای range=24h، هفت روز داده برمی‌گردد تا نمودار بتواند با اسکرول
 * افقی روزهای قبل را نشان دهد. حداکثر ۳۰ پنجره مجاز است تا حجم پاسخ کنترل شود.
 */
export function seriesFor(deviceId, range = '1h', span = 1) {
  const bucket = RANGE_BUCKETS[range] || RANGE_BUCKETS['1h'];
  const windows = Math.min(30, Math.max(1, Math.floor(Number(span) || 1)));
  const to = Date.now();
  const from = to - (RANGE_MS[range] || RANGE_MS['1h']) * windows;
  return {
    range,
    span: windows,
    bucketMs: bucket.ms,
    bucketLabel: bucket.label,
    from,
    to,
    points: querySeries(deviceId, from, to, bucket.ms),
  };
}

/**
 * سری زمانی یک پنجرهٔ دلخواه (نه فقط «تا اکنون»).
 *
 * نمای ماهانه/هفتگی/روزانه/ساعتی برای جابه‌جایی در تاریخ به این پنجره نیاز
 * دارد؛ query‌های range قدیمی همیشه به اکنون ختم می‌شدند و ماه قبل را
 * پوشش نمی‌دادند. ورودی‌ها این‌جا اعتبارسنجی و مرزگذاری شده‌اند.
 */
export function seriesWindowFor(deviceId, from, to, requestedBucket) {
  const end = Number(to);
  const start = Math.min(Number(from), end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    const error = new Error('بازهٔ زمانی نامعتبر است.');
    error.status = 400;
    error.code = 'INVALID_WINDOW';
    throw error;
  }
  if (end - start > MAX_WINDOW_MS) {
    const error = new Error('بازهٔ زمانی بیش از حد بزرگ است.');
    error.status = 400;
    error.code = 'WINDOW_TOO_LARGE';
    throw error;
  }
  const bucketMs = normalizeBucket(requestedBucket, end - start);
  return {
    range: 'custom',
    span: 1,
    bucketMs,
    bucketLabel: bucketLabel(bucketMs),
    from: start,
    to: end,
    points: querySeries(deviceId, start, end, bucketMs),
  };
}

/* --------------------------- فهرست و جزئیات --------------------------- */
