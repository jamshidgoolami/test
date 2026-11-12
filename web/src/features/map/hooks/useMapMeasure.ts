import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';

import { fmtAreaM2, fmtDistanceM, geodesicAreaM2, measureTypingTarget, pathLengthM } from '../lib/measurement';
import type { MeasureMode, MeasureReadout } from '../lib/measurement';

/**
 * ابزار اندازه‌گیری مسافت/مساحت/شعاع روی نقشه.
 * نتیجه فقط در همین نشست می‌ماند، در پایگاه‌داده ذخیره نمی‌شود و روی تجهیزات
 * یا علامت‌ها اثری ندارد.
 */
export function useMapMeasure({ mapRef, ready }: { mapRef: React.RefObject<L.Map | null>; ready: boolean }) {
  const [measureOpen, setMeasureOpen] = useState(false);
  const [measureMode, setMeasureMode] = useState<MeasureMode>('off');
  const [measureReadout, setMeasureReadout] = useState<MeasureReadout | null>(null);
  const measureLayer = useRef<L.LayerGroup | null>(null);
  const measureLabels = useRef<L.LayerGroup | null>(null);
  const measurePoints = useRef<L.LatLng[]>([]);
  const measureShape = useRef<L.Layer | null>(null);
  const measureVertices = useRef<L.Layer[]>([]);
  const measureModeRef = useRef<MeasureMode>('off');
  // پس از دومین کلیک شعاع، لبهٔ دقیق دایره در همین ref می‌ماند تا رسم نهایی
  // به آخرین موقعیت ماوس وابسته نباشد.
  const measureRadiusEdge = useRef<L.LatLng | null>(null);
  // خط شعاع جدا از دایره نگه داشته می‌شود تا با هر جابه‌جایی ماوس خط قبلی
  // حذف شود؛ وگرنه هر حرکت یک خط تازه روی نقشه باقی می‌گذاشت.
  const measureRadiusLine = useRef<L.Layer | null>(null);
  // رسم نهایی بدون پیش‌نمایش؛ دکمهٔ «پایان ترسیم» و Enter از همین استفاده می‌کنند.
  const measureRedraw = useRef<(() => void) | null>(null);

  const clearMeasure = useCallback(() => {
    measureLayer.current?.clearLayers();
    measureLabels.current?.clearLayers();
    measurePoints.current = [];
    measureShape.current = null;
    measureVertices.current = [];
    measureRadiusEdge.current = null;
    measureRadiusLine.current = null;
    setMeasureReadout(null);
  }, []);

  /**
   * پایان دادن به ترسیم.
   *
   * پیش‌تر فقط حالت ابزار خاموش می‌شد و خط پیش‌نمایشِ چسبیده به ماوس
   * (خط‌چین تا آخرین موقعیت نشانگر) روی نقشه می‌ماند؛ همین باعث می‌شد به نظر
   * برسد ترسیم تمام نشده است. اینجا اول شکل نهایی بدون پیش‌نمایش رسم می‌شود،
   * بعد ابزار خاموش می‌شود. نقاط، خطوط و برچسب‌ها می‌مانند.
   */
  const finishMeasure = useCallback(() => {
    if (measureModeRef.current === 'off') return;
    measureRedraw.current?.();
    setMeasureMode('off');
  }, []);

  const startMeasure = useCallback(
    (mode: Exclude<MeasureMode, 'off'>) => {
      setMeasureOpen(true);
      // کلیک دوباره روی ابزار فعال یعنی «پایان»، نه پاک کردن نتیجه.
      if (measureModeRef.current === mode) {
        finishMeasure();
        return;
      }
      clearMeasure();
      setMeasureMode(mode);
    },
    [clearMeasure, finishMeasure]
  );

  const closeMeasure = useCallback(() => {
    setMeasureMode('off');
    setMeasureOpen(false);
    clearMeasure();
  }, [clearMeasure]);

  const canFinishMeasure =
    measureReadout == null
      ? false
      : measureReadout.kind === 'area'
        ? measureReadout.points >= 3
        : measureReadout.kind === 'radius'
          ? (measureReadout.radiusM ?? 0) > 0
          : measureReadout.points >= 2;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    measureModeRef.current = measureMode;
    const container = map.getContainer();
    if (measureMode === 'off') {
      container.style.cursor = '';
      return;
    }
    container.style.cursor = 'crosshair';
    const layer = measureLayer.current ?? L.layerGroup().addTo(map);
    measureLayer.current = layer;
    const accent = measureMode === 'area' ? '#7c3aed' : measureMode === 'radius' ? '#0f766e' : '#2563eb';

    // برچسب‌ها لایهٔ جداگانه دارند تا با هر رسم دوباره ساخته شوند و در
    // رویداد کلیک/کشیدن نقشه دخالت نکنند.
    const labelLayer = measureLabels.current ?? L.layerGroup().addTo(map);
    measureLabels.current = labelLayer;

    const addLabel = (latlng: L.LatLng, text: string, variant: 'segment' | 'total' = 'segment') => {
      const icon = L.divIcon({
        className: 'nw-measure-label',
        html: `<span class="nw-measure-chip ${variant}" style="--mc:${accent}">${text}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      L.marker(latlng, {
        icon,
        interactive: false,
        keyboard: false,
        zIndexOffset: variant === 'total' ? 720 : 640,
      }).addTo(labelLayer);
    };
    const midpoint = (a: L.LatLng, b: L.LatLng) => L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
    const centroid = (points: L.LatLng[]) =>
      L.latLng(
        points.reduce((sum, point) => sum + point.lat, 0) / points.length,
        points.reduce((sum, point) => sum + point.lng, 0) / points.length
      );

    const addVertex = (latlng: L.LatLng) => {
      const dot = L.circleMarker(latlng, {
        radius: 4,
        color: '#ffffff',
        weight: 2,
        fillColor: accent,
        fillOpacity: 1,
        interactive: false,
      }).addTo(layer);
      measureVertices.current.push(dot);
    };

    const redraw = (cursor?: L.LatLng) => {
      if (measureShape.current) {
        layer.removeLayer(measureShape.current);
        measureShape.current = null;
      }
      if (measureRadiusLine.current) {
        layer.removeLayer(measureRadiusLine.current);
        measureRadiusLine.current = null;
      }
      labelLayer.clearLayers();
      const pts = measurePoints.current;
      if (!pts.length) {
        setMeasureReadout(null);
        return;
      }

      if (measureMode === 'distance') {
        const preview = cursor ? [...pts, cursor] : pts;
        measureShape.current = L.polyline(preview, {
          color: accent,
          weight: 3,
          opacity: 0.95,
          dashArray: cursor ? '6 6' : undefined,
          interactive: false,
        }).addTo(layer);
        // اندازهٔ هر قطعه روی همان خط و مجموع در انتهای مسیر نوشته می‌شود.
        for (let i = 1; i < pts.length; i += 1) {
          addLabel(midpoint(pts[i - 1], pts[i]), fmtDistanceM(pts[i - 1].distanceTo(pts[i])));
        }
        if (cursor && pts.length) {
          addLabel(midpoint(pts[pts.length - 1], cursor), fmtDistanceM(pts[pts.length - 1].distanceTo(cursor)));
        }
        addLabel(pts[pts.length - 1], `مجموع: ${fmtDistanceM(pathLengthM(preview))}`, 'total');
        setMeasureReadout({
          kind: 'distance',
          points: pts.length,
          lengthM: pathLengthM(preview),
          areaM2: 0,
          perimeterM: null,
          radiusM: null,
          segments: pts.slice(1).map((point, index) => pts[index].distanceTo(point)),
        });
        return;
      }

      if (measureMode === 'area') {
        const ring = cursor ? [...pts, cursor] : pts;
        const closed = ring.length >= 3;
        measureShape.current = (closed
          ? L.polygon(ring, { color: accent, weight: 2.5, fillColor: accent, fillOpacity: 0.12, interactive: false })
          : L.polyline(ring, { color: accent, weight: 2.5, dashArray: '6 6', interactive: false })
        ).addTo(layer);
        const segments: number[] = [];
        for (let i = 1; i < pts.length; i += 1) segments.push(pts[i - 1].distanceTo(pts[i]));
        segments.forEach((value, index) => addLabel(midpoint(pts[index], pts[index + 1]), fmtDistanceM(value)));
        const perimeterM = closed ? pathLengthM([...ring, ring[0]]) : null;
        const areaM2 = closed ? geodesicAreaM2(ring) : 0;
        if (closed) {
          // ضلع بستن (از آخرین نقطه به نقطهٔ اول) فقط در رسم نهایی نمایش داده می‌شود.
          if (!cursor) {
            const closing = pts[pts.length - 1].distanceTo(pts[0]);
            segments.push(closing);
            addLabel(midpoint(pts[pts.length - 1], pts[0]), fmtDistanceM(closing));
          }
          addLabel(centroid(ring), `مساحت: ${fmtAreaM2(areaM2)}`, 'total');
        }
        setMeasureReadout({
          kind: 'area',
          points: pts.length,
          lengthM: perimeterM ?? pathLengthM(ring),
          areaM2,
          perimeterM,
          radiusM: null,
          segments,
        });
        return;
      }

      const center = pts[0];
      const edge = cursor ?? measureRadiusEdge.current;
      if (!edge) {
        setMeasureReadout({ kind: 'radius', points: 1, lengthM: 0, areaM2: 0, perimeterM: 0, radiusM: 0, segments: [] });
        return;
      }
      measureRadiusEdge.current = edge;
      const radiusM = center.distanceTo(edge);
      measureShape.current = L.circle(center, {
        radius: radiusM,
        color: accent,
        weight: 2.5,
        fillColor: accent,
        fillOpacity: 0.1,
        interactive: false,
      }).addTo(layer);
      measureRadiusLine.current = L.polyline([center, edge], {
        color: accent,
        weight: 1.5,
        dashArray: '4 4',
        interactive: false,
      }).addTo(layer);
      addLabel(midpoint(center, edge), fmtDistanceM(radiusM));
      addLabel(center, `مساحت: ${fmtAreaM2(Math.PI * radiusM * radiusM)}`, 'total');
      setMeasureReadout({
        kind: 'radius',
        points: 1,
        lengthM: radiusM,
        areaM2: Math.PI * radiusM * radiusM,
        perimeterM: 2 * Math.PI * radiusM,
        radiusM,
        segments: [],
      });
    };
    measureRedraw.current = () => redraw();

    const onClick = (e: L.LeafletMouseEvent) => {
      if (measureModeRef.current === 'radius') {
        if (!measurePoints.current.length) {
          measurePoints.current = [e.latlng];
          measureRadiusEdge.current = null;
          addVertex(e.latlng);
          setMeasureReadout({ kind: 'radius', points: 1, lengthM: 0, areaM2: 0, perimeterM: 0, radiusM: 0, segments: [] });
        } else {
          // دومین کلیک، شعاع را دقیقاً همان‌جا قطعی می‌کند و ترسیم تمام می‌شود.
          measureRadiusEdge.current = e.latlng;
          redraw(e.latlng);
          setMeasureMode('off');
        }
        return;
      }
      measurePoints.current = [...measurePoints.current, e.latlng];
      addVertex(e.latlng);
      redraw();
    };

    const onMove = (e: L.LeafletMouseEvent) => {
      if (measureModeRef.current === 'distance' || measureModeRef.current === 'area') {
        if (measurePoints.current.length) redraw(e.latlng);
        return;
      }
      if (measureModeRef.current === 'radius' && measurePoints.current.length === 1) redraw(e.latlng);
    };

    const onContext = (e: L.LeafletMouseEvent) => {
      e.originalEvent?.preventDefault?.();
      if (measureModeRef.current === 'radius') return;
      if (!measurePoints.current.length) return;
      measurePoints.current = measurePoints.current.slice(0, -1);
      const last = measureVertices.current.pop();
      if (last) layer.removeLayer(last);
      redraw();
    };

    const onKey = (e: KeyboardEvent) => {
      if (measureTypingTarget(e.target)) return;
      if (e.key === 'Escape') {
        setMeasureMode('off');
        clearMeasure();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finishMeasure();
      }
    };

    map.on('click', onClick);
    map.on('mousemove', onMove);
    map.on('contextmenu', onContext);
    window.addEventListener('keydown', onKey);
    return () => {
      map.off('click', onClick);
      map.off('mousemove', onMove);
      map.off('contextmenu', onContext);
      window.removeEventListener('keydown', onKey);
      container.style.cursor = '';
      measureRedraw.current = null;
    };
  }, [clearMeasure, finishMeasure, measureMode, ready, mapRef]);

  return {
    measureOpen,
    setMeasureOpen,
    measureMode,
    measureReadout,
    measureModeRef,
    canFinishMeasure,
    clearMeasure,
    finishMeasure,
    startMeasure,
    closeMeasure,
  };
}
