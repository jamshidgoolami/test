import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Link } from 'react-router-dom';
import {
  Camera,
  Circle,
  ChevronDown,
  ChevronLeft,
  CirclePlus,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  Flag,
  Hammer,
  HardHat,
  Layers,
  MapPin,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Ruler,
  Save,
  Search,
  Square,
  Star,
  Trash2,
  TriangleAlert,
  Upload,
  Wifi,
  Wrench,
  X,
} from 'lucide-react';
import { api, downloadUrl } from '../lib/api';
import { useApp, useAsync, useSubmitGuard, useToast } from '../lib/store';
import { faDigits, fmtRelative, statusMeta } from '../lib/format';
import { useUrlParams } from '../lib/params';
import { buildVectorStyle, LABEL_ANCHOR_LAYER } from '../lib/mapStyle';
import { Badge, Card, EmptyState, ErrorState, Field, Modal, StatusPill, Toggle } from '../components/ui';
import type { MapLayer, MapMarker, MarkerType } from '../lib/types';
import { VirtualList } from '../components/VirtualList';
import { ColorField } from '../components/ColorField';
// فقط برای اعلام نوع‌های افزوده‌شده به Leaflet؛ در زمان اجرا کتابخانهٔ MapLibre
// تنها وقتی لایهٔ برداری واقعی روی نقشه وجود داشته باشد بارگذاری می‌شود.
import type * as _LeafletMaplibreGL from '@maplibre/maplibre-gl-leaflet';
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

/** شکل سبک تجهیز که API نقشه برمی‌گرداند (بدون تاریخچه و فیلدهای سنگین) */
type MapDevice = {
  id: number;
  name: string;
  ip: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  deviceType: string;
  groupName: string | null;
  lastRtt: number | null;
  priority: string;
  location: string;
  mapLayerId: number | null;
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function markerIcon(device: MapDevice, showLabel: boolean) {
  const meta = statusMeta(device.status);
  const label = showLabel ? `<span class="nw-map-label">${escapeHtml(device.name)}</span>` : '';
  const pulse = device.status === 'offline' ? `<span class="nw-pulse" style="background:${meta.chart}"></span>` : '';
  return L.divIcon({
    className: 'nw-marker',
    html: `<span class="nw-pin" style="--c:${meta.chart}">${pulse}<span class="nw-dot"></span></span>${label}`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function markerPinIcon(marker: MapMarker, showLabel: boolean) {
  const color = marker.typeColor || '#0ea5e9';
  const label = showLabel ? `<span class="nw-map-label">${escapeHtml(marker.name)}</span>` : '';
  return L.divIcon({
    className: 'nw-marker',
    html: `<span class="nw-flag" style="--c:${color}"><svg width="20" height="26" viewBox="0 0 20 26"><path d="M10 0C4.48 0 0 4.48 0 10c0 7.5 10 16 10 16s10-8.5 10-16C20 4.48 15.52 0 10 0z" fill="${color}"/><circle cx="10" cy="10" r="4" fill="#fff"/></svg></span>${label}`,
    iconSize: [20, 26],
    iconAnchor: [10, 26],
    popupAnchor: [0, -22],
  });
}

/* --------------------------- آیکون علامت‌ها --------------------------- */
const MARKER_ICON_NAMES = ['map-pin', 'hammer', 'eye', 'triangle-alert', 'circle-plus', 'wrench', 'camera', 'wifi', 'flag', 'star', 'hard-hat'];

export function MarkerGlyph({ name, size = 14, className = '' }: { name?: string | null; size?: number; className?: string }) {
  const props = { size, className };
  switch ((name || 'map-pin').toLowerCase()) {
    case 'hammer':
      return <Hammer {...props} />;
    case 'eye':
      return <Eye {...props} />;
    case 'triangle-alert':
      return <TriangleAlert {...props} />;
    case 'circle-plus':
      return <CirclePlus {...props} />;
    case 'wrench':
      return <Wrench {...props} />;
    case 'camera':
      return <Camera {...props} />;
    case 'wifi':
      return <Wifi {...props} />;
    case 'flag':
      return <Flag {...props} />;
    case 'star':
      return <Star {...props} />;
    case 'hard-hat':
      return <HardHat {...props} />;
    default:
      return <MapPin {...props} />;
  }
}

/* ------------------------ ابزارهای اندازه‌گیری ------------------------ */
type MeasureMode = 'off' | 'distance' | 'area' | 'radius';

interface MeasureReadout {
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
function measureTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** طول مسیر بر حسب متر؛ مجموع فاصلهٔ ژئودزیک قطعه‌ها روی کرهٔ زمین */
function pathLengthM(latlngs: L.LatLng[]): number {
  let total = 0;
  for (let i = 1; i < latlngs.length; i += 1) total += latlngs[i - 1].distanceTo(latlngs[i]);
  return total;
}

/**
 * مساحت ژئودزیک چندضلعی (متر مربع).
 * فرمول جمع اضافهٔ کروی همان روشی است که Leaflet.GeometryUtil به کار می‌برد؛
 * برای مساحت‌های سایتی/شهری دقت کافی دارد و به کتابخانهٔ اضافه نیاز ندارد.
 */
function geodesicAreaM2(latlngs: L.LatLng[]): number {
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

function fmtDistanceM(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m < 1) return `${faDigits((m * 100).toFixed(0))} سانتی‌متر`;
  if (m < 1000) return `${faDigits(m < 10 ? m.toFixed(1) : m.toFixed(0))} متر`;
  return `${faDigits((m / 1000).toFixed(2))} کیلومتر`;
}

function fmtAreaM2(m2: number): string {
  if (!Number.isFinite(m2)) return '—';
  if (m2 < 10000) return `${faDigits(m2.toFixed(m2 < 100 ? 1 : 0))} متر مربع`;
  if (m2 < 1000000) return `${faDigits((m2 / 10000).toFixed(2))} هکتار`;
  return `${faDigits((m2 / 1000000).toFixed(2))} کیلومتر مربع`;
}

const MEASURE_META: { mode: Exclude<MeasureMode, 'off'>; label: string; icon: React.ReactNode; color: string }[] = [
  { mode: 'distance', label: 'مسافت', icon: <Ruler size={12} />, color: '#2563eb' },
  { mode: 'area', label: 'مساحت', icon: <Square size={12} />, color: '#7c3aed' },
  { mode: 'radius', label: 'شعاع', icon: <Circle size={12} />, color: '#0f766e' },
];

const isVectorLayer = (layer: MapLayer) => {
  if (layer.fileInfo?.isVector) return true;
  const fmt = String(layer.fileInfo?.format || '').toLowerCase();
  return fmt.includes('pbf') || fmt.includes('mvt') || fmt.includes('vector');
};

/** پسوند کاشی از روی فرمت تشخیص‌داده‌شده (مسیر سرور پسوند را نادیده می‌گیرد) */
const TILE_EXT: Record<string, string> = { png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'webp', gif: 'gif' };
function tileExtension(format?: string | null) {
  return TILE_EXT[String(format || '').toLowerCase()] || 'png';
}

/** حداقل/حداکثر زوم واقعی فایل؛ مبنای جلوگیری از ۴۰۴ و کاشی شکسته است. */
function nativeZoom(layer: MapLayer) {
  const min = Number(layer.fileInfo?.minzoom ?? layer.min_zoom ?? 0);
  const max = Number(layer.fileInfo?.maxzoom ?? layer.max_zoom ?? 19);
  return {
    min: Number.isFinite(min) ? Math.max(0, Math.min(24, min)) : 0,
    max: Number.isFinite(max) ? Math.max(0, Math.min(24, max)) : 19,
  };
}

/** محدودهٔ جغرافیایی metadata (غرب، جنوب، شرق، شمال) */
function layerBounds(layer: MapLayer) {
  const raw = layer.fileInfo?.bounds;
  if (!raw) return undefined;
  const parts = String(raw).split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [w, s, e, n] = parts;
  return L.latLngBounds([s, w], [n, e]);
}

/* ------------------------ برچسب نام شهرها ------------------------ */

/** حداقلی از API مپ‌لیبر که برای خواندن نام شهرها لازم است. */
type GlFeature = {
  properties?: Record<string, unknown>;
  geometry?: { type: string; coordinates: unknown };
};
type GlMap = {
  on: (event: string, fn: () => void) => void;
  off: (event: string, fn: () => void) => void;
  getStyle?: () => { layers?: { id: string }[] } | undefined;
  queryRenderedFeatures: (options: { layers: string[] }) => GlFeature[];
};

const LABEL_ORDER: Record<string, number> = {
  continent: 0,
  country: 1,
  state: 2,
  province: 2,
  city: 3,
  town: 4,
  village: 5,
  hamlet: 6,
  isolated_dwelling: 7,
  suburb: 7,
  quarter: 7,
  neighbourhood: 8,
};

/** هر کلاس نام در چه بازهٔ زومی دیده می‌شود (جلوگیری از شلوغی). */
function labelVisible(cls: string, zoom: number) {
  switch (cls) {
    case 'country':
    case 'continent':
      return zoom <= 7.5;
    case 'state':
    case 'province':
      return zoom <= 8;
    case 'city':
      return zoom >= 4;
    case 'town':
      return zoom >= 7;
    case 'village':
      return zoom >= 10;
    case 'hamlet':
    case 'isolated_dwelling':
      return zoom >= 12;
    case 'suburb':
    case 'quarter':
    case 'neighbourhood':
      return zoom >= 12;
    default:
      return false;
  }
}

function labelSize(cls: string, zoom: number) {
  if (cls === 'country' || cls === 'continent') return 15;
  if (cls === 'state' || cls === 'province') return 13;
  if (cls === 'city') return zoom >= 10 ? 15 : 13;
  if (cls === 'town') return 12.5;
  if (cls === 'village') return 11.5;
  return 11;
}

function escapeLabel(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

// کاشی ناموجود نباید به شکل آیکون تصویر شکسته دیده شود.
const BLANK_TILE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

/**
 * لایهٔ کاشی سفارشی MBTiles برای نقشه‌های تصویری.
 * پسوند و اندازهٔ کاشی از metadata/امضای فایل می‌آید و z/x/y با همان ترتیب
 * Leaflet به سرور می‌رود؛ تبدیل TMS→XYZ در سرور انجام می‌شود. محدودکردن
 * maxNativeZoom/minNativeZoom جلوی درخواست زوم‌های ناموجود (کاشی خالی و خطای
 * زوم) را می‌گیرد.
 */
const MBTilesRasterLayer = L.TileLayer.extend({
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

function createRasterLayer(layer: MapLayer) {
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

export default function MapPage() {
  const { settings, meta, refreshMeta } = useApp();
  const { push } = useToast();
  const { busy: saving, run: runGuarded } = useSubmitGuard();
  const { params, setParam } = useUrlParams();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayers = useRef<Record<number, L.Layer>>({});
  const markers = useRef<Map<number, L.Marker>>(new Map());
  const markerPins = useRef<Map<number, L.Marker>>(new Map());
  const deviceLayer = useRef<L.LayerGroup | null>(null);
  // نگاشت لایهٔ برداری → نقشهٔ MapLibre همان لایه، برای خواندن نام شهرها
  const vectorMaps = useRef<Map<number, GlMap>>(new Map());
  const [vectorMapsTick, setVectorMapsTick] = useState(0);
  const flyTimers = useRef<number[]>([]);
  const devicesRef = useRef<MapDevice[]>([]);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<{ id: number; latitude: number; longitude: number } | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [placingDevice, setPlacingDevice] = useState<number | null>(null);
  const [sideOpen, setSideOpen] = useState(true);
  const [sideTab, setSideTab] = useState<'devices' | 'markers'>('devices');
  const [armedType, setArmedType] = useState<{ typeId: number; typeName: string; typeColor: string; typeIcon: string } | null>(null);
  // ابزار اندازه‌گیری نقشه؛ نتیجه فقط در همین نشست می‌ماند و ذخیره نمی‌شود.
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
  const [pendingMarker, setPendingMarker] = useState<{ latitude: number; longitude: number; typeId: number | null; typeName: string; typeColor: string; typeIcon: string; marker?: MapMarker } | null>(null);
  const [showMarkerLabels, setShowMarkerLabels] = useState(true);
  // فهرست نقشه همیشه همهٔ تجهیزات/علامت‌ها را دارد؛ این دو مجموعه فقط نمایش
  // گروه‌ها و انواع را روی نقشه و فهرست کنترل می‌کنند.
  const [hiddenGroups, setHiddenGroups] = useState<string[]>([]);
  const [hiddenTypeIds, setHiddenTypeIds] = useState<number[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  // سطح زوم فعلی: نمایش خوشه‌ای/تکی نشانگرها و برچسب نام به آن وابسته است.
  // پیش‌تر تغییر زوم باعث بازسازی لایهٔ نشانگرها نمی‌شد و خوشه‌ها با زوم باز
  // نمی‌شدند؛ این وضعیت با رویداد zoomend هم‌گام می‌شود.
  const [zoom, setZoom] = useState(settings?.map_default_zoom ?? 6);

  const query = useMemo(
    () => ({
      search: params.get('search') ?? '',
      status: params.get('status') ?? '',
      group: params.get('group') ?? '',
      tag: params.get('tag') ?? '',
    }),
    [params]
  );

  // همهٔ تجهیزات (نه فقط محدودهٔ نمای فعلی) خوانده می‌شوند؛ جابه‌جایی نقشه
  // فهرست را تغییر نمی‌دهد و فیلتر نمایش گروه‌ها سمت کلاینت انجام می‌شود.
  const queryKey = JSON.stringify(query);
  // includeMissing: فهرست باید همهٔ تجهیزات را نشان دهد تا کاربر تجهیز بدون
  // مختصات را هم ببیند و موقعیتش را ثبت کند (نشانگر فقط برای دارای مختصات).
  const { data: mapData, loading, error, refresh, updatedAt } = useAsync(
    (signal) => api.mapDevices({ ...query, includeMissing: 1 }, signal),
    [queryKey]
  );
  const { data: layersData, refresh: refreshLayers } = useAsync((signal) => api.layers(signal), []);
  const { data: markersData, refresh: refreshMarkers } = useAsync((signal) => api.markers({}, signal), []);
  const devices = useMemo(() => (mapData?.items ?? []) as MapDevice[], [mapData]);
  devicesRef.current = devices;
  const layers = layersData?.items ?? [];
  const mapMarkers = markersData?.items ?? [];
  const markerTypes = markersData?.types ?? [];
  const groupNames = useMemo(() => {
    const names = new Set<string>();
    for (const d of devices) names.add(d.groupName || '__none__');
    return [...names].sort((a, b) => a.localeCompare(b, 'fa'));
  }, [devices]);
  const visibleDevices = useMemo(
    () => devices.filter((d) => !hiddenGroups.includes(d.groupName || '__none__')),
    [devices, hiddenGroups]
  );
  const visibleMarkers = useMemo(
    () => mapMarkers.filter((m) => m.typeId == null || !hiddenTypeIds.includes(m.typeId)),
    [mapMarkers, hiddenTypeIds]
  );
  const statusCounts = mapData?.stats ?? {};
  const missingGeo = mapData?.missingGeo ?? 0;
  const totalDevices = mapData?.total ?? 0;
  const withGeo = mapData?.withGeo ?? 0;

  /* ------------------------- init map ------------------------- */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const center = settings?.map_default_center ?? [35.6892, 51.389];
    const map = L.map(containerRef.current, {
      center: L.latLng(center[0], center[1]),
      zoom: settings?.map_default_zoom ?? 6,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: false,
    });
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);
    mapRef.current = map;
    deviceLayer.current = L.layerGroup().addTo(map);
    setZoom(map.getZoom());
    const onZoom = () => setZoom(map.getZoom());
    map.on('zoomend', onZoom);
    setReady(true);
    return () => {
      for (const id of flyTimers.current) window.clearTimeout(id);
      flyTimers.current = [];
      map.off('zoomend', onZoom);
      map.remove();
      mapRef.current = null;
      deviceLayer.current = null;
      markers.current.clear();
      markerPins.current.clear();
      tileLayers.current = {};
      setPending(null);
      setPendingMarker(null);
      setPlacingDevice(null);
      setEditing(false);
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const center = settings?.map_default_center ?? [35.6892, 51.389];
    map.setView(L.latLng(center[0], center[1]), settings?.map_default_zoom ?? 6);
  }, [settings?.map_default_center, settings?.map_default_zoom]);

  /* ------------------- تمام‌صفحه کردن نقشه ------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const timer = window.setTimeout(() => map.invalidateSize(), 80);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    if (fullscreen) document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  // باز/بسته کردن فهرست، عرض نقشه را عوض می‌کند؛ Leaflet باید اندازهٔ تازه را
  // بگیرد وگرنه بخشی از نقشه خاکستری می‌ماند. در تمام‌صفحه فهرست روی نقشه
  // می‌آید، اما این فراخوانی بی‌ضرر است.
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => mapRef.current?.invalidateSize(), 320);
    return () => window.clearTimeout(timer);
  }, [fullscreen, ready, sideOpen]);

  /* ------------------------- base layers ------------------------- */
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
              push(`لایهٔ برداری «${layer.name}» بارگذاری نشد`, 'error');
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
  }, [layers, ready, push]);

  /* --------------------------- برچسب نام شهرها/استان‌ها --------------------------- */
  // نام‌ها در MapLibre به فونت SDF نیاز دارند که در حالت آفلاین موجود نیست؛
  // ازاین‌رو نام هر عارضه را از همان کاشی می‌خوانیم و به‌صورت HTML روی نقشه
  // می‌نویسیم. برچسب‌های هم‌پوشان با یک آزمون سادهٔ مستطیلی حذف می‌شوند.
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
  }, [ready, vectorMapsTick]);

  /* --------------------------- device markers + clustering --------------------------- */
  // برای هزاران Marker، یک Marker برای هر تجهیز ساخته نمی‌شود؛ نقاط در فضای
  // پیکسلی نمای فعلی در سلول‌های ۶۴ پیکسلی گروه می‌شوند و هر سلول یک نشانگر
  // شمارشی می‌گیرد. با زوم بیشتر، خوشه‌ها باز و نشانگرهای تک ظاهر می‌شوند.
  useEffect(() => {
    const map = mapRef.current;
    const layer = deviceLayer.current;
    if (!map || !ready || !layer) return;

    layer.clearLayers();
    markers.current.clear();
    // سیاست نمایش بر اساس زوم:
    //   • زوم ۱ تا ۱۵: نقاط نزدیک در یک دایره با تعداد تجمیع می‌شوند
    //   • زوم ۱۶ تا ۲۰: هر تجهیز جداگانه و نامش کنار آن نمایش داده می‌شود
    const z = map.getZoom();
    const detailed = z >= 16;
    const showLabel = detailed || !!settings?.map_show_labels;
    const cellSize = detailed ? 0 : 64;

    type Cell = { lat: number; lng: number; items: MapDevice[] };
    const cells = new Map<string, Cell>();
    for (const device of visibleDevices) {
      const { latitude: lat, longitude: lng } = device;
      if (lat == null || lng == null) continue;
      let key: string;
      if (!cellSize) {
        key = `p:${device.id}`;
      } else {
        const p = map.project([lat, lng], z);
        key = `${Math.floor(p.x / cellSize)}:${Math.floor(p.y / cellSize)}`;
      }
      const cell = cells.get(key);
      if (cell) {
        cell.items.push(device);
        cell.lat += lat;
        cell.lng += lng;
      } else {
        cells.set(key, { lat, lng, items: [device] });
      }
    }

    for (const cell of cells.values()) {
      const count = cell.items.length;
      const lat = cell.lat / count;
      const lng = cell.lng / count;
      if (count > 1) {
        const cluster = L.marker([lat, lng], {
          icon: L.divIcon({
            className: 'nw-cluster-wrap',
            html: `<span class="nw-cluster">${count.toLocaleString('fa-IR')}</span>`,
            iconSize: [40, 40],
            iconAnchor: [20, 20],
          }),
          riseOnHover: true,
          interactive: true,
        }).addTo(layer);
        cluster.on('click', () => map.setView([lat, lng], Math.min(19, z + 2), { animate: true }));
        continue;
      }

      const device = cell.items[0];
      const marker = L.marker([lat, lng], {
        icon: markerIcon(device, showLabel),
        riseOnHover: true,
        draggable: editing,
      }).addTo(layer);
      marker.bindPopup(popupHtml(device), { closeButton: true, minWidth: 220 });
      marker.on('click', () => {
        if (editing) {
          setPlacingDevice(device.id);
          return;
        }
        marker.openPopup();
        map.panTo([lat, lng]);
      });
      // در حالت جابه‌جایی، کشیدن نشانگر مستقیماً موقعیت جدید را ذخیره می‌کند.
      marker.on('dragend', async () => {
        const latlng = marker.getLatLng();
        const latitude = Number(latlng.lat.toFixed(6));
        const longitude = Number(latlng.lng.toFixed(6));
        try {
          await api.positions([{ id: device.id, latitude, longitude }]);
          push(`موقعیت «${device.name}» به‌روزرسانی شد`, 'success');
          refresh();
        } catch (e) {
          push((e as Error).message, 'error');
          marker.setLatLng([lat, lng]);
        }
      });
      markers.current.set(device.id, marker);
    }
  }, [visibleDevices, ready, editing, settings?.map_show_labels, zoom]);

  /* --------------------------- map markers (علامت‌ها) --------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const current = new Set<number>();
    // در زوم‌های نزدیک (۱۶+) نام علامت همیشه کنار آن است؛ پایین‌تر تابع تنظیمات.
    const showLabels = showMarkerLabels || zoom >= 16;
    for (const marker of visibleMarkers) {
      current.add(marker.id);
      const icon = markerPinIcon(marker, showLabels);
      let pin = markerPins.current.get(marker.id);
      // تغییر حالت جابه‌جایی نیاز به ساخت دوبارهٔ Marker با draggable دارد؛
      // افزودن بعدی handler فقط برای Markerهای ساخته‌شده با draggable کار می‌کند.
      if (pin && !!pin.options.draggable !== editing) {
        map.removeLayer(pin);
        markerPins.current.delete(marker.id);
        pin = undefined;
      }
      if (!pin) {
        pin = L.marker([marker.latitude, marker.longitude], { icon, riseOnHover: true, draggable: editing }).addTo(map);
        markerPins.current.set(marker.id, pin);
      } else {
        pin.setLatLng([marker.latitude, marker.longitude]);
        pin.setIcon(icon);
      }
      pin.bindPopup(markerPopupHtml(marker), { closeButton: true, minWidth: 200 });
      // امکان جابه‌جایی علامت‌ها هم در همان حالت ویرایش موقعیت.
      if (editing) pin.dragging?.enable();
      pin.off('dragend');
      pin.on('dragend', async () => {
        const latlng = pin.getLatLng();
        try {
          await api.updateMarker(marker.id, { latitude: Number(latlng.lat.toFixed(6)), longitude: Number(latlng.lng.toFixed(6)) });
          push(`موقعیت علامت «${marker.name}» به‌روزرسانی شد`, 'success');
          refreshMarkers();
        } catch (e) {
          push((e as Error).message, 'error');
          pin.setLatLng([marker.latitude, marker.longitude]);
        }
      });
    }
    for (const [id, pin] of markerPins.current.entries()) {
      if (!current.has(id)) {
        map.removeLayer(pin);
        markerPins.current.delete(id);
      }
    }
  }, [visibleMarkers, ready, showMarkerLabels, editing, refreshMarkers, push, zoom]);

  /* ------------------------- edit / place on map ------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      // در حال اندازه‌گیری، کلیک باید نقطهٔ اندازه‌گیری بگذارد نه تجهیز/علامت.
      if (measureModeRef.current !== 'off') return;
      const lat = Number(e.latlng.lat.toFixed(6));
      const lng = Number(e.latlng.lng.toFixed(6));
      if (armedType) {
        setPendingMarker({ latitude: lat, longitude: lng, typeId: armedType.typeId, typeName: armedType.typeName, typeColor: armedType.typeColor, typeIcon: armedType.typeIcon });
        setArmedType(null);
        return;
      }
      if (editing && placingDevice) {
        setPending({ id: placingDevice, latitude: lat, longitude: lng });
        setPlacingDevice(null);
      }
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [ready, editing, placingDevice, armedType]);

  /* ------------------------- اندازه‌گیری روی نقشه ------------------------- */
  // ابزار مسافت/مساحت/شعاع فقط برای خواندن است: نتیجه در همین نشست می‌ماند،
  // در پایگاه‌داده ذخیره نمی‌شود و روی تجهیزات یا علامت‌ها اثری ندارد.
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
  }, [clearMeasure, finishMeasure, measureMode, ready]);

  /* ------------------------- drag & drop از فهرست به نقشه ------------------------- */
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (saving) return;
    const map = mapRef.current;
    if (!map) return;
    const raw = e.dataTransfer.getData('text/nw-device') || e.dataTransfer.getData('text/plain');
    const id = Number(raw);
    if (!id) return;
    const latlng = map.mouseEventToLatLng(e.nativeEvent);
    const latitude = Number(latlng.lat.toFixed(6));
    const longitude = Number(latlng.lng.toFixed(6));
    const device = devices.find((d) => d.id === id);
    void runGuarded(async () => {
      try {
        await api.positions([{ id, latitude, longitude }]);
        push(`موقعیت «${device?.name ?? `#${id}`}» روی نقشه ثبت شد`, 'success');
        refresh();
      } catch (err) {
        push((err as Error).message, 'error');
      }
    });
  };

  const savePosition = () => {
    if (!pending) return;
    void runGuarded(async () => {
      try {
        await api.positions([{ id: pending.id, latitude: pending.latitude, longitude: pending.longitude }]);
        push('موقعیت تجهیز ذخیره شد', 'success');
        setPending(null);
        setEditing(false);
        refresh();
      } catch (e) {
        push((e as Error).message, 'error');
      }
    });
  };

  const schedulePopup = useCallback((get: () => L.Marker | undefined) => {
    const timer = window.setTimeout(() => {
      flyTimers.current = flyTimers.current.filter((t) => t !== timer);
      get()?.openPopup();
    }, 450);
    flyTimers.current.push(timer);
  }, []);

  const flyToDevice = useCallback(
    async (id: number) => {
      const map = mapRef.current;
      if (!map) return;
      let device = devicesRef.current.find((d) => d.id === id);
      // مقصد ممکن است خارج از نمای فعلی/بازهٔ بارگذاری‌شده باشد؛ در این حالت
      // همان یک تجهیز از API جزئیات خوانده می‌شود (بدون بارگذاری کل نقشه).
      if (!device) {
        try {
          const d = await api.device(id);
          if (d.latitude == null || d.longitude == null) {
            setEditing(true);
            setPlacingDevice(id);
            push(`«${d.name}» مختصات ندارد؛ روی نقشه محل آن را کلیک کنید.`, 'warning');
            return;
          }
          device = {
            id: d.id,
            name: d.name,
            ip: d.ip,
            status: d.status,
            latitude: d.latitude,
            longitude: d.longitude,
            deviceType: d.deviceType,
            groupName: d.groupName ?? null,
            lastRtt: d.lastRtt,
            priority: d.priority,
            location: d.location,
            mapLayerId: d.mapLayerId,
          };
        } catch {
          return;
        }
      }
      if (device.latitude == null || device.longitude == null) {
        // تجهیز بدون مختصات: حالت جانمایی فعال می‌شود تا همان کلیک بعدی روی نقشه
        // محل آن را بگیرد (رفتار مشابه کشیدن از فهرست).
        setEditing(true);
        setPlacingDevice(device.id);
        push(`«${device.name}» مختصات ندارد؛ روی نقشه محل آن را کلیک کنید.`, 'warning');
        return;
      }
      map.setView([device.latitude, device.longitude], Math.max(map.getZoom(), 14), { animate: true });
      schedulePopup(() => markers.current.get(id));
    },
    [schedulePopup, push]
  );

  const flyToMarker = useCallback(
    (m: MapMarker) => {
      const map = mapRef.current;
      if (!map) return;
      map.setView([m.latitude, m.longitude], Math.max(map.getZoom(), 14), { animate: true });
      schedulePopup(() => markerPins.current.get(m.id));
    },
    [schedulePopup]
  );

  useEffect(() => {
    const target = params.get('device');
    if (!target || !ready) return;
    void flyToDevice(Number(target));
  }, [params.get('device'), ready, flyToDevice]);


  return (
    <div className="space-y-3">
      <Card padded={false} className="p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className="field !rounded-pill pr-9" placeholder="جست‌وجوی تجهیز روی نقشه…" value={query.search} onChange={(e) => setParam('search', e.target.value)} />
          </div>
          <select className="field !w-auto !rounded-pill" value={query.status} onChange={(e) => setParam('status', e.target.value)}>
            <option value="">همه وضعیت‌ها</option>
            <option value="online">در دسترس</option>
            <option value="warning">دارای اختلال</option>
            <option value="offline">قطع‌شده</option>
            <option value="maintenance">در تعمیرات</option>
          </select>
          <select className="field !w-auto !rounded-pill" value={query.group} onChange={(e) => setParam('group', e.target.value)}>
            <option value="">همه گروه‌ها</option>
            {(meta?.groups ?? []).map((g) => (
              <option key={g.id} value={g.name}>
                {g.name}
              </option>
            ))}
          </select>

          <div className="ms-auto flex flex-wrap items-center gap-2">
            <button type="button" className={`btn-xs ${editing ? 'btn-warn' : 'btn-ghost'}`} onClick={() => { setEditing((v) => !v); setPlacingDevice(null); setPending(null); setArmedType(null); }} title="جابه‌جایی تجهیزات و علامت‌ها روی نقشه" aria-pressed={editing}>
              <Crosshair size={14} />
              {editing ? 'حالت جابه‌جایی فعال' : 'جابه‌جایی موقعیت'}
            </button>
            <button type="button" className="btn-ghost btn-xs" onClick={refresh} aria-label="به‌روزرسانی نقشه">
              <RefreshCw size={14} />
              به‌روزرسانی
            </button>
            <span
              className="inline-flex items-center gap-0.5 rounded-pill border border-ink-200 bg-white p-0.5"
              role="group"
              aria-label="ابزارهای نقشه"
            >
              <button
                type="button"
                className={`grid h-7 w-7 place-items-center rounded-pill transition ${
                  fullscreen ? 'bg-brand-50 text-brand-700' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-700'
                }`}
                onClick={() => setFullscreen((value) => !value)}
                aria-pressed={fullscreen}
                aria-label={fullscreen ? 'خروج از تمام‌صفحه' : 'نمایش تمام‌صفحه'}
                title={fullscreen ? 'خروج از تمام‌صفحه' : 'نمایش تمام‌صفحه'}
              >
                {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button
                type="button"
                className={`grid h-7 w-7 place-items-center rounded-pill transition ${
                  measureOpen ? 'bg-brand-50 text-brand-700' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-700'
                }`}
                onClick={() => setMeasureOpen((value) => !value)}
                aria-pressed={measureOpen}
                aria-label="اندازه‌گیری روی نقشه"
                title="اندازه‌گیری مسافت، مساحت و شعاع"
              >
                <Ruler size={14} />
              </button>
              <button
                type="button"
                className="grid h-7 w-7 place-items-center rounded-pill text-ink-500 transition hover:bg-ink-50 hover:text-ink-700"
                onClick={() => setLayersOpen(true)}
                aria-label="لایه‌های نقشه"
                title="لایه‌های نقشه"
              >
                <Layers size={14} />
              </button>
              <a
                className="grid h-7 w-7 place-items-center rounded-pill text-ink-500 transition hover:bg-ink-50 hover:text-ink-700"
                href={downloadUrl('/devices/export/geo', { format: 'xlsx' })}
                aria-label="خروجی مختصات"
                title="خروجی مختصات"
              >
                <Download size={14} />
              </a>
            </span>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-2">
          {(['online', 'warning', 'offline', 'maintenance'] as const).map((s) => {
            const sm = statusMeta(s);
            return (
              <span key={s} className="inline-flex items-center gap-1.5 text-[11px] text-ink-500">
                <span className={`h-2.5 w-2.5 rounded-full ${sm.dot}`} />
                {sm.label}: <span className="num font-medium text-ink-700">{faDigits(statusCounts[s] ?? 0)}</span>
              </span>
            );
          })}
          <span className="text-[11px] text-ink-400">
            {faDigits(visibleDevices.length)} تجهیز در فهرست — {faDigits(withGeo)} دارای مختصات، {faDigits(missingGeo)} بدون مختصات
          </span>
          {mapData?.truncated ? (
            <span className="chip border-sun-200 bg-sun-50 text-sun-700">فهرست به سقف پاسخ سرور محدود شد</span>
          ) : null}
          {hiddenGroups.length ? <span className="chip border-ink-200 bg-ink-50 text-ink-600">{faDigits(hiddenGroups.length)} گروه مخفی</span> : null}
          {hiddenTypeIds.length ? <span className="chip border-ink-200 bg-ink-50 text-ink-600">{faDigits(hiddenTypeIds.length)} نوع علامت مخفی</span> : null}
          {missingGeo > 0 ? (
            <span className="chip border-sun-200 bg-sun-50 text-sun-700">
              {faDigits(missingGeo)} از {faDigits(totalDevices)} تجهیز بدون مختصات جغرافیایی
            </span>
          ) : null}
          <span className="ms-auto inline-flex items-center gap-1.5 text-[11px] text-ink-400">
            <MapPin size={12} />
            {faDigits(visibleMarkers.length)} علامت روی نقشه
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-400">
            آخرین به‌روزرسانی: {fmtRelative(updatedAt ?? mapData?.generatedAt)}
          </span>
        </div>
      </Card>

      {error ? (
        <div className="animate-fade-up">
          <ErrorState message={error} onRetry={refresh} />
        </div>
      ) : null}

      {editing ? (
        <div className="animate-fade-up rounded-card border border-sun-200 bg-sun-50/80 p-3 text-[12px] text-sun-800">
          حالت جابه‌جایی فعال است: نشانگر تجهیز یا علامت را بگیرید و بکشید. برای تجهیز می‌توانید روی نشانگر کلیک کنید و محل جدید را روی نقشه انتخاب کنید، یا آن را از فهرست بکشید و روی نقشه رها کنید.
          {placingDevice ? <span className="ms-2 font-semibold">در انتظار انتخاب محل جدید برای تجهیز #{faDigits(placingDevice)}</span> : null}
        </div>
      ) : null}

      {armedType ? (
        <div className="animate-fade-up rounded-card border border-brand-200 bg-brand-50/80 p-3 text-[12px] text-brand-800">
          برای جانمایی علامت «{armedType.typeName}» روی نقشه کلیک کنید.
          <button type="button" className="btn-ghost btn-xs ms-2" onClick={() => setArmedType(null)}>
            انصراف
          </button>
        </div>
      ) : null}

      {/* چیدمان: نقشه (مرکز) · فهرست تک‌پنلی تجهیزات/علامت‌ها (چپ) */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-stretch">
        <div className={fullscreen ? 'contents' : 'min-w-0 flex-1'}>
          <div
            className={
              fullscreen
                ? 'fixed inset-0 z-[1100] flex flex-col overflow-hidden rounded-none border-0 bg-white shadow-pop'
                : 'relative overflow-hidden rounded-card border border-ink-200/70 bg-white shadow-card'
            }
          >
            <div
              ref={containerRef}
              className={fullscreen ? 'min-h-0 w-full flex-1' : 'h-[calc(100dvh-215px)] min-h-[460px] max-h-[820px] w-full'}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            />
            {fullscreen && !sideOpen ? (
              <div className="absolute left-3 top-3 z-[500] flex items-center gap-2">
                <button
                  type="button"
                  className="grid h-8 w-8 place-items-center rounded-soft border border-ink-200 bg-white/95 text-ink-600 shadow-soft transition hover:bg-white hover:text-ink-900"
                  onClick={() => setSideOpen(true)}
                  title="نمایش فهرست نقشه"
                  aria-label="نمایش فهرست نقشه"
                  aria-controls="map-side-list"
                  aria-expanded={false}
                >
                  <PanelLeftOpen size={16} />
                </button>
                <button
                  type="button"
                  className="grid h-8 w-8 place-items-center rounded-soft border border-ink-200 bg-white/95 text-ink-600 shadow-soft transition hover:bg-white hover:text-ink-900"
                  onClick={() => setFullscreen(false)}
                  title="بستن نقشه و خروج از تمام‌صفحه"
                  aria-label="بستن نقشه و خروج از تمام‌صفحه"
                >
                  <Minimize2 size={16} />
                </button>
              </div>
            ) : null}
            {loading ? (
              <div className="absolute inset-x-0 top-0 h-1 bg-brand-100">
                <div className="h-full w-1/3 animate-pulse bg-brand-500" />
              </div>
            ) : null}
            {measureOpen ? (
              <div
                className="absolute right-3 top-3 z-[520] w-[252px] rounded-card border border-ink-200 bg-white/95 p-2.5 shadow-pop backdrop-blur"
                dir="rtl"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1 text-[11.5px] font-semibold text-ink-700">
                    <Ruler size={13} className="text-brand-600" />
                    اندازه‌گیری روی نقشه
                  </p>
                  <button
                    type="button"
                    className="grid h-6 w-6 place-items-center rounded-md text-ink-400 hover:bg-ink-50 hover:text-ink-700"
                    onClick={() => {
                      setMeasureMode('off');
                      setMeasureOpen(false);
                      clearMeasure();
                    }}
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
                      onClick={() => startMeasure(item.mode)}
                      aria-pressed={measureMode === item.mode}
                      className={`inline-flex items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-[11px] font-medium transition ${
                        measureMode === item.mode ? 'text-white' : 'border-ink-200 bg-white text-ink-600 hover:border-brand-200'
                      }`}
                      style={measureMode === item.mode ? { background: item.color, borderColor: item.color } : undefined}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="mt-2 rounded-soft border border-ink-100 bg-ink-50/60 p-2 text-[11px] text-ink-600">
                  {measureReadout ? (
                    <div className="space-y-0.5">
                      {measureReadout.kind === 'distance' ? (
                        <>
                          <p>
                            طول کل: <span className="num font-semibold text-ink-800">{fmtDistanceM(measureReadout.lengthM)}</span>
                          </p>
                          <p className="num text-[10px] text-ink-400">
                            {faDigits(measureReadout.points)} نقطه · {faDigits(measureReadout.segments.length)} قطعه
                          </p>
                        </>
                      ) : measureReadout.kind === 'area' ? (
                        <>
                          <p>
                            مساحت: <span className="num font-semibold text-ink-800">{fmtAreaM2(measureReadout.areaM2)}</span>
                          </p>
                          <p>
                            محیط: <span className="num text-ink-700">{measureReadout.perimeterM != null ? fmtDistanceM(measureReadout.perimeterM) : '—'}</span>
                          </p>
                          <p className="num text-[10px] text-ink-400">
                            {faDigits(measureReadout.points)} نقطه · {faDigits(measureReadout.segments.length)} ضلع
                          </p>
                        </>
                      ) : (
                        <>
                          <p>
                            شعاع: <span className="num font-semibold text-ink-800">{fmtDistanceM(measureReadout.radiusM ?? 0)}</span>
                          </p>
                          <p>
                            مساحت دایره: <span className="num text-ink-700">{fmtAreaM2(measureReadout.areaM2)}</span>
                          </p>
                          <p>
                            محیط: <span className="num text-ink-700">{fmtDistanceM(measureReadout.perimeterM ?? 0)}</span>
                          </p>
                        </>
                      )}
                    </div>
                  ) : (
                    <p>
                      {measureMode === 'distance'
                        ? 'نقطه‌های مسیر را یکی‌یکی روی نقشه کلیک کنید.'
                        : measureMode === 'area'
                          ? 'نقطه‌های محیط زمین را کلیک کنید؛ از سه نقطه به بعد مساحت محاسبه می‌شود.'
                          : measureMode === 'radius'
                            ? 'ابتدا مرکز دایره و سپس لبهٔ آن را کلیک کنید.'
                            : 'مسافت، مساحت یا شعاع را انتخاب کنید.'}
                    </p>
                  )}
                  {measureMode !== 'off' ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        className="btn-primary btn-xs"
                        onClick={finishMeasure}
                        disabled={!canFinishMeasure}
                        title="بستن ترسیم و نگه داشتن نتیجه (Enter)"
                      >
                        <Flag size={11} />
                        پایان ترسیم
                      </button>
                      <button type="button" className="btn-ghost btn-xs" onClick={clearMeasure}>
                        <Trash2 size={11} />
                        پاک کردن
                      </button>
                    </div>
                  ) : measureReadout ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="rounded-pill bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        پایان‌یافته
                      </span>
                      <button type="button" className="btn-ghost btn-xs" onClick={clearMeasure}>
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
            ) : null}
            {pending ? (
              <div className="absolute inset-x-0 bottom-4 mx-auto flex w-[92%] max-w-lg items-center justify-between gap-3 rounded-soft border border-brand-200 bg-white/97 p-3 shadow-pop backdrop-blur">
                <span className="text-[12px] text-ink-600">
                  موقعیت جدید: <span className="num font-semibold">{pending.latitude}, {pending.longitude}</span>
                </span>
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost btn-xs" onClick={() => setPending(null)}>
                    انصراف
                  </button>
                  <button type="button" className="btn-primary btn-xs" disabled={saving} onClick={savePosition}>
                    <Save size={13} />
                    {saving ? 'در حال ذخیره…' : 'ذخیره موقعیت'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <style>{`
            /* برچسب اندازه‌گیری: کادر مستقل از استایل پیش‌فرض Leaflet، فونت
               فارسی، کنتراست بالا و کمی بالاتر از خط تا روی خط نیفتد. */
            .nw-measure-label { width: 0 !important; height: 0 !important; background: transparent !important; border: 0 !important; box-shadow: none !important; overflow: visible !important; pointer-events: none !important; }
            .nw-measure-chip { display: inline-block; transform: translate(-50%, calc(-50% - 11px)); white-space: nowrap; direction: rtl; font-family: Vazirmatn, Tahoma, sans-serif !important; font-size: 11.5px; font-weight: 700; line-height: 1.7; font-variant-numeric: tabular-nums; padding: 2px 8px; border-radius: 9px; color: #0b1220; background: #ffffff; border: 2px solid var(--mc); box-shadow: 0 2px 6px rgba(15, 23, 42, .3), 0 0 0 1px rgba(255, 255, 255, .7); pointer-events: none; user-select: none; }
            .nw-measure-chip.total { transform: translate(-50%, calc(-50% - 13px)); color: #ffffff; background: var(--mc); border-color: #ffffff; box-shadow: 0 2px 8px rgba(15, 23, 42, .4), 0 0 0 1.5px var(--mc); font-size: 12px; }
            .nw-pin { position: relative; display: grid; place-items: center; width: 18px; height: 18px; }
            .nw-dot { width: 12px; height: 12px; border-radius: 999px; background: var(--c); border: 2px solid #fff; box-shadow: 0 2px 8px rgba(15,23,42,.35); display:block; }
            .nw-pulse { position: absolute; inset: 0; border-radius: 999px; opacity: .45; animation: nwPulse 1.8s ease-out infinite; display:block; }
            @keyframes nwPulse { 0% { transform: scale(.7); opacity:.5 } 70% { transform: scale(2); opacity:0 } 100% { opacity:0 } }
            .nw-marker { background: transparent; border: 0; }
            .nw-flag { display:block; filter: drop-shadow(0 2px 4px rgba(15,23,42,.35)); }
            .nw-map-label { position:absolute; inset-inline-start: 16px; top:-2px; white-space:nowrap; background: rgba(255,255,255,.92);
              border: 1px solid rgba(148,163,184,.35); border-radius: 8px; padding: 1px 6px; font-size: 10px; color:#475569;
              font-family: Vazirmatn, Tahoma, sans-serif; direction: rtl; box-shadow: 0 4px 10px -6px rgba(15,23,42,.4); }
            .nw-cluster-wrap { background: transparent; border: 0; }
            .nw-cluster { display:grid; place-items:center; width:40px; height:40px; border-radius:999px;
              background: rgba(37,99,235,.92); color:#fff; font-size:12px; font-weight:700; direction:rtl;
              border:2px solid rgba(255,255,255,.9); box-shadow:0 6px 18px -6px rgba(37,99,235,.8);
              font-family: Vazirmatn, Tahoma, sans-serif; }
          `}</style>
        </div>

        <div
          className={
            fullscreen
              ? `fixed inset-y-0 left-0 z-[1200] flex w-[330px] max-w-[88vw] flex-col gap-2 p-3 transition-transform duration-300 ${
                  sideOpen ? 'translate-x-0' : 'pointer-events-none -translate-x-full'
                }`
              : `flex shrink-0 flex-col gap-2 ${sideOpen ? 'xl:w-[324px]' : 'xl:w-auto'}`
          }
          aria-hidden={fullscreen && !sideOpen ? true : undefined}
        >
          {!sideOpen && !fullscreen ? (
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-soft border border-ink-200 bg-white/90 text-ink-500 shadow-soft transition hover:text-ink-800"
              onClick={() => setSideOpen(true)}
              aria-controls="map-side-list"
              aria-expanded={false}
              title="نمایش فهرست نقشه"
              aria-label="نمایش فهرست نقشه"
            >
              <PanelLeftOpen size={15} />
            </button>
          ) : null}

          {sideOpen ? (
          <Card
            id="map-side-list"
            className={
              fullscreen
                ? 'flex h-full min-h-0 flex-col overflow-hidden shadow-pop'
                : 'flex h-[460px] flex-col overflow-hidden xl:h-[582px]'
            }
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-ink-800">
                  <MapPin size={16} className="text-brand-500" />
                  فهرست نقشه
                </h3>
                <p className="mt-0.5 text-[11px] text-ink-500">تجهیزات دارای موقعیت و علامت‌های جانمایی‌شده</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {fullscreen ? (
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-md text-ink-500 transition hover:bg-ink-50 hover:text-ink-900"
                    onClick={() => setFullscreen(false)}
                    title="بستن نقشه و خروج از تمام‌صفحه"
                    aria-label="بستن نقشه و خروج از تمام‌صفحه"
                  >
                    <Minimize2 size={15} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="grid h-7 w-7 place-items-center rounded-md text-ink-500 transition hover:bg-ink-50 hover:text-ink-900"
                  onClick={() => setSideOpen(false)}
                  title="بستن فهرست نقشه"
                  aria-label="بستن فهرست نقشه"
                  aria-controls="map-side-list"
                  aria-expanded
                >
                  <PanelLeftClose size={15} />
                </button>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-1 rounded-soft bg-ink-100/70 p-1 text-[11.5px]" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === 'devices'}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 font-medium transition ${
                  sideTab === 'devices' ? 'bg-white text-brand-700 shadow-soft' : 'text-ink-500 hover:text-ink-700'
                }`}
                onClick={() => setSideTab('devices')}
              >
                <MapPin size={12} />
                تجهیزات
                <span className="num rounded-pill bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-500">{faDigits(visibleDevices.length)}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === 'markers'}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 font-medium transition ${
                  sideTab === 'markers' ? 'bg-white text-brand-700 shadow-soft' : 'text-ink-500 hover:text-ink-700'
                }`}
                onClick={() => setSideTab('markers')}
              >
                <Flag size={12} />
                علامت‌ها
                <span className="num rounded-pill bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-500">{faDigits(visibleMarkers.length)}</span>
              </button>
            </div>

            {sideTab === 'devices' ? (
              <DeviceList
                devices={visibleDevices}
                groups={groupNames}
                hiddenGroups={hiddenGroups}
                onToggleGroup={(g) => setHiddenGroups((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]))}
                selectedId={pending?.id ?? placingDevice ?? null}
                onFlyTo={flyToDevice}
                onDragStart={(id) => {
                  if (editing) setPlacingDevice(id);
                }}
              />
            ) : (
              <MarkersList
                types={markerTypes}
                markers={visibleMarkers}
                hiddenTypeIds={hiddenTypeIds}
                onToggleType={(id) => setHiddenTypeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
                showLabels={showMarkerLabels}
                onToggleLabels={setShowMarkerLabels}
                armedTypeId={armedType?.typeId ?? null}
                onArm={(t) => setArmedType({ typeId: t.id, typeName: t.name, typeColor: t.color, typeIcon: t.icon })}
                onFlyTo={flyToMarker}
                onEdit={(m) =>
                  setPendingMarker({
                    latitude: m.latitude,
                    longitude: m.longitude,
                    typeId: m.typeId,
                    typeName: m.typeName ?? '',
                    typeColor: m.typeColor ?? '#0ea5e9',
                    typeIcon: m.typeIcon ?? 'map-pin',
                    marker: m,
                  })
                }
                onChanged={() => {
                  refreshMarkers();
                  refreshMeta();
                }}
              />
            )}
          </Card>
          ) : null}
        </div>
      </div>

      <MarkerForm
        open={!!pendingMarker}
        draft={pendingMarker}
        types={markerTypes}
        onClose={() => setPendingMarker(null)}
        onSaved={() => {
          setPendingMarker(null);
          refreshMarkers();
        }}
      />

      <LayerManager
        open={layersOpen}
        onClose={() => setLayersOpen(false)}
        layers={layers}
        onChanged={() => {
          refreshLayers();
          refreshMeta();
        }}
      />
    </div>
  );
}

/* ============================== فهرست تجهیزات ============================== */
/** یک ردیف فهرست: یا سرتیتر یک گروه، یا یک تجهیز */
type ListRow =
  | { kind: 'group'; key: string; group: string; name: string; count: number; positioned: number; hidden: boolean }
  | { kind: 'device'; key: string; device: MapDevice };

function DeviceList({
  devices,
  groups,
  hiddenGroups,
  onToggleGroup,
  selectedId,
  onFlyTo,
  onDragStart,
}: {
  devices: MapDevice[];
  groups: string[];
  hiddenGroups: string[];
  onToggleGroup: (group: string) => void;
  selectedId: number | null;
  onFlyTo: (id: number) => void;
  onDragStart: (id: number) => void;
}) {
  // گروه‌های جمع‌شده فقط در فهرست پنهان می‌شوند؛ نمایش روی نقشه با Eye کنترل می‌شود.
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const rows = useMemo<ListRow[]>(() => {
    const byGroup = new Map<string, MapDevice[]>();
    for (const d of devices) {
      const g = d.groupName || '__none__';
      const list = byGroup.get(g);
      if (list) list.push(d);
      else byGroup.set(g, [d]);
    }
    const names = [...byGroup.keys()].sort((a, b) => {
      // «بدون گروه» همیشه آخر می‌آید
      if (a === '__none__') return 1;
      if (b === '__none__') return -1;
      return a.localeCompare(b, 'fa');
    });
    const out: ListRow[] = [];
    for (const g of names) {
      const list = (byGroup.get(g) ?? []).sort((a, b) => a.name.localeCompare(b.name, 'fa'));
      const isCollapsed = collapsed.includes(g);
      out.push({
        kind: 'group',
        key: `g:${g}`,
        group: g,
        name: g === '__none__' ? 'بدون گروه' : g,
        count: list.length,
        positioned: list.filter((d) => d.latitude != null && d.longitude != null).length,
        hidden: hiddenGroups.includes(g),
      });
      if (!isCollapsed) for (const d of list) out.push({ kind: 'device', key: `d:${d.id}`, device: d });
    }
    return out;
  }, [devices, hiddenGroups, collapsed]);

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col">
      {/* نمایش/عدم نمایش گروه‌های مختلف در فهرست و روی نقشه */}
      <details className="mb-2 rounded-soft border border-ink-200 bg-white/70 px-2.5 py-1.5">
        <summary className="cursor-pointer text-[11px] font-medium text-ink-600">
          نمایش گروه‌ها {hiddenGroups.length ? `(${faDigits(hiddenGroups.length)} مخفی)` : ''}
        </summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {groups.length === 0 ? <span className="text-[10.5px] text-ink-400">گروهی وجود ندارد</span> : null}
          {groups.map((g) => {
            const hidden = hiddenGroups.includes(g);
            const label = g === '__none__' ? 'بدون گروه' : g;
            return (
              <button
                key={g}
                type="button"
                onClick={() => onToggleGroup(g)}
                className={`inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[10.5px] transition ${
                  hidden ? 'border-ink-200 bg-ink-50 text-ink-400 line-through' : 'border-brand-200 bg-brand-50 text-brand-700'
                }`}
                aria-pressed={!hidden}
                title={hidden ? `نمایش ${label}` : `مخفی کردن ${label}`}
              >
                {hidden ? <EyeOff size={10} /> : <Eye size={10} />}
                {label}
              </button>
            );
          })}
        </div>
      </details>
      {/* فهرست مجازی با ارتفاع متغیر: سرتیتر گروه‌ها هم داخل همان فهرست
          رندر می‌شوند تا با هزاران تجهیز، DOM سبک بماند. */}
      <VirtualList
        items={rows}
        itemHeight={56}
        heightOf={(r) => (r.kind === 'group' ? 34 : 56)}
        keyOf={(r) => r.key}
        empty={
          <EmptyState
            title="تجهیزی یافت نشد"
            description="با فیلترهای فعلی تجهیزی نیست؛ فیلتر جست‌وجو/وضعیت/گروه را تغییر دهید یا تجهیز جدید بسازید."
            icon={<MapPin size={22} />}
          />
        }
        render={(row) =>
          row.kind === 'group' ? (
            <div className="flex h-[34px] items-center justify-between gap-1 border-b border-ink-100 pb-1 pt-1.5">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 text-right"
                onClick={() => setCollapsed((prev) => (prev.includes(row.group) ? prev.filter((g) => g !== row.group) : [...prev, row.group]))}
                title={collapsed.includes(row.group) ? 'باز کردن گروه' : 'جمع کردن گروه'}
              >
                {collapsed.includes(row.group) ? (
                  <ChevronLeft size={13} className="shrink-0 text-ink-400" />
                ) : (
                  <ChevronDown size={13} className="shrink-0 text-ink-400" />
                )}
                <span className="truncate text-[11.5px] font-semibold text-ink-600">{row.name}</span>
                <span className="num shrink-0 rounded-pill bg-ink-100 px-1.5 text-[10px] text-ink-500">{faDigits(row.count)}</span>
              </button>
              <button
                type="button"
                className="btn-ghost btn-xs shrink-0 !px-1"
                onClick={() => onToggleGroup(row.group)}
                title={row.hidden ? `نمایش ${row.name} روی نقشه` : `مخفی کردن ${row.name} روی نقشه`}
                aria-pressed={!row.hidden}
              >
                {row.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                <span className="num text-[9.5px] text-ink-400">
                  {faDigits(row.positioned)}/{faDigits(row.count)}
                </span>
              </button>
            </div>
          ) : (
            <div
              draggable
              onDragStart={(e) => {
                const d = row.device;
                e.dataTransfer.setData('text/nw-device', String(d.id));
                e.dataTransfer.setData('text/plain', String(d.id));
                e.dataTransfer.effectAllowed = 'move';
                onDragStart(d.id);
              }}
              className={`mb-1 flex h-[52px] cursor-grab items-center justify-between gap-2 rounded-soft border bg-white/70 px-2.5 py-2 transition active:cursor-grabbing ${
                selectedId === row.device.id ? 'border-brand-300 ring-1 ring-brand-200' : 'border-ink-100 hover:border-brand-200'
              }`}
              title="برای جانمایی، بکشید و روی نقشه رها کنید"
            >
              <button type="button" className="min-w-0 flex-1 text-right" onClick={() => onFlyTo(row.device.id)}>
                <span className="block truncate text-[12px] font-medium text-ink-700">{row.device.name}</span>
                <span className="num block text-[10.5px] text-ink-400">
                  {row.device.latitude == null || row.device.longitude == null
                    ? 'بدون مختصات — کلیک کنید و محل را روی نقشه مشخص کنید'
                    : `${row.device.latitude.toFixed(4)}, ${row.device.longitude.toFixed(4)}`}
                </span>
              </button>
              {row.device.latitude == null ? <MapPin size={12} className="shrink-0 text-sun-500" /> : null}
              <StatusPill status={row.device.status} size="sm" showLabel={false} />
              <Link to={`/devices/${row.device.id}`} className="btn-ghost btn-xs">
                جزئیات
              </Link>
            </div>
          )
        }
      />
      <p className="mt-2 border-t border-ink-100 pt-2 text-center text-[10px] leading-relaxed text-ink-400">
        {`${faDigits(devices.length)} تجهیز در ${faDigits(new Set(devices.map((d) => d.groupName || '__none__')).size)} گروه — فهرست مجازی، فقط ردیف‌های دیده‌شده رندر می‌شوند.`}
      </p>
    </div>
  );
}

/* ============================== فهرست علامت‌ها ============================== */
function MarkersList({
  types,
  markers,
  hiddenTypeIds,
  onToggleType,
  showLabels,
  onToggleLabels,
  armedTypeId,
  onArm,
  onFlyTo,
  onEdit,
  onChanged,
}: {
  types: MarkerType[];
  markers: MapMarker[];
  hiddenTypeIds: number[];
  onToggleType: (id: number) => void;
  showLabels: boolean;
  onToggleLabels: (v: boolean) => void;
  armedTypeId: number | null;
  onArm: (t: MarkerType) => void;
  onFlyTo: (m: MapMarker) => void;
  onEdit: (m: MapMarker) => void;
  onChanged: () => void;
}) {
  const { push } = useToast();
  const [tab, setTab] = useState<'place' | 'types'>('place');
  const [typeForm, setTypeForm] = useState<Partial<MarkerType> | null>(null);
  const [filterType, setFilterType] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = filterType === '' ? markers : markers.filter((m) => m.typeId === filterType);

  const importFile = async (file: File) => {
    setBusy(true);
    try {
      // KML/KMZ (ترسیم‌های Google Earth) هم مسیر ورود خودش را دارد؛ صفحه‌گسترده
      // از همان مسیر Excel/CSV می‌رود.
      if (/\.(kml|kmz)$/i.test(file.name)) {
        const chosen = types.find((t) => t.id === filterType) ?? null;
        const res = await api.markerImportKml(file, { typeId: chosen?.id ?? null, type: chosen?.name });
        const skipped = res.skipped ? ` — ${faDigits(res.skipped)} مورد بدون نقطه یافت شد` : '';
        push(`${faDigits(res.inserted)} علامت از KML/KMZ وارد شد${skipped}`, res.inserted ? 'success' : 'warning');
        onChanged();
        return;
      }
      const res = await api.markerImport(file, 'append');
      push(`${faDigits(res.inserted)} علامت وارد شد${res.skipped ? ` — ${faDigits(res.skipped)} ردیف نامعتبر` : ''}`, res.inserted ? 'success' : 'warning');
      onChanged();
    } catch (e) {
      push((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-0.5 rounded-soft border border-ink-200 bg-white/70 p-0.5 text-[11px]" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'place'}
            className={`rounded-lg px-2 py-1 font-medium transition ${tab === 'place' ? 'bg-brand-50 text-brand-700' : 'text-ink-500 hover:text-ink-700'}`}
            onClick={() => setTab('place')}
          >
            جانمایی ({faDigits(markers.length)})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'types'}
            className={`rounded-lg px-2 py-1 font-medium transition ${tab === 'types' ? 'bg-brand-50 text-brand-700' : 'text-ink-500 hover:text-ink-700'}`}
            onClick={() => setTab('types')}
          >
            انواع ({faDigits(types.length)})
          </button>
        </div>
        <Toggle checked={showLabels} onChange={onToggleLabels} label="برچسب" />
      </div>

      {tab === 'place' ? (
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          <select className="field !w-full !rounded-pill !py-1.5 text-[12px]" value={filterType} onChange={(e) => setFilterType(e.target.value ? Number(e.target.value) : '')}>
            <option value="">همه انواع علامت</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {/* نمایش/عدم نمایش انواع مختلف علامت روی نقشه و در فهرست */}
          <details className="mt-1.5 rounded-soft border border-ink-200 bg-white/70 px-2.5 py-1.5">
            <summary className="cursor-pointer text-[11px] font-medium text-ink-600">
              نمایش انواع {hiddenTypeIds.length ? `(${faDigits(hiddenTypeIds.length)} مخفی)` : ''}
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {types.map((t) => {
                const hidden = hiddenTypeIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onToggleType(t.id)}
                    className={`inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[10.5px] transition ${
                      hidden ? 'border-ink-200 bg-ink-50 text-ink-400 line-through' : 'border-brand-200 bg-brand-50 text-brand-700'
                    }`}
                    aria-pressed={!hidden}
                    style={hidden ? undefined : { borderColor: `${t.color}55`, background: `${t.color}12`, color: t.color }}
                  >
                    {hidden ? <EyeOff size={10} /> : <Eye size={10} />}
                    <MarkerGlyph name={t.icon} size={10} />
                    {t.name}
                  </button>
                );
              })}
              {types.length === 0 ? <span className="text-[10.5px] text-ink-400">نوعی تعریف نشده است</span> : null}
            </div>
          </details>

          <div className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pe-1">
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-[11px] text-ink-400">علامتی جانمایی نشده است</p>
            ) : (
              filtered.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 rounded-soft border border-ink-100 bg-white/70 px-2.5 py-2">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-right" onClick={() => onFlyTo(m)}>
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full" style={{ background: `${m.typeColor || '#0ea5e9'}1f`, color: m.typeColor || '#0ea5e9' }}>
                      <MarkerGlyph name={m.typeIcon} size={13} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium text-ink-700">{m.name}</span>
                      <span className="num block text-[10px] text-ink-400">
                        {m.typeName} · {m.latitude.toFixed(4)}, {m.longitude.toFixed(4)}
                      </span>
                    </span>
                  </button>
                  <button type="button" className="btn-ghost btn-xs" title="ویرایش" onClick={() => onEdit(m)}>
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="btn-danger btn-xs"
                    title="حذف"
                    onClick={async () => {
                      if (!window.confirm(`علامت «${m.name}» حذف شود؟`)) return;
                      try {
                        await api.deleteMarker(m.id);
                        push('علامت حذف شد', 'success');
                        onChanged();
                      } catch (e) {
                        push((e as Error).message, 'error');
                      }
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="mt-2 space-y-2 border-t border-ink-100 pt-2">
            <button
              type="button"
              className="btn-primary btn-xs w-full justify-center"
              disabled={!types.length}
              onClick={() => {
                const t = types.find((x) => x.id === filterType) ?? types[0];
                if (t) onArm(t);
              }}
            >
              <Crosshair size={13} />
              جانمایی علامت روی نقشه
            </button>
            {armedTypeId ? <p className="text-center text-[10.5px] text-brand-600">در انتظار کلیک روی نقشه…</p> : null}

            <div className="flex flex-wrap items-center gap-1.5">
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.kml,.kmz" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.currentTarget.value = ''; }} />
              <button type="button" className="btn-ghost btn-xs flex-1 justify-center" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload size={12} />
                ورود از فایل
              </button>
              <a className="btn-ghost btn-xs flex-1 justify-center" href={downloadUrl('/markers/export', { format: 'xlsx' })}>
                <Download size={12} />
                خروجی
              </a>
              <a className="btn-ghost btn-xs flex-1 justify-center" href={downloadUrl('/markers/template', { format: 'xlsx' })}>
                <Download size={12} />
                فایل نمونه
              </a>
            </div>
            <p className="text-[10px] leading-relaxed text-ink-400">
              ورودی: فایل Excel/CSV (نام، نوع، عرض و طول جغرافیایی، توضیحات) یا فایل ترسیم <span className="ltr">KML/KMZ</span>. هر Placemark به یک علامت تبدیل می‌شود؛ اگر نوعی در فهرست انتخاب شده باشد همان نوع به علامت‌های تازه داده می‌شود.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pe-1">
            {types.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 rounded-soft border border-ink-100 bg-white/70 px-2.5 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full" style={{ background: `${t.color}1f`, color: t.color }}>
                    <MarkerGlyph name={t.icon} size={13} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-ink-700">{t.name}</span>
                    <span className="num block text-[10px] text-ink-400">{faDigits(t.markerCount ?? 0)} علامت</span>
                  </span>
                </span>
                <button type="button" className="btn-ghost btn-xs" onClick={() => setTypeForm(t)}>
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  className="btn-danger btn-xs"
                  onClick={async () => {
                    if (!window.confirm(`نوع «${t.name}» حذف شود؟ علامت‌های این نوع بدون نوع خواهند شد.`)) return;
                    try {
                      await api.deleteMarkerType(t.id);
                      push('نوع علامت حذف شد', 'success');
                      onChanged();
                    } catch (e) {
                      push((e as Error).message, 'error');
                    }
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {types.length === 0 ? <p className="py-6 text-center text-[11px] text-ink-400">نوعی تعریف نشده است</p> : null}
          </div>
          <button type="button" className="btn-soft btn-xs mt-2 w-full justify-center" onClick={() => setTypeForm({})}>
            <Plus size={13} />
            نوع علامت جدید
          </button>
        </div>
      )}

      {typeForm ? <MarkerTypeForm draft={typeForm} onClose={() => setTypeForm(null)} onSaved={() => { setTypeForm(null); onChanged(); }} /> : null}
    </div>
  );
}

/* ---------------------------- فرم نوع علامت ---------------------------- */
function MarkerTypeForm({ draft, onClose, onSaved }: { draft: Partial<MarkerType>; onClose: () => void; onSaved: () => void }) {
  const { push } = useToast();
  const editing = !!draft.id;
  const [name, setName] = useState(draft.name ?? '');
  const [color, setColor] = useState(draft.color ?? '#0ea5e9');
  const [icon, setIcon] = useState(draft.icon ?? 'map-pin');
  const [description, setDescription] = useState(draft.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const { busy: saving, run: runGuarded } = useSubmitGuard();

  const submit = () => {
    if (!name.trim()) return setError('نام نوع علامت الزامی است');
    void runGuarded(async () => {
      try {
        if (editing) await api.updateMarkerType(draft.id!, { name, color, icon, description });
        else await api.createMarkerType({ name, color, icon, description });
        push(editing ? 'نوع علامت به‌روزرسانی شد' : 'نوع علامت ساخته شد', 'success');
        onSaved();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={editing ? `ویرایش نوع — ${draft.name}` : 'نوع علامت جدید'}
      subtitle="نام، رنگ و آیکون این نوع علامت را مشخص کنید"
      footer={
        <>
          {error ? <p className="me-auto text-xs text-red-600">{error}</p> : null}
          <button type="button" className="btn-ghost" onClick={onClose}>
            انصراف
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
            {saving ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نام نوع علامت" required className="sm:col-span-2">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً تجهیز در حال نصب" />
        </Field>
        <Field label="رنگ">
          <ColorField value={color} onChange={setColor} />
        </Field>
        <Field label="آیکون">
          <select className="field" value={icon} onChange={(e) => setIcon(e.target.value)}>
            {MARKER_ICON_NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="توضیحات" className="sm:col-span-2">
          <input className="field" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="sm:col-span-2 flex items-center gap-3 rounded-soft border border-ink-200 bg-white/70 p-3">
          <span className="text-[11.5px] text-ink-500">پیش‌نمایش:</span>
          <span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: `${color}1f`, color }}>
            <MarkerGlyph name={icon} size={16} />
          </span>
          <span className="text-[12.5px] font-medium text-ink-700">{name || 'نام نوع علامت'}</span>
        </div>
      </div>
    </Modal>
  );
}

/* ----------------------------- فرم علامت ----------------------------- */
function MarkerForm({
  open,
  draft,
  types,
  onClose,
  onSaved,
}: {
  open: boolean;
  draft: { latitude: number; longitude: number; typeId: number | null; typeName: string; marker?: MapMarker } | null;
  types: MarkerType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { push } = useToast();
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState<string>('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { busy: saving, run: runGuarded } = useSubmitGuard();

  useEffect(() => {
    if (!open || !draft) return;
    setError(null);
    setName(draft.marker?.name ?? '');
    setTypeId(String(draft.marker?.typeId ?? draft.typeId ?? types[0]?.id ?? ''));
    setLatitude(String(draft.marker?.latitude ?? draft.latitude));
    setLongitude(String(draft.marker?.longitude ?? draft.longitude));
    setNotes(draft.marker?.notes ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  if (!open || !draft) return null;
  const editing = !!draft.marker;

  const submit = () => {
    if (!name.trim()) return setError('نام علامت الزامی است');
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return setError('عرض جغرافیایی نامعتبر است');
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return setError('طول جغرافیایی نامعتبر است');
    void runGuarded(async () => {
      try {
        const payload = { name: name.trim(), type_id: Number(typeId) || null, latitude: lat, longitude: lng, notes };
        if (editing) await api.updateMarker(draft.marker!.id, payload);
        else await api.createMarker(payload);
        push(editing ? 'علامت به‌روزرسانی شد' : 'علامت روی نقشه جانمایی شد', 'success');
        onSaved();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={editing ? `ویرایش علامت — ${draft.marker!.name}` : 'جانمایی علامت جدید'}
      subtitle={editing ? 'مشخصات علامت را ویرایش کنید' : 'نام و نوع این علامت را مشخص کنید'}
      footer={
        <>
          {error ? <p className="me-auto text-xs text-red-600">{error}</p> : null}
          <button type="button" className="btn-ghost" onClick={onClose}>
            انصراف
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
            <Save size={15} />
            {saving ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نام علامت" required className="sm:col-span-2">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً نصب سوئیچ — ساختمان اداری" />
        </Field>
        <Field label="نوع علامت" className="sm:col-span-2">
          <select className="field" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="عرض جغرافیایی">
          <input dir="ltr" className="field num" value={latitude} onChange={(e) => setLatitude(e.target.value)} />
        </Field>
        <Field label="طول جغرافیایی">
          <input dir="ltr" className="field num" value={longitude} onChange={(e) => setLongitude(e.target.value)} />
        </Field>
        <Field label="توضیحات" className="sm:col-span-2">
          <textarea className="field min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------------------------- popups ---------------------------- */
function popupHtml(device: MapDevice) {
  const meta = statusMeta(device.status);
  return `
  <div style="min-width:220px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <strong style="font-size:13px;color:#1e293b">${escapeHtml(device.name)}</strong>
      <span style="font-size:10.5px;padding:2px 8px;border-radius:99px;background:${meta.chart}1a;color:${meta.chart};border:1px solid ${meta.chart}33">${meta.label}</span>
    </div>
    <div style="margin-top:8px;font-size:11.5px;color:#475569;display:grid;gap:4px">
      <div style="display:flex;justify-content:space-between"><span style="color:#94a3b8">آدرس IP</span><span style="font-family:monospace">${escapeHtml(device.ip)}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#94a3b8">نوع تجهیز</span><span>${escapeHtml(device.deviceType)}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#94a3b8">گروه</span><span>${escapeHtml(device.groupName ?? '—')}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#94a3b8">تأخیر</span><span>${device.lastRtt == null ? '—' : device.lastRtt.toFixed(1) + ' ms'}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#94a3b8">موقعیت</span><span>${escapeHtml(device.location || '—')}</span></div>
    </div>
    <a href="/devices/${device.id}" style="display:block;margin-top:10px;text-align:center;font-size:11.5px;padding:6px;border-radius:10px;background:#eff6ff;color:#1d4ed8;text-decoration:none">مشاهده صفحه تجهیز</a>
  </div>`;
}

function markerPopupHtml(m: MapMarker) {
  return `
  <div style="min-width:200px">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="display:inline-block;width:10px;height:10px;border-radius:99px;background:${m.typeColor || '#0ea5e9'}"></span>
      <strong style="font-size:13px;color:#1e293b">${escapeHtml(m.name)}</strong>
    </div>
    <div style="margin-top:8px;font-size:11.5px;color:#475569;display:grid;gap:4px">
      <div style="display:flex;justify-content:space-between"><span style="color:#94a3b8">نوع</span><span>${escapeHtml(m.typeName ?? '—')}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#94a3b8">عرض / طول</span><span style="font-family:monospace">${m.latitude.toFixed(5)}, ${m.longitude.toFixed(5)}</span></div>
      ${m.notes ? `<div style="color:#475569">${escapeHtml(m.notes)}</div>` : ''}
    </div>
    <p style="margin-top:8px;font-size:10.5px;color:#94a3b8">برای ویرایش از پنل «علامت‌ها» استفاده کنید.</p>
  </div>`;
}

/* ---------------------------- Layer manager ---------------------------- */
function LayerManager({
  open,
  onClose,
  layers,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  layers: MapLayer[];
  onChanged: () => void;
}) {
  const { push } = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.uploadLayer(file, name || undefined);
      push(`لایه «${res.layer.name}» با ${faDigits(res.info.tileCount ?? 0)} کاشی بارگذاری شد`, 'success');
      setName('');
      onChanged();
    } catch (e) {
      push((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="مدیریت لایه‌های نقشه"
      subtitle="لایه‌های آفلاین MBTiles — هم تصویری (Raster) و هم برداری (Vector) — بدون نیاز به اینترنت"
      footer={
        <button type="button" className="btn-ghost" onClick={onClose}>
          بستن
        </button>
      }
    >
      <div className="space-y-4">
        <div className="rounded-soft border border-brand-100 bg-brand-50/50 p-4">
          <p className="text-[12.5px] font-medium text-brand-800">بارگذاری نقشه آفلاین (.mbtiles)</p>
          <p className="mt-1 text-[11px] text-brand-700/80">
            فایل MBTiles را انتخاب کنید. کاشی‌های تصویری (PNG/JPEG) با Leaflet و کاشی‌های برداری (PBF/MVT) با MapLibre سرو می‌شوند.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input className="field !w-auto flex-1" placeholder="نام نمایشی لایه (اختیاری)" value={name} onChange={(e) => setName(e.target.value)} />
            <input
              ref={fileRef}
              type="file"
              accept=".mbtiles"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.currentTarget.value = '';
              }}
            />
            <button type="button" className="btn-primary btn-xs" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload size={14} />
              {busy ? 'در حال بارگذاری…' : 'انتخاب فایل MBTiles'}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {layers.map((l) => {
            const vector = isVectorLayer(l);
            return (
              <div key={l.id} className="rounded-soft border border-ink-200 bg-white/80 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[12.5px] font-semibold text-ink-700">{l.name}</p>
                      {l.is_default ? <Badge tone="brand">پیش‌فرض</Badge> : null}
                      <Badge tone={l.kind === 'mbtiles' ? 'emerald' : l.kind === 'builtin' ? 'brand' : 'ink'}>
                        {l.kind === 'mbtiles' ? (vector ? 'MBTiles برداری' : 'MBTiles تصویری') : l.kind === 'builtin' ? 'داخلی' : 'خالی'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-500">{l.description || '—'}</p>
                    <p className="num mt-1 text-[10.5px] text-ink-400">
                      {l.file_name ? `${l.file_name} · ` : ''}
                      {faDigits(l.tile_count ?? 0)} کاشی · زوم {faDigits(l.min_zoom)} تا {faDigits(l.max_zoom)}
                      {vector && l.fileInfo?.vectorLayers?.length ? ` · ${faDigits(l.fileInfo.vectorLayers.length)} لایه برداری` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Toggle
                      checked={!!l.visible}
                      onChange={async (v) => {
                        await api.updateLayer(l.id, { visible: v ? 1 : 0 });
                        onChanged();
                      }}
                      label={l.visible ? 'نمایش' : 'مخفی'}
                    />
                    {!l.is_default ? (
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        onClick={async () => {
                          await api.updateLayer(l.id, { is_default: 1 });
                          onChanged();
                          push('لایه پیش‌فرض تغییر کرد', 'success');
                        }}
                      >
                        <Save size={13} />
                        پیش‌فرض
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn-danger btn-xs"
                      onClick={async () => {
                        if (!window.confirm(`لایه «${l.name}» حذف شود؟`)) return;
                        try {
                          await api.deleteLayer(l.id, l.kind === 'mbtiles');
                          onChanged();
                          push('لایه حذف شد', 'success');
                        } catch (e) {
                          push((e as Error).message, 'error');
                        }
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-soft border border-ink-200 bg-white/70 p-3">
          <span className="text-[11.5px] text-ink-500">ایجاد لایه خالی برای دسته‌بندی تجهیزات:</span>
          <button
            type="button"
            className="btn-soft btn-xs"
            onClick={async () => {
              const label = window.prompt('نام لایه جدید:');
              if (!label) return;
              await api.createLayer({ name: label, kind: 'empty' });
              onChanged();
              push('لایه جدید ساخته شد', 'success');
            }}
          >
            <Plus size={13} />
            افزودن لایه
          </button>
        </div>
      </div>
    </Modal>
  );
}
