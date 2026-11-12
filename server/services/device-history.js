/**
 * NetWatch — تاریخچه و سلامت تجهیز
 * ----------------------------------------------------------------
 * Queryهای Outage، Availability، Sample، Health و Maintenance از Route
 * جدا شده‌اند. ساختار پاسخ‌ها عیناً حفظ شده و Route فقط ۴۰۴ تجهیز
 * ناموجود یا پاسخ JSON را تعیین می‌کند.
 */
import { db } from '../db.js';
import { getDevice } from '../store.js';
import { seriesFor } from './device-series.js';

export function outagesPayload(id, query) {
  const limit = Math.min(500, Math.max(1, parseInt(query.limit || '100', 10) || 100));
  const from = Number(query.from);
  const to = Number(query.to);
  const hasWindow = Number.isFinite(from) && Number.isFinite(to) && to > from;
  const rows = hasWindow
    ? db
        .prepare(
          `SELECT * FROM outages
           WHERE device_id = ? AND started_at < ? AND (ended_at IS NULL OR ended_at > ?)
           ORDER BY started_at DESC LIMIT ?`
        )
        .all(Number(id), to, from, limit)
    : db.prepare('SELECT * FROM outages WHERE device_id = ? ORDER BY started_at DESC LIMIT ?').all(Number(id), limit);
  const total = hasWindow
    ? db
        .prepare(
          `SELECT COUNT(*) AS c FROM outages
           WHERE device_id = ? AND started_at < ? AND (ended_at IS NULL OR ended_at > ?)`
        )
        .get(Number(id), to, from).c
    : db.prepare('SELECT COUNT(*) AS c FROM outages WHERE device_id = ?').get(Number(id)).c;
  const openRow = db
    .prepare('SELECT * FROM outages WHERE device_id = ? AND open = 1 ORDER BY started_at DESC LIMIT 1')
    .get(Number(id));
  return {
    total,
    from: hasWindow ? from : null,
    to: hasWindow ? to : null,
    open: openRow ? { ...openRow, durationSec: Math.round((Date.now() - openRow.started_at) / 1000) } : null,
    items: rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      durationSec: r.ended_at
        ? (r.duration_sec ?? Math.round((r.ended_at - r.started_at) / 1000))
        : Math.round((Date.now() - r.started_at) / 1000),
      cause: r.cause,
      detail: r.detail,
      lat: r.lat,
      lng: r.lng,
      open: !!r.open,
      maintenance:
        db.prepare('SELECT id, action, technician FROM maintenance_records WHERE outage_id = ?').get(r.id) || null,
    })),
  };
}

export function availabilityPayload(id, query) {
  const range = String(query.range || '24h');
  const series = seriesFor(id, range);
  const buckets = series.points;
  const overall = buckets.length ? buckets.reduce((a, b) => a + b.availability, 0) / buckets.length : 100;
  const checks = buckets.reduce((a, b) => a + b.samples, 0);
  const failed = buckets.reduce((a, b) => a + b.down, 0);
  return {
    range,
    bucketLabel: series.bucketLabel,
    overall: Math.round(overall * 100) / 100,
    checks,
    failed,
    worstBucket: buckets.length ? buckets.reduce((a, b) => (a.availability <= b.availability ? a : b)) : null,
    buckets: buckets.map((b) => ({ t: b.t, availability: b.availability, down: b.down, samples: b.samples })),
  };
}

export function samplesPayload(id, query) {
  const limit = Math.min(1000, Math.max(1, parseInt(query.limit || '200', 10) || 200));
  const rows = db
    .prepare(
      'SELECT ts, rtt_ms, loss_pct, status, ok, mode, packets_sent, packets_recv FROM samples WHERE device_id = ? ORDER BY ts DESC LIMIT ?'
    )
    .all(Number(id), limit);
  return {
    items: rows.map((r) => ({
      ts: r.ts,
      rtt: r.rtt_ms,
      lossPct: r.loss_pct,
      status: r.status,
      ok: !!r.ok,
      mode: r.mode,
      sent: r.packets_sent,
      received: r.packets_recv,
    })),
  };
}

/** نمای کلی سلامت تجهیز؛ null یعنی تجهیز وجود ندارد. */
export function healthPayload(id) {
  const d = getDevice(id);
  if (!d) return null;
  const day = db.prepare('SELECT * FROM daily_stats WHERE device_id = ? ORDER BY day DESC LIMIT 14').all(Number(id));
  const mtbf = db
    .prepare(
      'SELECT AVG(diff) AS mtbf FROM (SELECT started_at - LAG(ended_at) OVER (ORDER BY started_at) AS diff FROM outages WHERE device_id = ? AND ended_at IS NOT NULL)'
    )
    .get(Number(id));
  // MTTR فقط برای قطعی‌هایی که رکورد تعمیر متصل دارند محاسبه می‌شود؛ تعداد
  // مبنا و موارد کنارگذاشته‌شده برای شفافیت برگردانده می‌شوند.
  const mttr = db
    .prepare(
      `SELECT AVG(CAST(MAX(o.ended_at - o.started_at, 0) AS REAL) / 1000.0) AS mttr, COUNT(*) AS c
       FROM outages o WHERE o.device_id = ? AND o.ended_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM maintenance_records m WHERE m.outage_id = o.id)`
    )
    .get(Number(id));
  const closedOutages = db
    .prepare('SELECT COUNT(*) AS c FROM outages WHERE device_id = ? AND ended_at IS NOT NULL')
    .get(Number(id)).c;
  return {
    deviceId: d.id,
    daily: day.reverse(),
    mtbfSec: mtbf?.mtbf ? Math.round(mtbf.mtbf / 1000) : null,
    mttrSec: mttr?.mttr != null ? Math.round(mttr.mttr) : null,
    mttrEvents: mttr?.c || 0,
    mttrExcluded: Math.max(0, closedOutages - (mttr?.c || 0)),
    maintenance: db.prepare('SELECT COUNT(*) AS c FROM maintenance_records WHERE device_id = ?').get(Number(id)).c,
  };
}

export function maintenancePayload(id) {
  const rows = db
    .prepare('SELECT * FROM maintenance_records WHERE device_id = ? ORDER BY started_at DESC')
    .all(Number(id));
  return { items: rows };
}
