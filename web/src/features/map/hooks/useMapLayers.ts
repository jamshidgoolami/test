import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

import { buildVectorStyle } from '../../../lib/mapStyle';
import type { MapLayer } from '../../../lib/types';
import { createRasterLayer, isVectorLayer } from '../lib/layers';
import type { GlMap } from '../model/vector';

// آدرس فایل Worker مپ‌لیبر به‌صورت دارایی ساخته‌شده (نه مسیر نسبی داخل بستهٔ
// کتابخانه) — بدون این، MapLibre داخل باندل Vite فایل worker را پیدا نمی‌کند
// و با خطای «Worker failed to load» هیچ کاشی برداری رسم نمی‌شود.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

/* ------------------------ لایه پایه آفلاین ------------------------ */
const OfflineGridLayer = L.GridLayer.extend({
  createTile(this: L.GridLayer, coords: L.Coords) {
    const tile = document.createElement('div');
    const size = this.getTileSize();
    tile.style.width = `${size.x}px`;
    tile.style.height = `${size.y}px`;
    tile.style.background = '#f2f6fb';
    tile.style.boxShadow = 'inset 0 0 0 1px rgba(148,163,184,0.18)';
    tile.style.position = 'relative';
    const scale = Math.pow(2, coords.z);
    const lon = (coords.x / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * coords.y) / scale;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    const label = document.createElement('span');
    label.textContent = `${lat.toFixed(1)}° , ${lon.toFixed(1)}°`;
    label.style.cssText =
      'position:absolute;top:6px;left:8px;font-size:10px;color:#94a3b8;font-family:Vazirmatn,Tahoma,sans-serif;direction:ltr';
    tile.appendChild(label);
    if (coords.z >= 6 && (coords.x + coords.y) % 2 === 0) {
      const cross = document.createElement('span');
      cross.style.cssText =
        'position:absolute;inset:0;background-image:linear-gradient(to right,rgba(148,163,184,0.12) 1px,transparent 1px),linear-gradient(to bottom,rgba(148,163,184,0.12) 1px,transparent 1px);background-size:28px 28px';
      tile.appendChild(cross);
    }
    return tile;
  },
}) as unknown as new (options?: L.GridLayerOptions) => L.GridLayer;

/**
 * فعال/غیرفعال کردن لایه‌های پایه و نگه‌داشتن نمونه‌های Leaflet/MapLibre.
 * tileLayers از بیرون می‌آید تا پاک‌سازی نقشه هنگام unmount همچنان نمونه‌های
 * قدیمی را رها نکند.
 */
export function useMapLayers({
  mapRef,
  ready,
  layers,
  tileLayers,
  notify,
}: {
  mapRef: React.RefObject<L.Map | null>;
  ready: boolean;
  layers: MapLayer[];
  tileLayers: React.RefObject<Record<number, L.Layer>>;
  notify: (message: string, tone: 'error') => void;
}) {
  const vectorMaps = useRef<Map<number, GlMap>>(new Map());
  const [vectorMapsTick, setVectorMapsTick] = useState(0);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let alive = true;
    const wanted = new Set<number>();
    const ensure = async () => {
      for (const layer of layers) {
        if (!layer.visible) continue;
        wanted.add(layer.id);
        if (tileLayers.current[layer.id]) continue;
        let instance: L.Layer | null = null;
        if (layer.kind === 'mbtiles' && layer.file_name) {
          if (isVectorLayer(layer)) {
            // کاشی‌های PBF/MVT با MapLibre GL JS رندر می‌شوند، نه Leaflet تصویری.
            try {
              // مسیر Worker باید پیش از ساخت نقشه تنظیم شود؛ وگرنه MapLibre
              // آدرس پیش‌فرضِ داخل باندل را می‌گیرد که وجود ندارد.
              const maplibre = await import('maplibre-gl');
              maplibre.setWorkerUrl(maplibreWorkerUrl);
              await import('@maplibre/maplibre-gl-leaflet');
              const factory = (L as unknown as { maplibreGL?: (o: Record<string, unknown>) => L.Layer }).maplibreGL;
              if (factory) {
                instance = factory({
                  style: buildVectorStyle(layer),
                  attributionControl: false,
                  interactive: false,
                  refreshExpiredTiles: false,
                });
              }
            } catch {
              notify(`لایهٔ برداری «${layer.name}» بارگذاری نشد`, 'error');
            }
          } else {
            // کاشی‌های تصویری (PNG/JPEG/WebP) با TileLayer سفارشی MBTiles.
            instance = createRasterLayer(layer);
          }
        } else {
          instance = new OfflineGridLayer({ tileSize: 256, minZoom: 0, maxZoom: 20 });
        }
        if (instance && alive && mapRef.current === map) {
          instance.addTo(map);
          tileLayers.current[layer.id] = instance;
          if (isVectorLayer(layer)) {
            const gl = (instance as unknown as { getMaplibreMap?: () => GlMap }).getMaplibreMap?.();
            if (gl) {
              vectorMaps.current.set(layer.id, gl);
              setVectorMapsTick((t) => t + 1);
            }
          }
        }
      }
      if (!alive) return;
      for (const [id, instance] of Object.entries(tileLayers.current)) {
        if (!wanted.has(Number(id))) {
          map.removeLayer(instance);
          vectorMaps.current.delete(Number(id));
          delete tileLayers.current[Number(id)];
        }
      }
      for (const layer of layers.filter((l) => l.visible)) {
        const inst = tileLayers.current[layer.id] as L.GridLayer | undefined;
        if (inst && typeof inst.bringToBack === 'function') inst.bringToBack();
      }
    };
    ensure();
    return () => {
      alive = false;
    };
  }, [layers, ready, notify, tileLayers, mapRef]);

  return { vectorMaps, vectorMapsTick };
}
