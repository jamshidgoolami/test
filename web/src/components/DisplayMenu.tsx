import { useEffect, useRef, useState } from 'react';
import { Check, Monitor, Presentation } from 'lucide-react';
import { DENSITY_HINT, DENSITY_LABEL, setDisplay, useDisplay, type Density } from '../lib/display';

const ORDER: Density[] = ['compact', 'comfortable', 'large'];

/**
 * انتخاب چگالی نمایش و حالت نمایش/NOC.
 *
 * این تنظیم برخلاف تم، به ازای هر دستگاه ذخیره می‌شود؛ لپ‌تاپ و نمایشگر دیواری
 * هر کدام ترجیح خودشان را نگه می‌دارند.
 */
export default function DisplayMenu() {
  const { density, present } = useDisplay();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="btn-ghost btn-xs"
        onClick={() => setOpen((value) => !value)}
        aria-label="اندازه و حالت نمایش"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`اندازهٔ نمایش: ${DENSITY_LABEL[density]}${present ? ' · حالت نمایش' : ''}`}
      >
        <Monitor size={16} />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="اندازه و حالت نمایش"
          className="absolute left-0 z-[950] mt-2 w-[268px] animate-fade-up rounded-card border border-ink-200 bg-surface p-3 shadow-pop"
        >
          <p className="text-[12px] font-semibold text-ink-700">اندازهٔ نمایش</p>
          <p className="mt-0.5 text-[10.5px] text-ink-400">فقط برای همین مرورگر ذخیره می‌شود.</p>

          <div className="mt-2 grid gap-1" role="group" aria-label="چگالی نمایش">
            {ORDER.map((option) => {
              const active = density === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDisplay({ density: option })}
                  className={`flex items-start gap-2 rounded-soft border px-2.5 py-2 text-right transition ${
                    active ? 'border-brand-200 bg-brand-50 text-accent' : 'border-ink-200 bg-surface text-ink-600 hover:border-ink-300'
                  }`}
                >
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center">
                    {active ? <Check size={13} /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium">{DENSITY_LABEL[option]}</span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-ink-400">{DENSITY_HINT[option]}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 border-t border-ink-100 pt-3">
            <button
              type="button"
              onClick={() => setDisplay({ present: !present })}
              aria-pressed={present}
              className={`flex w-full items-center justify-between gap-2 rounded-soft border px-2.5 py-2 text-[12px] transition ${
                present ? 'border-brand-200 bg-brand-50 text-accent' : 'border-ink-200 text-ink-600 hover:border-ink-300'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Presentation size={14} />
                حالت نمایش (NOC)
              </span>
              <span className={`h-4 w-8 rounded-pill p-0.5 transition ${present ? 'bg-brand-500' : 'bg-ink-200'}`} aria-hidden>
                <span className={`block h-3 w-3 rounded-full bg-white transition ${present ? 'translate-x-0' : 'translate-x-4'}`} />
              </span>
            </button>
            <p className="mt-1.5 text-[10px] leading-4 text-ink-400">
              منو، هدر و فوتر مخفی می‌شوند و صفحه‌ها هر ۴۵ ثانیه بین داشبورد، نقشه، سرورها و هشدارها می‌چرخند.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
