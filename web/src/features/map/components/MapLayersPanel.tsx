import { Link } from 'react-router-dom';
import { Check, Layers, X } from 'lucide-react';
import type { MapLayer } from '../../../lib/types';
import { isVectorLayer } from '../lib/layers';
import { MapThumbnail } from './MapThumbnail';

export function MapLayersPanel({
  layers,
  center,
  zoom,
  onSelect,
  onClose,
}: {
  layers: MapLayer[];
  center: [number, number];
  zoom: number;
  onSelect: (layer: MapLayer) => void;
  onClose: () => void;
}) {
  // فقط نقشه‌های موجود (MBTiles) قابل انتخاب‌اند؛ در هر لحظه یک نقشه فعال است.
  const maps = layers.filter((l) => l.kind === 'mbtiles' && l.file_name);
  const active = maps.find((l) => l.visible) ?? null;

  return (
    <div
      id="map-layers-panel"
      className="pointer-events-auto w-[262px] max-w-[calc(100vw-4rem)] overflow-hidden rounded-2xl border border-ink-200/70 bg-surface/95 shadow-pop backdrop-blur-md"
      dir="rtl"
    >
      <div className="flex items-center justify-between gap-1 px-2.5 pt-2">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-700">
          <Layers size={13} className="text-accent" />
          لایه‌های نقشه
        </p>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="grid h-6 w-6 place-items-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-800"
            onClick={onClose}
            title="بستن پنل لایه‌ها"
            aria-label="بستن پنل لایه‌ها"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="px-2.5 pt-2">
        <MapThumbnail center={center} zoom={zoom} layers={layers} />
      </div>

      <div className="mt-1.5 max-h-[206px] space-y-0.5 overflow-y-auto px-1.5 py-1">
        {maps.length === 0 ? (
          <p className="px-1 py-3 text-center text-[10.5px] text-ink-400">نقشه‌ای بارگذاری نشده است</p>
        ) : (
          maps.map((l) => {
            const vector = isVectorLayer(l);
            const selected = !!l.visible;
            return (
              <button
                key={l.id}
                type="button"
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-right transition hover:bg-ink-50 ${
                  selected ? 'bg-brand-50/60' : ''
                }`}
                onClick={() => onSelect(l)}
                aria-pressed={selected}
                title={selected ? `نقشهٔ فعال: «${l.name}»` : `انتخاب «${l.name}»`}
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border transition ${
                    selected ? 'border-brand-500 bg-brand-500 text-white' : 'border-ink-300 bg-surface text-transparent'
                  }`}
                >
                  <Check size={10} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-medium text-ink-700">{l.name}</span>
                  <span className="block text-[9.5px] text-ink-400">
                    {vector ? 'برداری' : 'تصویری'}
                    {l.is_default ? ' · پیش‌فرض' : ''}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-ink-100 px-2.5 py-1.5">
        <span className="min-w-0 truncate text-[9.5px] text-ink-400">
          {active ? `نقشهٔ فعال: ${active.name}` : 'نقشه‌ای انتخاب نشده'}
        </span>
        <Link
          to="/settings?tab=layers"
          className="shrink-0 text-[10.5px] font-medium text-accent transition hover:text-accent"
        >
          مدیریت در تنظیمات
        </Link>
      </div>
    </div>
  );
}
