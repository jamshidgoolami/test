/**
 * آزمون تجمیع روزانهٔ نمودارهای تاریخی: میانگین وزن‌دار، روزهای بدون داده و
 * قاعدهٔ رنگ/آستانه. اگر این‌ها درست باشند، نمای تقویمی ۳۰ روزه قابل اعتماد است.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDailyCalendar,
  calendarTone,
  dateKeyLocal,
  summarizeSeries,
  weekdayLocal,
} from '../src/lib/chart-daily.ts';
import type { SeriesPoint } from '../src/lib/types.ts';

const TZ = 210; // UTC+03:30
const HOUR = 3_600_000;
const DAY = 86_400_000;
const BASE = Date.UTC(2026, 0, 5) - TZ * 60_000; // ابتدای روز محلی ۵ ژانویه ۲۰۲۶

function point(t: number, overrides: Partial<SeriesPoint> = {}): SeriesPoint {
  return {
    t,
    rtt: 40,
    minRtt: 35,
    maxRtt: 55,
    loss: 0,
    availability: 100,
    samples: 10,
    ok: 10,
    down: 0,
    status: 'online',
    ...overrides,
  };
}

test('میانگین هر روز بر اساس تعداد نمونه وزن‌دهی می‌شود', () => {
  const days = buildDailyCalendar(
    [point(BASE + HOUR, { rtt: 20, samples: 10 }), point(BASE + 2 * HOUR, { rtt: 40, samples: 30 })],
    { metric: 'latency', tzOffset: TZ, calendar: 'jalali', from: BASE, to: BASE + DAY }
  );
  assert.equal(days.length, 1);
  assert.equal(days[0].value, 35);
  assert.equal(days[0].samples, 40);
  assert.equal(days[0].availability, 100);
  assert.equal(days[0].maxRtt, 55);
});

test('روزهای بدون نمونه هم در تقویم می‌مانند', () => {
  const days = buildDailyCalendar([], {
    metric: 'loss',
    tzOffset: TZ,
    calendar: 'jalali',
    from: BASE,
    to: BASE + 30 * DAY,
  });
  assert.equal(days.length, 30);
  assert.ok(days.every((d) => d.samples === 0 && d.value === null));
  assert.equal(calendarTone(days[0], 'loss', 5), 'none');
});

test('روزِ فقط قطعی برای تأخیر «بالای آستانه» است و افت ۱۰۰٪ دارد', () => {
  const days = buildDailyCalendar(
    [point(BASE + HOUR, { rtt: null, minRtt: null, maxRtt: null, loss: 100, availability: 0, samples: 5, ok: 0, down: 5, status: 'offline' })],
    { metric: 'latency', tzOffset: TZ, calendar: 'jalali', from: BASE, to: BASE + DAY }
  );
  assert.equal(days[0].avgRtt, null);
  assert.equal(days[0].avgLoss, 100);
  assert.equal(days[0].availability, 0);
  assert.equal(calendarTone(days[0], 'latency', 100), 'bad');
});

test('قاعدهٔ آستانه: سالم، نزدیک آستانه و بالای آستانه', () => {
  const [day] = buildDailyCalendar([point(BASE + HOUR, { rtt: 90 })], {
    metric: 'latency',
    tzOffset: TZ,
    calendar: 'jalali',
    from: BASE,
    to: BASE + DAY,
  });
  assert.equal(calendarTone(day, 'latency', 100), 'good');
  assert.equal(calendarTone({ ...day, avgRtt: 120, value: 120 }, 'latency', 100), 'warn');
  assert.equal(calendarTone({ ...day, avgRtt: 200, value: 200 }, 'latency', 100), 'bad');
  assert.equal(calendarTone({ ...day, avgLoss: 8, value: 8 }, 'loss', 5), 'warn');
  assert.equal(calendarTone({ ...day, avgLoss: 12, value: 12 }, 'loss', 5), 'bad');
});

test('آمار بازه: میانگین، کمینه/بیشینه و تعداد بازه‌های بالای آستانه', () => {
  const stats = summarizeSeries(
    [point(BASE, { rtt: 20, minRtt: 10, maxRtt: 30 }), point(BASE + HOUR, { rtt: 140, minRtt: 120, maxRtt: 200 })],
    'latency',
    100
  );
  assert.equal(stats.avg, 80);
  assert.equal(stats.min, 10);
  assert.equal(stats.max, 200);
  assert.equal(stats.over, 1);
  assert.equal(stats.total, 2);
  assert.equal(stats.availability, 100);
});

test('ابتدای روز و روز هفته در منطقهٔ زمانی تنظیمات محاسبه می‌شوند', () => {
  assert.equal(dateKeyLocal(BASE, TZ), '2026-1-5');
  assert.equal(weekdayLocal(BASE, TZ), 2); // دوشنبه
  assert.equal(dateKeyLocal(BASE - 1, TZ), '2026-1-4');
});
