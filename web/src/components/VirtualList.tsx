import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * فهرست مجازی سبک بدون وابستگی بیرونی.
 *
 * برای فهرست‌های بزرگ (هزاران تجهیز/علامت) فقط ردیف‌های داخل نمای فعلی رندر
 * می‌شوند؛ گره‌های DOM و حافظه با تعداد آیتم‌ها رشد نمی‌کند. ارتفاع پیش‌فرض
 * ثابت است تا محاسبهٔ پنجره دقیق بماند؛ با `heightOf` می‌توان ردیف‌هایی با
 * ارتفاع متفاوت (مثل سرتیتر گروه) هم داشت — جمع تجمعی ارتفاع‌ها یک‌بار حساب
 * و با جست‌وجوی دودویی محل شروع پیدا می‌شود. Overscan کمی رندر می‌کند تا
 * اسکرول سریع، فضای خالی نشان ندهد.
 */
export function VirtualList<T>({
  items,
  itemHeight,
  heightOf,
  render,
  keyOf,
  overscan = 6,
  className = '',
  empty,
}: {
  items: T[];
  itemHeight: number;
  /** ارتفاع هر ردیف؛ اگر داده نشود `itemHeight` استفاده می‌شود. */
  heightOf?: (item: T, index: number) => number;
  render: (item: T, index: number) => React.ReactNode;
  keyOf: (item: T, index: number) => React.Key;
  overscan?: number;
  className?: string;
  empty?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(320);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || 320);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ارتفاع‌های تجمعی؛ برای فهرست ثابت یک‌بار محاسبه و برای فهرست متغیر هم
  // فقط با تغییر خود آیتم‌ها (نه با هر اسکرول) بازسازی می‌شود.
  const offsets = useMemo(() => {
    if (!heightOf) return null;
    const acc = new Float64Array(items.length + 1);
    for (let i = 0; i < items.length; i++) acc[i + 1] = acc[i] + Math.max(1, heightOf(items[i], i));
    return acc;
  }, [items, heightOf]);

  if (!items.length && empty) return <>{empty}</>;

  const total = offsets ? offsets[items.length] : items.length * itemHeight;
  let start: number;
  let end: number;
  if (offsets) {
    // نخستین ردیفی که انتهایش بعد از scrollTop است
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] <= scrollTop) lo = mid + 1;
      else hi = mid;
    }
    start = Math.max(0, lo - overscan);
    end = lo;
    while (end < items.length && offsets[end] < scrollTop + viewport) end++;
    end = Math.min(items.length, end + overscan);
  } else {
    start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    end = Math.min(items.length, Math.ceil((scrollTop + viewport) / itemHeight) + overscan);
  }
  const slice = items.slice(start, end);

  return (
    <div
      ref={ref}
      className={`min-h-0 overflow-y-auto pe-1 ${className}`}
      onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
      data-virtualized="true"
      data-total={items.length}
      data-rendered={slice.length}
    >
      <div style={{ height: total, position: 'relative' }}>
        <div style={{ position: 'absolute', top: offsets ? offsets[start] : start * itemHeight, left: 0, right: 0 }}>
          {slice.map((item, i) => {
            const index = start + i;
            return (
              <div key={keyOf(item, index)} style={offsets ? undefined : { height: itemHeight }}>
                {render(item, index)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default VirtualList;
