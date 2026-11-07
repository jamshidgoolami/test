/**
 * تجمیع سری زمانی در «روزهای تقویمی» برای نمای تقویمی بازهٔ ۳۰ روزه.
 *
 * سری ۳۰ روزه با باکت ۶ ساعته از سرور می‌آید؛ برای خوانایی، میانگین هر روز
 * محاسبه می‌شود. همهٔ محاسبات این‌جا خالص و بدون وابستگی به React هستند تا
 * آزمون‌پذیر بمانند و رنگ/آستانه در یک نقطه تعریف شود.
 */
import { faDigits } from './format.ts';
import type { SeriesPoint } from './types';

export type ChartCalendar = 'jalali' | 'gregorian';
export type DailyMetric = 'latency' | 'loss';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export interface DailyPoint {
  /** کلید روز محلی: YYYY-M-D */
  key: string;
  /** ابتدای روز محلی بر حسب epoch */
  ts: number;
  /** ۰ = شنبه … ۶ = جمعه */
  weekday: number;
  dayLabel: string;
  monthLabel: string;
  title: string;
  /** میانگین متریک انتخاب‌شده؛ برای تأخیر ممکن است null باشد (بدون پاسخ) */
  value: number | null;
  avgRtt: number | null;
  maxRtt: number | null;
  avgLoss: number;
  availability: number | null;
  samples: number;
}

export interface DailySummary {
  avg: number | null;
  min: number | null;
  max: number | null;
  availability: number | null;
  /** تعداد بازه‌های بالای آستانه */
  over: number;
  total: number;
  samples: number;
}

export type CalendarTone = 'none' | 'good' | 'warn' | 'bad';

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

const FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatter(calendar: ChartCalendar, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${calendar}:${JSON.stringify(options)}`;
  let fmt = FORMAT_CACHE.get(key);
  if (!fmt) {
    const locale = calendar === 'gregorian' ? 'fa-IR-u-ca-gregory' : 'fa-IR-u-ca-persian';
    fmt = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options });
    FORMAT_CACHE.set(key, fmt);
  }
  return fmt;
}

function shifted(ts: number, tzOffset: number): Date {
  return new Date(ts + tzOffset * MINUTE_MS);
}

export function localDayStart(ts: number, tzOffset: number): number {
  return Math.floor((ts + tzOffset * MINUTE_MS) / DAY_MS) * DAY_MS - tzOffset * MINUTE_MS;
}

/** کلید روز محلی؛ با کلیدهایی که در `buildDailyCalendar` ساخته می‌شوند یکسان است. */
export function dateKeyLocal(ts: number, tzOffset: number): string {
  const d = shifted(ts, tzOffset);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

export function weekdayLocal(ts: number, tzOffset: number): number {
  return (shifted(ts, tzOffset).getUTCDay() + 1) % 7;
}

/**
 * ساخت روزهای تقویمی میانگین‌دار.
 *
 * روزهای بدون نمونه هم برگردانده می‌شوند تا شبکهٔ تقویم کامل بماند؛ خانهٔ آن‌ها
 * «بدون داده» است. میانگین‌ها بر اساس تعداد نمونهٔ هر باکت وزن‌دهی می‌شوند تا
 * یک باکت کم‌نمونه نتیجه را جابه‌جا نکند.
 */
export function buildDailyCalendar(
  points: SeriesPoint[],
  {
    metric,
    tzOffset,
    calendar,
    from,
    to,
  }: { metric: DailyMetric; tzOffset: number; calendar: ChartCalendar; from: number; to: number }
): DailyPoint[] {
  const start = localDayStart(from, tzOffset);
  const last = localDayStart(Math.max(from, to - 1), tzOffset);
  const count = Math.min(62, Math.max(1, Math.round((last - start) / DAY_MS) + 1));

  const buckets = new Map<
    number,
    { samples: number; rttSum: number; rttWeight: number; lossSum: number; lossWeight: number; availSum: number; maxRtt: number | null }
  >();

  for (const p of points) {
    if (!p || p.t < from || p.t >= to) continue;
    const dayStart = localDayStart(p.t, tzOffset);
    const b =
      buckets.get(dayStart) ??
      { samples: 0, rttSum: 0, rttWeight: 0, lossSum: 0, lossWeight: 0, availSum: 0, maxRtt: null };
    const weight = p.samples > 0 ? p.samples : 1;
    b.samples += p.samples;
    b.lossSum += p.loss * weight;
    b.lossWeight += weight;
    b.availSum += p.availability * weight;
    if (p.rtt != null) {
      b.rttSum += p.rtt * weight;
      b.rttWeight += weight;
    }
    const high = p.maxRtt ?? p.rtt;
    if (high != null) b.maxRtt = b.maxRtt == null ? high : Math.max(b.maxRtt, high);
    buckets.set(dayStart, b);
  }

  const out: DailyPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const ts = start + i * DAY_MS;
    const b = buckets.get(ts);
    const avgRtt = b && b.rttWeight ? round2(b.rttSum / b.rttWeight) : null;
    const avgLoss = b && b.lossWeight ? round1(b.lossSum / b.lossWeight) : 0;
    const availability = b && b.lossWeight ? round1(b.availSum / b.lossWeight) : null;
    const value = metric === 'latency' ? avgRtt : b && b.samples > 0 ? avgLoss : null;
    out.push({
      key: dateKeyLocal(ts, tzOffset),
      ts,
      weekday: weekdayLocal(ts, tzOffset),
      dayLabel: faDigits(formatter(calendar, { day: 'numeric' }).format(shifted(ts, tzOffset))),
      monthLabel: formatter(calendar, { month: 'short' }).format(shifted(ts, tzOffset)),
      title: formatter(calendar, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
        shifted(ts, tzOffset)
      ),
      value,
      avgRtt,
      maxRtt: b?.maxRtt ?? null,
      avgLoss,
      availability,
      samples: b?.samples ?? 0,
    });
  }
  return out;
}

/**
 * آمار یک‌نگاه‌کردنی بازه؛ همان اعدادی که بالای نمودار به‌صورت کاشی نشان داده
 * می‌شوند. میانگین‌ها با وزن تعداد نمونه محاسبه می‌شوند.
 */
export function summarizeSeries(
  points: SeriesPoint[],
  metric: DailyMetric,
  threshold?: number | null
): DailySummary {
  let weight = 0;
  let rttSum = 0;
  let rttWeight = 0;
  let lossSum = 0;
  let availSum = 0;
  let min: number | null = null;
  let max: number | null = null;
  let over = 0;
  let samples = 0;

  for (const p of points) {
    const w = p.samples > 0 ? p.samples : 1;
    weight += w;
    samples += p.samples;
    lossSum += p.loss * w;
    availSum += p.availability * w;
    if (p.rtt != null) {
      rttSum += p.rtt * w;
      rttWeight += w;
    }
    const low = p.minRtt ?? p.rtt;
    if (low != null) min = min == null ? low : Math.min(min, low);
    const high = p.maxRtt ?? p.rtt;
    if (high != null) max = max == null ? high : Math.max(max, high);
    if (threshold != null) {
      const breach = metric === 'latency' ? p.rtt != null && p.rtt > threshold : p.loss > threshold;
      if (breach) over += 1;
    }
  }

  const avg = metric === 'latency' ? (rttWeight ? rttSum / rttWeight : null) : weight ? lossSum / weight : null;
  return {
    avg: avg == null ? null : round2(avg),
    min: min == null ? null : round2(min),
    max: max == null ? null : round2(max),
    availability: weight ? round1(availSum / weight) : null,
    over,
    total: points.length,
    samples,
  };
}

/**
 * رنگ روز بر اساس فاصله از آستانه؛ صفر تا آستانه سالم، تا ۱٫۵ برابر (تأخیر)
 * یا ۲ برابر (افت) «نزدیک آستانه» و بالاتر از آن «بالای آستانه» است. روزی که
 * هیچ پاسخ موفقی نداشته، مستقل از میانگین، قرمز است.
 */
export function calendarTone(day: DailyPoint, metric: DailyMetric, threshold?: number | null): CalendarTone {
  if (day.samples === 0) return 'none';
  if (metric === 'latency' && day.avgRtt == null) return 'bad';
  const value = metric === 'latency' ? day.avgRtt : day.avgLoss;
  if (value == null) return 'none';
  if (threshold == null || threshold <= 0) return 'good';
  const ratio = value / threshold;
  if (ratio <= 1) return 'good';
  if (ratio <= (metric === 'latency' ? 1.5 : 2)) return 'warn';
  return 'bad';
}
