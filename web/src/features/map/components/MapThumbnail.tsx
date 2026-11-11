import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { MapLayer } from '../../../lib/types';
import { createRasterLayer, isVectorLayer } from '../lib/layers';

export function MapThumbnail({ center, zoom, layers }: { center: [number, number]; zoom: number; layers: MapLayer[] }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const miniRef = useRef<L.Map | null>(null);
  const added = useRef<Map<number, L.Layer>>(new Map());

  useEffect(() => {
    const host = hostRef.current;
    if (!host || miniRef.current) return;
    const mini = L.map(host, {
      center,
      zoom,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      zoomSnap: 0,
      zoomAnimation: false,
      fadeAnimation: false,
    });
    miniRef.current = mini;
    // پنل تازه باز شده؛ اندازهٔ ظرف باید یک‌بار خوانده شود وگرنه کاشی‌ها نمی‌آیند.
    const timer = window.setTimeout(() => mini.invalidateSize(), 60);
    return () => {
      window.clearTimeout(timer);
      mini.remove();
      miniRef.current = null;
      added.current.clear();
    };
    // نمای اولیه فقط یک‌بار لازم است؛ تغییرات بعدی در افکت پایین اعمال می‌شوند.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    miniRef.current?.setView(center, zoom, { animate: false });
  }, [center, zoom]);

  useEffect(() => {
    const mini = miniRef.current;
    if (!mini) return;
    const wanted = new Set<number>();
    for (const layer of layers) {
      if (!layer.visible || layer.kind !== 'mbtiles' || isVectorLayer(layer)) continue;
      wanted.add(layer.id);
      if (added.current.has(layer.id)) continue;
      added.current.set(layer.id, createRasterLayer(layer).addTo(mini));
    }
    // لایه‌ای که از پنل مخفی شد باید از نمای بندانگشتی هم برداشته شود.
    for (const [id, instance] of [...added.current]) {
      if (wanted.has(id)) continue;
      mini.removeLayer(instance);
      added.current.delete(id);
    }
  }, [layers]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-ink-200/70 bg-ink-50">
      <div ref={hostRef} className="h-[92px] w-full" />
      <span className="pointer-events-none absolute inset-0 grid place-items-center">
        <span className="h-3.5 w-3.5 rounded-full border-2 border-brand-600 bg-surface/70 shadow" />
      </span>
      <span className="pointer-events-none absolute bottom-1 start-1 rounded-md bg-surface/85 px-1.5 py-0.5 text-[9.5px] font-medium text-ink-500 backdrop-blur">
        نمای فعلی نقشه
      </span>
    </div>
  );
}
