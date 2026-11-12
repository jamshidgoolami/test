/**
 * NetWatch — کمک‌های Probe تجهیزات
 * ----------------------------------------------------------------
 * فراخوانی Engine و نگاشت خطای Probe/صف به Status Code در این ماژول
 * نگه داشته می‌شود تا Routeهای Ping و Bulk Probe از یک منطق استفاده کنند.
 */
import { db } from '../db.js';
import { engine } from '../engine.js';

// مرزگذاری پارامترهای ورودی کاربر (تعداد packet و مدت انتظار از بدنهٔ درخواست می‌آید)
export function clamp(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export async function pingDevice(id, opts = {}) {
  const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(Number(id));
  if (!row) return null;
  return engine.checkDevice(row, { manual: true, source: 'manual', ...opts });
}

/** خطای Probe/صف به وضعیت HTTP قابل‌فهم تبدیل می‌شود. */
export function probeStatus(error) {
  if (Number(error?.status) === 499) return 499;
  if (Number(error?.status) === 503) return 503;
  if (Number(error?.status) === 504) return 504;
  if (error?.code === 'ENGINE_NOT_LEADER') return 409;
  return 500;
}
