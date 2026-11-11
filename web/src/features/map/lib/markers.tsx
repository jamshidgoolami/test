import L from 'leaflet';
import {
  Camera,
  CirclePlus,
  Eye,
  Flag,
  Hammer,
  HardHat,
  MapPin,
  Star,
  TriangleAlert,
  Wifi,
  Wrench,
} from 'lucide-react';
import { statusMeta } from '../../../lib/format';
import type { MapMarker } from '../../../lib/types';
import type { MapDevice, MapSite } from '../model/types';

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function markerIcon(device: MapDevice, showLabel: boolean) {
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

export function markerPinIcon(marker: MapMarker, showLabel: boolean) {
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

/** نشان ایستگاه کمی بزرگ‌تر از نشان تجهیز منفرد و با شمار تجهیزات عضو */
export function siteMarkerIcon(site: MapSite, showLabel: boolean) {
  const label = showLabel ? `<span class="nw-map-label">${escapeHtml(site.name)}</span>` : '';
  const count = site.devices.length.toLocaleString('fa-IR');
  return L.divIcon({
    className: 'nw-site-marker',
    html: `<span class="nw-site"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/></svg><span class="nw-site-count">${count}</span>${label}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

/* --------------------------- آیکون علامت‌ها --------------------------- */
export const MARKER_ICON_NAMES = [
  'map-pin',
  'hammer',
  'eye',
  'triangle-alert',
  'circle-plus',
  'wrench',
  'camera',
  'wifi',
  'flag',
  'star',
  'hard-hat',
];

export function MarkerGlyph({
  name,
  size = 14,
  className = '',
}: {
  name?: string | null;
  size?: number;
  className?: string;
}) {
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
