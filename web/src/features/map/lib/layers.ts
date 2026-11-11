import L from 'leaflet';
import { MapLayer } from '../../../lib/types';

export const isVectorLayer = (layer: MapLayer) => {
  if (layer.fileInfo?.isVector) return true;
  const fmt = String(layer.fileInfo?.format || '').toLowerCase();
  return fmt.includes('pbf') || fmt.includes('mvt') || fmt.includes('vector');
};

/** پسوند کاشی از روی فرمت تشخیص‌داده‌شده (مسیر سرور پسوند را نادیده می‌گیرد) */
export const TILE_EXT: Record<string, string> = { png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'webp', gif: 'gif' };
export function tileExtension(format?: string | null) {
  return TILE_EXT[String(format || '').toLowerCase()] || 'png';
}

/** حداقل/حداکثر زوم واقعی فایل؛ مبنای جلوگیری از ۴۰۴ و کاشی شکسته است. */
export function nativeZoom(layer: MapLayer) {
  const min = Number(layer.fileInfo?.minzoom ?? layer.min_zoom ?? 0);
  const max = Number(layer.fileInfo?.maxzoom ?? layer.max_zoom ?? 19);
  return {
    min: Number.isFinite(min) ? Math.max(0, Math.min(24, min)) : 0,
    max: Number.isFinite(max) ? Math.max(0, Math.min(24, max)) : 19,
  };
}

/** محدودهٔ جغرافیایی metadata (غرب، جنوب، شرق، شمال) */
export function layerBounds(layer: MapLayer) {
  const raw = layer.fileInfo?.bounds;
  if (!raw) return undefined;
  const parts = String(raw).split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [w, s, e, n] = parts;
  return L.latLngBounds([s, w], [n, e]);
}

/* ------------------------ برچسب نام شهرها ------------------------ */

/** حداقلی از API مپ‌لیبر که برای خواندن نام شهرها لازم است. */

export const BLANK_TILE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

/**
 * لایهٔ کاشی سفارشی MBTiles برای نقشه‌های تصویری.
 * پسوند و اندازهٔ کاشی از metadata/امضای فایل می‌آید و z/x/y با همان ترتیب
 * Leaflet به سرور می‌رود؛ تبدیل TMS→XYZ در سرور انجام می‌شود. محدودکردن
 * maxNativeZoom/minNativeZoom جلوی درخواست زوم‌های ناموجود (کاشی خالی و خطای
 * زوم) را می‌گیرد.
 */
export const MBTilesRasterLayer = L.TileLayer.extend({
  getTileUrl(this: any, coords: L.Coords) {
    const data = {
      x: coords.x,
      y: coords.y,
      z: this._getZoomForUrl(),
      ext: this.options.extension || 'png',
    };
    return L.Util.template(this._url, L.Util.extend(data, this.options));
  },
}) as unknown as new (url: string, options: L.TileLayerOptions & { extension?: string }) => L.TileLayer;

export function createRasterLayer(layer: MapLayer) {
  const zoom = nativeZoom(layer);
  const size = Number(layer.fileInfo?.tileSize);
  return new MBTilesRasterLayer(`/api/tiles/${layer.id}/{z}/{x}/{y}.{ext}`, {
    extension: tileExtension(layer.fileInfo?.format),
    minZoom: 0,
    maxZoom: 24,
    minNativeZoom: zoom.min,
    maxNativeZoom: zoom.max,
    tileSize: Number.isFinite(size) && size >= 64 ? size : 256,
    noWrap: true,
    bounds: layerBounds(layer),
    attribution: layer.attribution || '',
    errorTileUrl: BLANK_TILE,
    keepBuffer: 2,
  });
}
