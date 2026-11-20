import { useEffect, useState } from 'react';

function clampHeight(min: number, ratio: number, max: number) {
  if (typeof window === 'undefined') return min;
  return Math.round(Math.min(max, Math.max(min, window.innerHeight * ratio)));
}

/**
 * ارتفاع نمودار متناسب با ارتفاع نمایشگر، محدود به ۲۲۰ تا ۳۸۰ پیکسل.
 *
 * ارتفاع ثابت ۲۰۰–۲۶۰ پیکسلی روی نمایشگرهای بلند کم‌جزئیات دیده می‌شد و روی
 * نمایشگر کوتاه هم فضای گران می‌گرفت؛ این قلاب ارتفاع را با پنجره هم‌گام
 * می‌کند و در هر دو سو مرز دارد تا نمودار از حالت خوانا خارج نشود.
 */
export function useChartHeight(min = 220, ratio = 0.26, max = 380) {
  const [height, setHeight] = useState(() => clampHeight(min, ratio, max));

  useEffect(() => {
    const update = () => setHeight((current) => {
      const next = clampHeight(min, ratio, max);
      return Math.abs(current - next) > 1 ? next : current;
    });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [min, ratio, max]);

  return height;
}

/**
 * آیا اشاره‌گر اصلی دستگاه لمسی/قلم است؟
 *
 * روی نمایشگر لمسی، Tooltip باید با تپ باز بماند؛ روی موس، hover طبیعی است.
 */
export function useCoarsePointer() {
  const [coarse, setCoarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  );

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return coarse;
}
