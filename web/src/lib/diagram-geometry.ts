/**
 * NetWatch — هندسهٔ خطوط ارتباط دیاگرام
 * ----------------------------------------------------------------
 * خط هر ارتباط بر اساس کادر واقعی دو جزء حساب می‌شود، نه لنگر ثابت چهار سمت.
 * نتیجه: کوتاه‌ترین پاره‌خط بین دو جزء؛ برای دو تجهیز هم‌راستا یک خط افقی (یا
 * عمودی) کوتاه و برای حالت مورب، نزدیک‌ترین لبه‌ها.
 */

export interface LinkRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LinkPoint {
  x: number;
  y: number;
}

/** نزدیک‌ترین نقطهٔ داخل/روی کادر به یک نقطهٔ بیرونی */
export function clampPoint(rect: LinkRect, point: LinkPoint): LinkPoint {
  return {
    x: Math.min(Math.max(point.x, rect.x), rect.x + rect.width),
    y: Math.min(Math.max(point.y, rect.y), rect.y + rect.height),
  };
}

/**
 * کوتاه‌ترین پاره‌خط بین دو کادر. نقطهٔ هر سر روی نزدیک‌ترین لبهٔ همان کادر
 * می‌نشیند و یک بار بازخورد گرفته می‌شود تا در حالت مورب هم سر خط روی گوشهٔ
 * درست بیفتد.
 */
export function shortestLink(a: LinkRect, b: LinkRect): { start: LinkPoint; end: LinkPoint } {
  const centerB = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  let start = clampPoint(a, centerB);
  const end = clampPoint(b, start);
  start = clampPoint(a, end);
  return { start, end };
}

/** مسیر SVG خط راست بین دو کادر (مختصات گردشده برای پرش نداشتن در زوم). */
export function shortestLinkPath(a: LinkRect, b: LinkRect): string {
  const { start, end } = shortestLink(a, b);
  return `M ${Math.round(start.x)} ${Math.round(start.y)} L ${Math.round(end.x)} ${Math.round(end.y)}`;
}
