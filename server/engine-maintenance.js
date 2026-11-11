/**
 * NetWatch — تجمیع روزانه، Backfill، Retention و هرس دوره‌ای.
 */
import { dailyRollupGap, rollupDay as sharedRollupDay } from './rollup.js';
import { runRetention } from './retention.js';

const ROLLUP_EVERY_MS = 5 * 60 * 1000;
const PRUNE_CHUNK = 5000;
const PRUNE_MAX_PER_RUN = 50000;
const DAY_MS = 86400000;

/** شروع روز تقویمی محلی (بر پایهٔ اختلاف زمانی تنظیمات)، نه نیمه‌شب UTC */
export function localDayStart(ts, offsetMin = 0) {
  const off = (Number(offsetMin) || 0) * 60000;
  return Math.floor((ts + off) / DAY_MS) * DAY_MS - off;
}

export function rollupDay(dayStart, offsetMin = 0) {
  return sharedRollupDay(dayStart, offsetMin);
}

export function rollup({ getSettings, statements, noteInternalError, db, rollupDay: rollupOneDay }) {
  // روز جاری و روز قبل تجمیع می‌شوند؛ تجمیع روز قبل، وقفه‌های گذر از نیمه‌شب و دوره‌هایی
  // که موتور مستقل (engine-cli) به‌جای سرور اجرا می‌شده را جبران می‌کند.
  const offset = Number(getSettings().timezone_offset_minutes) || 0;
  const dayStart = localDayStart(Date.now(), offset);
  for (const start of [dayStart - DAY_MS, dayStart]) {
    try {
      rollupOneDay(start, offset);
    } catch (e) {
      noteInternalError(e, { phase: 'rollup' });
    }
  }
  try {
    const since = Date.now() - 24 * 3600 * 1000;
    const rows = statements.recompute.all(since);
    for (const r of rows) {
      const uptime = r.checks ? ((r.ok_count || 0) / r.checks) * 100 : 100;
      db.prepare('UPDATE devices SET uptime_pct=?, min_rtt_ms=?, max_rtt_ms=?, avg_rtt_ms=? WHERE id=?').run(
        Number(uptime.toFixed(2)),
        r.min_rtt == null ? null : Number(r.min_rtt),
        r.max_rtt == null ? null : Number(r.max_rtt),
        r.avg_rtt == null ? null : Number(Number(r.avg_rtt).toFixed(2)),
        r.device_id
      );
    }
  } catch (e) {
    noteInternalError(e, { phase: 'rollup-metrics' });
  }
}

/**
 * تجمیع روزهای گذشته‌ای که در daily_stats رکورد ندارند (حداکثر `limit` روز در هر شروع).
 * بدون این کار، بازه‌هایی که موتور خاموش بوده در جدول تجمیعی سوراخ می‌مانند.
 */
export function backfillDays({ getSettings, db, log, rollupDay: rollupOneDay }, limit = 7) {
  const offset = Number(getSettings().timezone_offset_minutes) || 0;
  const today = localDayStart(Date.now(), offset);
  let done = 0;
  // سه روز گذشته دوباره تجمیع می‌شوند: علاوه بر جاماندن در زمان خاموشی،
  // نسخه‌های قبلی آمار روزانه را با مرز نیمه‌شب UTC می‌ساختند.
  for (const t of [today - 3 * DAY_MS, today - 2 * DAY_MS, today - DAY_MS]) {
    rollupOneDay(t, offset);
    done++;
  }
  const oldest = db.prepare('SELECT MIN(ts) AS ts FROM samples').get()?.ts;
  if (!oldest) return done;
  let filled = 0;
  for (let t = localDayStart(oldest, offset); t < today - 3 * DAY_MS && filled < limit; t += DAY_MS) {
    // وجود یک ردیف برای روز کافی نیست؛ اگر فقط بعضی تجهیزها تجمیع شده باشند
    // بقیه برای همیشه دادهٔ روزانه‌شان را از دست می‌دادند (BUG-23).
    if (dailyRollupGap(t, offset) === 0) continue;
    rollupOneDay(t, offset);
    filled++;
  }
  if (filled) log('engine', `تجمیع روزهای جامانده انجام شد (${filled} روز).`);
  return done + filled;
}

/**
 * سازگاری با نسخه‌های قبلی/آزمون‌ها: هرس اکنون از مسیر Retention Engine
 * انجام می‌شود. سیاست صریح ورودی (s) برای آزمون‌های قدیمی به سیاست موقت
 * تبدیل می‌شود؛ هیچ مسیر دومی برای حذف وجود ندارد.
 */
export function cleanup({ noteInternalError }, s = {}) {
  try {
    const days = Number(s.retention_days);
    const override =
      Number.isFinite(days) && days > 0
        ? {
            samplesDays: days,
            outagesDays: days,
            alertsDays: days,
            dailyStatsDays: Math.max(365, days),
            auditDays: 365,
            engineLogDays: 14,
          }
        : {};
    return runRetention({ trigger: 'engine', actor: 'engine', policyOverride: override });
  } catch (e) {
    noteInternalError(e, { phase: 'cleanup' });
    return null;
  }
}

/** حذف تکه‌تکه تا یک حذف بزرگ، قفل نوشتن پایگاه‌داده را طولانی نکند */
export function pruneBatch(statement, cutoff, limit = PRUNE_MAX_PER_RUN) {
  let total = 0;
  while (total < limit) {
    const n = Number(statement.run(cutoff, PRUNE_CHUNK).changes || 0);
    total += n;
    if (n < PRUNE_CHUNK) break;
  }
  return total;
}

export { ROLLUP_EVERY_MS };
