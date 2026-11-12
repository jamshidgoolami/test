import { useEffect } from 'react';
import L from 'leaflet';

import { LABEL_ANCHOR_LAYER } from '../../../lib/mapStyle';
import { escapeLabel, LABEL_ORDER, labelSize, labelVisible } from '../lib/mapLabels';
import type { GlFeature, GlMap } from '../model/vector';

/**
 * نام شهرها/استان‌ها را از کاشی برداری می‌خواند و به‌صورت HTML روی نقشه
 * می‌نویسد؛ فونت SDF محلی فقط برای برچسب خیابان‌ها در استایل MapLibre است.
 */
export function useMapLabels({
  mapRef,
  ready,
  vectorMaps,
  vectorMapsTick,
}: {
  mapRef: React.RefObject<L.Map | null>;
  ready: boolean;
  vectorMaps: React.RefObject<Map<number, GlMap>>;
  vectorMapsTick: number;
}) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || vectorMapsTick === 0) return;
    if (!map.getPane('nw-labels')) {
      const pane = map.createPane('nw-labels');
      pane.style.zIndex = '430';
      pane.style.pointerEvents = 'none';
    }
    const group = L.layerGroup([], { pane: 'nw-labels' } as L.LayerOptions).addTo(map);
    let timer = 0;
    let retries = 0;

    // پرس‌وجو تنها وقتی معنا دارد که استایل کامل بار شده و لایهٔ لنگر در آن باشد؛
    // وگرنه MapLibre خطای «لایه وجود ندارد» می‌دهد. تا آماده‌شدن، کوتاه‌مدت تکرار می‌شود.
    const isReady = (gl: GlMap) => {
      const g = gl as unknown as { isStyleLoaded?: () => boolean; getLayer?: (id: string) => unknown };
      if (g.isStyleLoaded && !g.isStyleLoaded()) return false;
      if (g.getLayer && !g.getLayer(LABEL_ANCHOR_LAYER)) return false;
      return true;
    };

    const draw = () => {
      const maps = [...vectorMaps.current.values()];
      if (!maps.length) return;
      if (!maps.every(isReady)) {
        if (retries++ < 40) timer = window.setTimeout(draw, 400);
        return;
      }
      retries = 0;
      const zoom = map.getZoom();
      const size = map.getSize();
      type Candidate = { name: string; cls: string; rank: number; lat: number; lng: number };
      const found = new Map<string, Candidate>();

      for (const gl of maps) {
        let features: GlFeature[] = [];
        try {
          features = gl.queryRenderedFeatures({ layers: [LABEL_ANCHOR_LAYER] }) ?? [];
        } catch {
          continue;
        }
        for (const feature of features) {
          const props = feature.properties ?? {};
          const cls = String(props.class ?? '');
          if (!labelVisible(cls, zoom)) continue;
          const name = String(props['name:fa'] || props.name || props['name:en'] || '').trim();
          if (!name) continue;
          const geom = feature.geometry;
          if (!geom || geom.type !== 'Point' || !Array.isArray(geom.coordinates)) continue;
          const [lng, lat] = geom.coordinates as [number, number];
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          const rank = Number(props.rank ?? 99);
          const key = `${cls}:${name}`;
          const prev = found.get(key);
          if (!prev || rank < prev.rank) found.set(key, { name, cls, rank, lat, lng });
        }
      }

      const candidates = [...found.values()].sort(
        (a, b) => (LABEL_ORDER[a.cls] ?? 9) - (LABEL_ORDER[b.cls] ?? 9) || a.rank - b.rank
      );

      group.clearLayers();
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      for (const c of candidates) {
        const fontSize = labelSize(c.cls, zoom);
        const width = c.name.length * fontSize * 0.62 + 6;
        const height = fontSize + 6;
        const point = map.latLngToContainerPoint([c.lat, c.lng]);
        if (point.x < -20 || point.y < -20 || point.x > size.x + 20 || point.y > size.y + 20) continue;
        const rect = { x: point.x - width / 2, y: point.y - height / 2, w: width, h: height };
        const collides = placed.some(
          (r) => Math.abs(r.x - rect.x) < (r.w + rect.w) / 2 + 2 && Math.abs(r.y - rect.y) < (r.h + rect.h) / 2 + 1
        );
        if (collides) continue;
        placed.push(rect);
        const strong = c.cls === 'country' || c.cls === 'continent';
        const muted = c.cls === 'state' || c.cls === 'province' || c.cls === 'suburb' || c.cls === 'neighbourhood' || c.cls === 'quarter';
        const style = [
          'position:absolute',
          'transform:translate(-50%,-50%)',
          'white-space:nowrap',
          `font-size:${fontSize}px`,
          `font-weight:${strong || c.cls === 'city' ? 700 : 500}`,
          `color:${muted ? '#5a6572' : '#2f3a45'}`,
          muted ? 'font-style:italic' : '',
          'text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff,0 0 4px #fff',
        ]
          .filter(Boolean)
          .join(';');
        L.marker([c.lat, c.lng], {
          pane: 'nw-labels',
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            // کلاس جدا از .nw-map-label نشانگرها، تا استایل جعبه‌ای آن‌ها روی
            // برچسب نقشه اعمال نشود.
            className: 'nw-place-label',
            html: `<span dir="auto" style="${style}">${escapeLabel(c.name)}</span>`,
            iconSize: [0, 0],
          }),
        }).addTo(group);
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(draw, 160);
    };
    const maps = [...vectorMaps.current.values()];
    for (const gl of maps) {
      gl.on('idle', schedule);
      gl.on('moveend', schedule);
    }
    schedule();
    return () => {
      window.clearTimeout(timer);
      for (const gl of maps) {
        gl.off('idle', schedule);
        gl.off('moveend', schedule);
      }
      group.remove();
    };
  }, [ready, vectorMapsTick, mapRef, vectorMaps]);
}
