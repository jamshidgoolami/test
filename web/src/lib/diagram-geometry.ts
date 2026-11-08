/**
 * NetWatch — هندسهٔ خطوط ارتباط دیاگرام
 * ----------------------------------------------------------------
 * خط هر ارتباط از کادر واقعی دو جزء ساخته می‌شود، نه از لنگر ثابت چهار سمت:
 *
 *   • اگر دو جزء بیشتر افقی از هم دور باشند، خط از **مرکز ضلع روبه‌رو**ی
 *     تجهیز اول به مرکز ضلع روبه‌روی تجهیز دوم می‌رود (نه از گوشه‌ها).
 *   • اگر بیشتر عمودی باشند، همان قاعده روی ضلع بالا/پایین اعمال می‌شود.
 *   • برای دو تجهیز هم‌راستا خط کاملاً صاف است (کوتاه‌ترین مسیر)، و در حالت
 *     مورب یک خم ملایم S شکل می‌گیرد تا خط تیز و «کشیده» دیده نشود.
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

export interface LinkGeometry {
  start: LinkPoint;
  end: LinkPoint;
  axis: 'x' | 'y';
  path: string;
}

function center(rect: LinkRect): LinkPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function straightPath(start: LinkPoint, end: LinkPoint): string {
  return `M ${round(start.x)} ${round(start.y)} L ${round(end.x)} ${round(end.y)}`;
}

/**
 * کوتاه‌ترین پاره‌خط قدیمی (فقط به‌عنوان جایگزین امن وقتی کادرها روی هم
 * می‌افتند استفاده می‌شود).
 */
function clampedSegment(a: LinkRect, b: LinkRect): { start: LinkPoint; end: LinkPoint } {
  const clamp = (rect: LinkRect, point: LinkPoint): LinkPoint => ({
    x: Math.min(Math.max(point.x, rect.x), rect.x + rect.width),
    y: Math.min(Math.max(point.y, rect.y), rect.y + rect.height),
  });
  const start = clamp(a, center(b));
  const end = clamp(b, start);
  return { start, end };
}

/**
 * محاسبهٔ نقطهٔ شروع/پایان و مسیر SVG ارتباط.
 *
 * @param a کادر مبدأ
 * @param b کادر مقصد
 */
export function computeLink(a: LinkRect, b: LinkRect): LinkGeometry {
  const ca = center(a);
  const cb = center(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  let axis: 'x' | 'y' = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';

  const anchors = (mode: 'x' | 'y'): { start: LinkPoint; end: LinkPoint } => {
    if (mode === 'x') {
      const rightwards = dx >= 0;
      return {
        start: { x: rightwards ? a.x + a.width : a.x, y: ca.y },
        end: { x: rightwards ? b.x : b.x + b.width, y: cb.y },
      };
    }
    const downwards = dy >= 0;
    return {
      start: { x: ca.x, y: downwards ? a.y + a.height : a.y },
      end: { x: cb.x, y: downwards ? b.y : b.y + b.height },
    };
  };

  // ضلع‌های انتخاب‌شده باید واقعاً «روبه‌روی» هم باشند؛ در کادرهای هم‌پوشان
  // ممکن است ضلع نزدیک مقصد پشت ضلع مبدأ بیفتد و خط به عقب برگردد.
  const facing = (segment: { start: LinkPoint; end: LinkPoint }, mode: 'x' | 'y') =>
    mode === 'x' ? Math.sign(segment.end.x - segment.start.x) === Math.sign(dx) || Math.abs(dx) < 2
                 : Math.sign(segment.end.y - segment.start.y) === Math.sign(dy) || Math.abs(dy) < 2;

  let { start, end } = anchors(axis);
  if (!facing({ start, end }, axis)) {
    const other: 'x' | 'y' = axis === 'x' ? 'y' : 'x';
    const alt = anchors(other);
    if (facing(alt, other)) {
      axis = other;
      ({ start, end } = alt);
    } else {
      // کاملاً روی هم افتاده‌اند: یک پاره‌خط کوتاه و امن کافی است.
      const fallback = clampedSegment(a, b);
      return { ...fallback, axis, path: straightPath(fallback.start, fallback.end) };
    }
  }

  const along = axis === 'x' ? end.x - start.x : end.y - start.y;
  const cross = axis === 'x' ? Math.abs(end.y - start.y) : Math.abs(end.x - start.x);

  // هم‌راستا: خط صاف، کوتاه‌ترین و خوانا.
  if (cross < 3) {
    return { start, end, axis, path: straightPath(start, end) };
  }

  const direction = along >= 0 ? 1 : -1;
  // خم ملایم: کنترل‌ها در امتداد محور حرکت می‌کنند تا خط از لبه‌ها عمود خارج شود.
  const bend = Math.min(160, Math.max(18, Math.abs(along) * 0.45));
  const c1 = axis === 'x' ? { x: start.x + direction * bend, y: start.y } : { x: start.x, y: start.y + direction * bend };
  const c2 = axis === 'x' ? { x: end.x - direction * bend, y: end.y } : { x: end.x, y: end.y - direction * bend };

  return {
    start,
    end,
    axis,
    path: `M ${round(start.x)} ${round(start.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(end.x)} ${round(end.y)}`,
  };
}

/** مسیر SVG فقط (برای مصرف‌کننده‌هایی که به نقاط نیاز ندارند). */
export function connectionPath(a: LinkRect, b: LinkRect): string {
  return computeLink(a, b).path;
}
