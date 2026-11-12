import { Check, Crosshair, HelpCircle, Save } from 'lucide-react';

import { faDigits } from '../../../lib/format';
import type { ArmedMarkerType, PendingMapPosition } from '../model/types';

export function MapEditBanner({
  armedType,
  editing,
  pending,
  placingDevice,
  moveHelpOpen,
  saving,
  onCancelArmed,
  onToggleHelp,
  onStopEditing,
  onCancelPending,
  onSavePosition,
}: {
  armedType: ArmedMarkerType | null;
  editing: boolean;
  pending: PendingMapPosition | null;
  placingDevice: number | null;
  moveHelpOpen: boolean;
  saving: boolean;
  onCancelArmed: () => void;
  onToggleHelp: () => void;
  onStopEditing: () => void;
  onCancelPending: () => void;
  onSavePosition: () => void;
}) {
  if (!armedType && !editing && !pending) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[900] flex flex-col items-center gap-2 px-3" dir="rtl">
      {armedType ? (
        <div className="animate-fade-up pointer-events-auto flex max-w-full items-center gap-2 rounded-pill border border-brand-200 bg-surface/97 py-1.5 pe-2 ps-3 shadow-pop backdrop-blur">
          <Crosshair size={14} className="shrink-0 text-accent" />
          <span className="text-[12px] text-ink-700">برای جانمایی علامت روی نقشه کلیک کنید.</span>
          <button type="button" className="btn-ghost btn-xs shrink-0" onClick={onCancelArmed}>
            انصراف
          </button>
        </div>
      ) : null}

      {editing ? (
        <div className="animate-fade-up pointer-events-auto relative flex max-w-full items-center gap-2 rounded-pill border border-sun-200 bg-surface/97 py-1.5 pe-2 ps-3 shadow-pop backdrop-blur">
          <Crosshair size={14} className="shrink-0 text-warning" />
          <span className="text-[12px] text-ink-700">
            حالت جابه‌جایی فعال است
            {placingDevice ? (
              <span className="ms-1 font-semibold text-warning">— در انتظار انتخاب محل جدید برای تجهیز #{faDigits(placingDevice)}</span>
            ) : null}
          </span>
          <button
            type="button"
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-full transition ${
              moveHelpOpen ? 'bg-brand-50 text-accent' : 'text-ink-400 hover:bg-ink-50 hover:text-ink-700'
            }`}
            onClick={onToggleHelp}
            aria-label="راهنمای حالت جابه‌جایی"
            title="راهنمای حالت جابه‌جایی"
            aria-expanded={moveHelpOpen}
            aria-pressed={moveHelpOpen}
          >
            <HelpCircle size={14} />
          </button>
          <button
            type="button"
            className="btn-warn btn-xs shrink-0"
            onClick={onStopEditing}
            title="پایان حالت جابه‌جایی"
          >
            <Check size={12} />
            پایان
          </button>
          {moveHelpOpen ? (
            <div
              className="absolute bottom-full end-0 mb-2 w-[300px] max-w-[calc(100vw-2rem)] rounded-card border border-ink-200 bg-surface p-3 text-[11.5px] leading-5 text-ink-600 shadow-pop"
              role="dialog"
              aria-label="راهنمای حالت جابه‌جایی"
            >
              نشانگر تجهیز، ایستگاه یا علامت را بگیرید و بکشید. برای تجهیز می‌توانید روی نشانگر کلیک کنید و
              محل جدید را روی نقشه انتخاب کنید، یا آن را از فهرست بکشید و روی نقشه رها کنید. جابه‌جایی هر
              تجهیز عضو ایستگاه، کل ایستگاه را به همان نقطه می‌برد.
            </div>
          ) : null}
        </div>
      ) : null}

      {pending ? (
        <div className="animate-fade-up pointer-events-auto flex w-full max-w-lg items-center justify-between gap-3 rounded-soft border border-brand-200 bg-surface/97 p-3 shadow-pop backdrop-blur">
          <span className="text-[12px] text-ink-600">
            موقعیت جدید: <span className="num font-semibold">{pending.latitude}, {pending.longitude}</span>
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost btn-xs" onClick={onCancelPending}>
              انصراف
            </button>
            <button type="button" className="btn-primary btn-xs" disabled={saving} onClick={onSavePosition}>
              <Save size={13} />
              {saving ? 'در حال ذخیره…' : 'ذخیره موقعیت'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
