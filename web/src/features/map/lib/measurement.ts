import { faDigits } from '../../../lib/format';

export type MeasureMode = 'off' | 'distance' | 'area' | 'radius';

export interface MeasureReadout {
  kind: Exclude<MeasureMode, 'off'>;
  points: number;
  lengthM: number;
  areaM2: number;
  perimeterM: number | null;
  radiusM: number | null;
  /** طول هر قطعهٔ رسم‌شده (بدون قطعهٔ پیش‌نمایش) */
  segments: number[];
}

/** فوکوس در فیلد متنی نباید کلیدهای میان‌بر اندازه‌گیری را بگیرد */
export function measureTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** طول مسیر بر حسب متر؛ مجموع فاصلهٔ ژئودزیک قطعه‌ها روی کرهٔ زمین */
export function pathLengthM(latlngs: L.LatLng[]): number {
  let total = 0;
  for (let i = 1; i < latlngs.length; i += 1) total += latlngs[i - 1].distanceTo(latlngs[i]);
  return total;
}

/**
 * مساحت ژئودزیک چندضلعی (متر مربع).
 * فرمول جمع اضافهٔ کروی همان روشی است که Leaflet.GeometryUtil به کار می‌برد؛
 * برای مساحت‌های سایتی/شهری دقت کافی دارد و به کتابخانهٔ اضافه نیاز ندارد.
 */
export function geodesicAreaM2(latlngs: L.LatLng[]): number {
  if (latlngs.length < 3) return 0;
  const R = 6378137;
  const rad = Math.PI / 180;
  let sum = 0;
  for (let i = 0; i < latlngs.length; i += 1) {
    const a = latlngs[i];
    const b = latlngs[(i + 1) % latlngs.length];
    sum += (b.lng - a.lng) * rad * (2 + Math.sin(a.lat * rad) + Math.sin(b.lat * rad));
  }
  return Math.abs((sum * R * R) / 2);
}

export function fmtDistanceM(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m < 1) return `${faDigits((m * 100).toFixed(0))} سانتی‌متر`;
  if (m < 1000) return `${faDigits(m < 10 ? m.toFixed(1) : m.toFixed(0))} متر`;
  return `${faDigits((m / 1000).toFixed(2))} کیلومتر`;
}

export function fmtAreaM2(m2: number): string {
  if (!Number.isFinite(m2)) return '—';
  if (m2 < 10000) return `${faDigits(m2.toFixed(m2 < 100 ? 1 : 0))} متر مربع`;
  if (m2 < 1000000) return `${faDigits((m2 / 10000).toFixed(2))} هکتار`;
  return `${faDigits((m2 / 1000000).toFixed(2))} کیلومتر مربع`;
}
