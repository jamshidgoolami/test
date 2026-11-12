import type { ReactNode } from 'react';
import { Circle, Flag, Ruler, Square, Trash2, X } from 'lucide-react';

import { faDigits } from '../../../lib/format';
import { fmtAreaM2, fmtDistanceM } from '../lib/measurement';
import type { MeasureMode, MeasureReadout } from '../lib/measurement';

const MEASURE_META: { mode: Exclude<MeasureMode, 'off'>; label: string; icon: ReactNode; color: string }[] = [
  { mode: 'distance', label: 'مسافت', icon: <Ruler size={12} />, color: '#2563eb' },
  { mode: 'area', label: 'مساحت', icon: <Square size={12} />, color: '#7c3aed' },
  { mode: 'radius', label: 'شعاع', icon: <Circle size={12} />, color: '#0f766e' },
];

export function MapMeasurePanel({
  mode,
  readout,
  canFinish,
  onStart,
  onFinish,
  onClear,
  onClose,
}: {
  mode: MeasureMode;
  readout: MeasureReadout | null;
  canFinish: boolean;
  onStart: (mode: Exclude<MeasureMode, 'off'>) => void;
  onFinish: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="pointer-events-auto w-[258px] max-w-[calc(100vw-4rem)] rounded-card border border-ink-200/70 bg-surface/95 p-2.5 shadow-pop backdrop-blur"
      dir="rtl"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[11.5px] font-semibold text-ink-700">
          <Ruler size={13} className="text-accent" />
          اندازه‌گیری روی نقشه
        </p>
        <button
          type="button"
          className="grid h-6 w-6 place-items-center rounded-md text-ink-400 hover:bg-ink-50 hover:text-ink-700"
          onClick={onClose}
          aria-label="بستن ابزار اندازه‌گیری"
        >
          <X size={13} />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1" role="group" aria-label="ابزار اندازه‌گیری">
        {MEASURE_META.map((item) => (
          <button
            key={item.mode}
            type="button"
            onClick={() => onStart(item.mode)}
            aria-pressed={mode === item.mode}
            className={`inline-flex items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-[11px] font-medium transition ${
              mode === item.mode ? 'text-white' : 'border-ink-200 bg-surface text-ink-600 hover:border-brand-200'
            }`}
            style={mode === item.mode ? { background: item.color, borderColor: item.color } : undefined}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-2 rounded-soft border border-ink-100 bg-ink-50/60 p-2 text-[11px] text-ink-600">
        {readout ? (
          <div className="space-y-0.5">
            {readout.kind === 'distance' ? (
              <>
                <p>
                  طول کل: <span className="num font-semibold text-ink-800">{fmtDistanceM(readout.lengthM)}</span>
                </p>
                <p className="num text-[10px] text-ink-400">
                  {faDigits(readout.points)} نقطه · {faDigits(readout.segments.length)} قطعه
                </p>
              </>
            ) : readout.kind === 'area' ? (
              <>
                <p>
                  مساحت: <span className="num font-semibold text-ink-800">{fmtAreaM2(readout.areaM2)}</span>
                </p>
                <p>
                  محیط: <span className="num text-ink-700">{readout.perimeterM != null ? fmtDistanceM(readout.perimeterM) : '—'}</span>
                </p>
                <p className="num text-[10px] text-ink-400">
                  {faDigits(readout.points)} نقطه · {faDigits(readout.segments.length)} ضلع
                </p>
              </>
            ) : (
              <>
                <p>
                  شعاع: <span className="num font-semibold text-ink-800">{fmtDistanceM(readout.radiusM ?? 0)}</span>
                </p>
                <p>
                  مساحت دایره: <span className="num text-ink-700">{fmtAreaM2(readout.areaM2)}</span>
                </p>
                <p>
                  محیط: <span className="num text-ink-700">{fmtDistanceM(readout.perimeterM ?? 0)}</span>
                </p>
              </>
            )}
          </div>
        ) : (
          <p>
            {mode === 'distance'
              ? 'نقطه‌های مسیر را یکی‌یکی روی نقشه کلیک کنید.'
              : mode === 'area'
                ? 'نقطه‌های محیط زمین را کلیک کنید؛ از سه نقطه به بعد مساحت محاسبه می‌شود.'
                : mode === 'radius'
                  ? 'ابتدا مرکز دایره و سپس لبهٔ آن را کلیک کنید.'
                  : 'مسافت، مساحت یا شعاع را انتخاب کنید.'}
          </p>
        )}
        {mode !== 'off' ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <button
              type="button"
              className="btn-primary btn-xs"
              onClick={onFinish}
              disabled={!canFinish}
              title="بستن ترسیم و نگه داشتن نتیجه (Enter)"
            >
              <Flag size={11} />
              پایان ترسیم
            </button>
            <button type="button" className="btn-ghost btn-xs" onClick={onClear}>
              <Trash2 size={11} />
              پاک کردن
            </button>
          </div>
        ) : readout ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="rounded-pill bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-success">
              پایان‌یافته
            </span>
            <button type="button" className="btn-ghost btn-xs" onClick={onClear}>
              <Trash2 size={11} />
              پاک کردن
            </button>
          </div>
        ) : null}
        <p className="mt-1 text-[9.5px] leading-4 text-ink-400">
          کلیک: نقطه · Enter یا «پایان ترسیم»: بستن رسم · راست‌کلیک: حذف نقطه · Esc: پاک کردن · نتیجه ذخیره
          نمی‌شود
        </p>
      </div>
    </div>
  );
}
