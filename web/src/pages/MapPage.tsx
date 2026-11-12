import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';

import { Crosshair, Download, Flag, Layers, MapPin, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, RefreshCw, Ruler, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useAsync, useSubmitGuard, useToast } from '../lib/store';
import { faDigits, fmtRelative, statusMeta } from '../lib/format';
import { useUrlParams } from '../lib/params';
import { Card, ErrorState } from '../components/ui';
import type { MapLayer, MapMarker } from '../lib/types';


import { DeviceList } from '../features/map/components/DeviceList';
import { MapEditBanner } from '../features/map/components/MapEditBanner';
import { MapMeasurePanel } from '../features/map/components/MapMeasurePanel';
import { SiteFormModal } from '../features/map/components/SiteFormModal';
import { MarkersList } from '../features/map/components/MarkersList';
import { MarkerForm } from '../features/map/components/MarkerForms';
import { MapLayersPanel } from '../features/map/components/MapLayersPanel';
import { CoordsExportModal } from '../features/map/components/CoordsExportModal';
import { markerIcon, markerPinIcon, siteMarkerIcon } from '../features/map/lib/markers';
import { popupHtml, sitePopupElement, markerPopupHtml } from '../features/map/components/mapPopups';
import { useMapLayers } from '../features/map/hooks/useMapLayers';
import { useMapLabels } from '../features/map/hooks/useMapLabels';
import { useMapMeasure } from '../features/map/hooks/useMapMeasure';
import type { ArmedMarkerType, MapDevice, MapSite, PendingMapPosition, SitePopupView } from '../features/map/model/types';

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
  const siteLayer = useRef<L.LayerGroup | null>(null);
  const siteMarkers = useRef<Map<number, L.Marker>>(new Map());
  const sitePopupViews = useRef<Map<number, SitePopupView>>(new Map());
  const flyTimers = useRef<number[]>([]);
  const devicesRef = useRef<MapDevice[]>([]);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  // راهنمای کوتاه حالت جابه‌جایی: متن بلند توضیحات فقط با دکمهٔ آیکون راهنما باز می‌شود.
  const [moveHelpOpen, setMoveHelpOpen] = useState(false);
  const [pending, setPending] = useState<PendingMapPosition | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  // دیالوگ خروجی مختصات: گروه تجهیزات و انواع علامت‌های حاضر در فایل را تعیین می‌کند.
  const [exportOpen, setExportOpen] = useState(false);
  // مرکز/زوم فعلی برای نمای بندانگشتی پنل لایه‌ها؛ روی هر جابه‌جایی نقشه تازه می‌شود.
  const [center, setCenter] = useState<[number, number]>(() => settings?.map_default_center ?? [35.6892, 51.389]);
  const layersOpenRef = useRef(false);
  layersOpenRef.current = layersOpen;
  const [placingDevice, setPlacingDevice] = useState<number | null>(null);
  const [sideOpen, setSideOpen] = useState(true);
  // عرض فهرست کنار نقشه با کشیدن لبهٔ مجاور نقشه تغییر می‌کند و در مرورگر
  // نگه داشته می‌شود تا بعد از بازگشت هم همان اندازه باشد.
  const [sideWidth, setSideWidth] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem('nw-map-side-width'));
      return Number.isFinite(saved) && saved >= 240 ? Math.min(560, saved) : 324;
    } catch {
      return 324;
    }
  });
  const sideWidthRef = useRef(sideWidth);
  sideWidthRef.current = sideWidth;
  const resizeState = useRef<{ startX: number; startWidth: number } | null>(null);
  const [sideTab, setSideTab] = useState<'devices' | 'markers'>('devices');
  const [armedType, setArmedType] = useState<ArmedMarkerType | null>(null);
  const [pendingMarker, setPendingMarker] = useState<{ latitude: number; longitude: number; typeId: number | null; typeName: string; typeColor: string; typeIcon: string; marker?: MapMarker } | null>(null);
  const [showMarkerLabels, setShowMarkerLabels] = useState(true);
  // فهرست نقشه همیشه همهٔ تجهیزات/علامت‌ها را دارد؛ این دو مجموعه فقط نمایش
  // گروه‌ها و انواع را روی نقشه و فهرست کنترل می‌کنند.
  const [hiddenGroups, setHiddenGroups] = useState<string[]>([]);
  // ایستگاه‌ها هم مثل گروه‌ها قابل مخفی کردن هستند؛ تجهیزات عضو ایستگاه
  // نشانگر مستقل ندارند و با ایستگاهشان پنهان می‌شوند.
  const [hiddenSiteIds, setHiddenSiteIds] = useState<number[]>([]);
  const [siteFormOpen, setSiteFormOpen] = useState(false);
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
  const { data: sitesData, refresh: refreshSites } = useAsync((signal) => api.sites(signal), []);
  const devices = useMemo(() => (mapData?.items ?? []) as MapDevice[], [mapData]);
  devicesRef.current = devices;
  // refresh در هر رندر تابع تازه است؛ افکت‌های نقشه نباید با آن بی‌دلیل بازسازی شوند.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const layers = layersData?.items ?? [];
  const { vectorMaps, vectorMapsTick } = useMapLayers({ mapRef, ready, layers, tileLayers, notify: push });
  useMapLabels({ mapRef, ready, vectorMaps, vectorMapsTick });
  const mapMarkers = markersData?.items ?? [];
  const markerTypes = markersData?.types ?? [];
  const sites = useMemo(() => sitesData?.items ?? [], [sitesData]);
  // هر ایستگاه با تجهیزات عضو و موقعیت میانگینش ساخته می‌شود تا هم نقشه و
  // هم فهرست کنار نقشه از یک منبع بخوانند.
  const mapSites = useMemo<MapSite[]>(() => {
    const bySite = new Map<number, MapSite>();
    for (const s of sites) {
      bySite.set(s.id, { id: s.id, name: s.name, groupName: s.group_name ?? null, devices: [], latitude: null, longitude: null });
    }
    for (const d of devices) {
      if (d.siteId == null) continue;
      const site = bySite.get(d.siteId);
      if (!site) continue;
      site.devices.push(d);
      if (!site.groupName) site.groupName = d.groupName ?? null;
    }
    for (const site of bySite.values()) {
      site.devices.sort((a, b) => a.name.localeCompare(b.name, 'fa'));
      const located = site.devices.filter((d) => d.latitude != null && d.longitude != null);
      if (!located.length) continue;
      site.latitude = located.reduce((sum, d) => sum + Number(d.latitude), 0) / located.length;
      site.longitude = located.reduce((sum, d) => sum + Number(d.longitude), 0) / located.length;
    }
    return [...bySite.values()].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  }, [sites, devices]);
  const mapSitesRef = useRef<MapSite[]>([]);
  mapSitesRef.current = mapSites;
  /**
   * جابه‌جایی تجهیز روی نقشه. اگر تجهیز عضو یک ایستگاه باشد، کل ایستگاه به همان
   * نقطه می‌رود؛ مختصات همهٔ اعضا یکسان می‌شود تا میانگین ایستگاه دقیقاً همان
   * نقطه باشد و نشان ایستگاه روی محل جدید بماند.
   */
  const moveDevice = useCallback(async (id: number, latitude: number, longitude: number) => {
    const device = devicesRef.current.find((d) => d.id === id);
    const site =
      device?.siteId != null ? mapSitesRef.current.find((s) => s.id === device.siteId) : undefined;
    const ids = site?.devices.length ? site.devices.map((d) => d.id) : [id];
    await api.positions(ids.map((deviceId) => ({ id: deviceId, latitude, longitude })));
    return site;
  }, []);
  /**
   * پایان حالت جابه‌جایی از کادر شناور پایین نقشه.
   * انتخاب‌های در جریان (تجهیز در انتظار کلیک و موقعیتِ ذخیره‌نشده) پاک می‌شوند تا
   * پس از بستن حالت، کادر «موقعیت جدید» روی نقشه نماند.
   */
  const stopEditMode = useCallback(() => {
    setEditing(false);
    setPlacingDevice(null);
    setPending(null);
    setMoveHelpOpen(false);
  }, []);
  const groupNames = useMemo(() => {
    const names = new Set<string>();
    for (const d of devices) names.add(d.groupName || '__none__');
    for (const s of mapSites) names.add(s.groupName || '__none__');
    return [...names].sort((a, b) => a.localeCompare(b, 'fa'));
  }, [devices, mapSites]);
  // گزینه‌های گروه در دیالوگ خروجی از فهرست کامل گروه‌ها می‌آید (نه فیلتر فعلی صفحه).
  const exportGroups = useMemo(() => [...(meta?.groups ?? []).map((g) => g.name), '__none__'], [meta]);
  // تجهیزات عضو ایستگاه نشانگر و ردیف مستقل ندارند؛ ایستگاه جای آن‌ها را می‌گیرد.
  const individualDevices = useMemo(() => devices.filter((d) => d.siteId == null), [devices]);
  const visibleDevices = useMemo(
    () => individualDevices.filter((d) => !hiddenGroups.includes(d.groupName || '__none__')),
    [individualDevices, hiddenGroups]
  );
  const visibleSites = useMemo(
    () =>
      mapSites.filter(
        (s) =>
          !hiddenGroups.includes(s.groupName || '__none__') &&
          !hiddenSiteIds.includes(s.id) &&
          s.latitude != null &&
          s.longitude != null
      ),
    [mapSites, hiddenGroups, hiddenSiteIds]
  );
  const visibleMarkers = useMemo(
    () => mapMarkers.filter((m) => m.typeId == null || !hiddenTypeIds.includes(m.typeId)),
    [mapMarkers, hiddenTypeIds]
  );
  const statusCounts = mapData?.stats ?? {};
  const missingGeo = mapData?.missingGeo ?? 0;
  const totalDevices = mapData?.total ?? 0;
  const withGeo = mapData?.withGeo ?? 0;

  /**
   * انتخاب نقشهٔ پایه از پنل شناور لایه‌ها.
   * در هر لحظه فقط یک نقشه فعال است؛ بقیه مخفی می‌شوند تا چند لایه روی هم
   * نیفتند. مدیریت و بارگذاری نقشهٔ جدید در تنظیمات برنامه انجام می‌شود.
   */
  const selectLayer = async (layer: MapLayer) => {
    if (layer.visible && layers.filter((l) => l.visible).length <= 1) return;
    try {
      await Promise.all(layers.map((l) => api.updateLayer(l.id, { visible: l.id === layer.id ? 1 : 0 })));
      refreshLayers();
      refreshMeta();
    } catch (e) {
      push((e as Error).message, 'error');
    }
  };

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
    siteLayer.current = L.layerGroup().addTo(map);
    setZoom(map.getZoom());
    // مرکز نقشه فقط وقتی در state نگه داشته می‌شود که پنل لایه‌ها باز باشد؛
    // تا جابه‌جایی‌های عادی صفحه را بی‌دلیل رندر نکنند.
    const onView = () => {
      setZoom(map.getZoom());
      if (layersOpenRef.current) {
        const c = map.getCenter();
        setCenter([c.lat, c.lng]);
      }
    };
    map.on('zoomend', onView);
    map.on('moveend', onView);
    setReady(true);
    return () => {
      for (const id of flyTimers.current) window.clearTimeout(id);
      flyTimers.current = [];
      map.off('zoomend', onView);
      map.off('moveend', onView);
      map.remove();
      mapRef.current = null;
      deviceLayer.current = null;
      siteLayer.current = null;
      siteMarkers.current.clear();
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
    setCenter([center[0], center[1]]);
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
          await moveDevice(device.id, latitude, longitude);
          push(`موقعیت «${device.name}» به‌روزرسانی شد`, 'success');
          refresh();
        } catch (e) {
          push((e as Error).message, 'error');
          marker.setLatLng([lat, lng]);
        }
      });
      markers.current.set(device.id, marker);
    }
  }, [visibleDevices, ready, editing, settings?.map_show_labels, zoom, moveDevice]);

  /* --------------------------- نشانگر ایستگاه‌ها --------------------------- */
  // نشان ایستگاه بزرگ‌تر از تجهیز منفرد است و با کلیک، فهرست تجهیزات عضو را
  // باز می‌کند؛ کلیک روی هر ردیف، جزئیات همان تجهیز را در همان پاپ‌آپ نشان می‌دهد.
  useEffect(() => {
    const map = mapRef.current;
    const layer = siteLayer.current;
    if (!map || !ready || !layer) return;

    layer.clearLayers();
    siteMarkers.current.clear();
    sitePopupViews.current.clear();
    const showLabel = zoom >= 12 || !!settings?.map_show_labels;

    for (const site of visibleSites) {
      const lat = Number(site.latitude);
      const lng = Number(site.longitude);
      // فهرست و جزئیات هر دو در همین عنصر ساخته می‌شوند و کلیک ردیف‌ها مستقیم
      // به همان عنصر وصل می‌شود؛ نیازی به بازنویسی محتوای پاپ‌آپ نیست.
      const view = sitePopupElement(site);
      const marker = L.marker([lat, lng], {
        icon: siteMarkerIcon(site, showLabel),
        riseOnHover: true,
        zIndexOffset: 400,
        // ایستگاه هم مثل تجهیز و علامت در حالت جابه‌جایی کشیدنی است؛ کشیدن آن
        // همهٔ تجهیزات عضو را یک‌جا به همان نقطه می‌برد.
        draggable: editing,
      }).addTo(layer);
      siteMarkers.current.set(site.id, marker);
      sitePopupViews.current.set(site.id, view);
      marker.bindPopup(view.element, { closeButton: true, minWidth: 240, maxHeight: 320 });
      // با بسته شدن پاپ‌آپ، دفعهٔ بعد دوباره فهرست تجهیزات دیده می‌شود.
      marker.on('popupclose', view.showList);
      marker.on('click', () => {
        marker.openPopup();
        map.panTo([lat, lng]);
      });
      marker.on('dragend', async () => {
        const latlng = marker.getLatLng();
        const latitude = Number(latlng.lat.toFixed(6));
        const longitude = Number(latlng.lng.toFixed(6));
        try {
          await api.positions(site.devices.map((d) => ({ id: d.id, latitude, longitude })));
          push(`ایستگاه «${site.name}» به محل جدید منتقل شد`, 'success');
          refreshRef.current();
        } catch (e) {
          push((e as Error).message, 'error');
          marker.setLatLng([lat, lng]);
        }
      });
    }
  }, [visibleSites, ready, editing, settings?.map_show_labels, zoom, push]);

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

  const {
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
  } = useMapMeasure({ mapRef, ready });

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
        const site = await moveDevice(id, latitude, longitude);
        push(
          site
            ? `ایستگاه «${site.name}» به محل جدید منتقل شد`
            : `موقعیت «${device?.name ?? `#${id}`}» روی نقشه ثبت شد`,
          'success'
        );
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
        const site = await moveDevice(pending.id, pending.latitude, pending.longitude);
        push(site ? `ایستگاه «${site.name}» به محل جدید منتقل شد` : 'موقعیت تجهیز ذخیره شد', 'success');
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
            // مسیر جزئیات هنوز عضویت ایستگاه را برنمی‌گرداند؛ این حالت فقط
            // برای تجهیزی است که در فهرست نقشه نیست.
            siteId: null,
            siteName: null,
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
      // تجهیز عضو ایستگاه نشانگر مستقل ندارد؛ پاپ‌آپ ایستگاه با جزئیات همین
      // تجهیز باز می‌شود تا مثل یک تجهیز منفرد دیده شود.
      const site = mapSitesRef.current.find((s) => s.devices.some((m) => m.id === id));
      if (site) {
        sitePopupViews.current.get(site.id)?.showDevice(id);
        schedulePopup(() => siteMarkers.current.get(site.id));
        return;
      }
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

  /**
   * تغییر عرض فهرست با کشیدن دستگیرهٔ لبهٔ آن.
   * لبهٔ کشیدن، حاشیهٔ راست کادر فهرست (سمت نقشه) است؛ کشیدن آن به راست
   * فهرست را بزرگ‌تر و به چپ کوچک‌تر می‌کند و لبه با نشانگر حرکت می‌کند.
   * عرض در بازهٔ ۲۴۰ تا ۵۶۰ پیکسل محدود و پس از رها کردن در localStorage
   * ذخیره می‌شود.
   */
  const startSideResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (fullscreen || !sideOpen) return;
    event.preventDefault();
    resizeState.current = { startX: event.clientX, startWidth: sideWidth };
    const onMove = (moveEvent: PointerEvent) => {
      const state = resizeState.current;
      if (!state) return;
      const next = Math.min(560, Math.max(240, state.startWidth + (moveEvent.clientX - state.startX)));
      sideWidthRef.current = next;
      setSideWidth(next);
    };
    const onUp = () => {
      resizeState.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      try {
        window.localStorage.setItem('nw-map-side-width', String(sideWidthRef.current));
      } catch {
        /* ذخیرهٔ محلی اختیاری است */
      }
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // تغییر عرض فهرست، عرض نقشه را عوض می‌کند؛ Leaflet باید اندازهٔ تازه را بگیرد.
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => mapRef.current?.invalidateSize(), 120);
    return () => window.clearTimeout(timer);
  }, [sideWidth, ready]);

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
            <button type="button" className={`btn-xs ${editing ? 'btn-warn' : 'btn-ghost'}`} onClick={() => { setEditing((v) => !v); setPlacingDevice(null); setPending(null); setArmedType(null); setMoveHelpOpen(false); }} title="جابه‌جایی تجهیزات، ایستگاه‌ها و علامت‌ها روی نقشه" aria-pressed={editing}>
              <Crosshair size={14} />
              {editing ? 'حالت جابه‌جایی فعال' : 'جابه‌جایی موقعیت'}
            </button>
            <button type="button" className="btn-ghost btn-xs" onClick={refresh} aria-label="به‌روزرسانی نقشه">
              <RefreshCw size={14} />
              به‌روزرسانی
            </button>
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => setExportOpen(true)}
              aria-label="خروجی مختصات"
              title="خروجی مختصات"
            >
              <Download size={14} />
              خروجی مختصات
            </button>
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
            <span className="chip border-sun-200 bg-sun-50 text-warning">فهرست به سقف پاسخ سرور محدود شد</span>
          ) : null}
          {hiddenGroups.length ? <span className="chip border-ink-200 bg-ink-50 text-ink-600">{faDigits(hiddenGroups.length)} گروه مخفی</span> : null}
          {hiddenTypeIds.length ? <span className="chip border-ink-200 bg-ink-50 text-ink-600">{faDigits(hiddenTypeIds.length)} نوع علامت مخفی</span> : null}
          {missingGeo > 0 ? (
            <span className="chip border-sun-200 bg-sun-50 text-warning">
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

      {/* چیدمان: نقشه (مرکز) · فهرست تک‌پنلی تجهیزات/علامت‌ها (چپ) */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-stretch">
        <div className={fullscreen ? 'contents' : 'min-w-0 flex-1'}>
          <div
            className={
              fullscreen
                ? 'fixed inset-0 z-[1100] flex flex-col overflow-hidden rounded-none border-0 bg-surface shadow-pop'
                : 'relative overflow-hidden rounded-card border border-ink-200/70 bg-surface shadow-card'
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
                  className="grid h-8 w-8 place-items-center rounded-soft border border-ink-200 bg-surface/95 text-ink-600 shadow-soft transition hover:bg-surface hover:text-ink-900"
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
                  className="grid h-8 w-8 place-items-center rounded-soft border border-ink-200 bg-surface/95 text-ink-600 shadow-soft transition hover:bg-surface hover:text-ink-900"
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
            {/* کنترل‌های شناور روی نقشه — مثل نقشه‌های گوگل: لایه‌ها، اندازه‌گیری
                و تمام‌صفحه در یک ستون کم‌حجم، هم در حالت عادی و هم در تمام‌صفحه. */}
            <div
              className="pointer-events-none absolute inset-x-0 top-0 z-[540] flex items-start justify-start gap-2 p-3"
              dir="rtl"
            >
              <div className="pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-ink-200/70 bg-surface/95 shadow-pop backdrop-blur-md">
                <button
                  type="button"
                  className={`grid h-8 w-8 place-items-center transition ${
                    layersOpen ? 'bg-brand-50 text-accent' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900'
                  }`}
                  onClick={() => {
                    if (!layersOpen) setMeasureOpen(false);
                    const current = mapRef.current?.getCenter();
                    if (current) setCenter([current.lat, current.lng]);
                    setLayersOpen((value) => !value);
                  }}
                  aria-pressed={layersOpen}
                  aria-expanded={layersOpen}
                  aria-controls="map-layers-panel"
                  aria-label="لایه‌های نقشه"
                  title="لایه‌های نقشه"
                >
                  <Layers size={15} />
                </button>
                <span className="mx-auto h-px w-4 bg-ink-100" aria-hidden />
                <button
                  type="button"
                  className={`grid h-8 w-8 place-items-center transition ${
                    measureOpen ? 'bg-brand-50 text-accent' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900'
                  }`}
                  onClick={() => {
                    if (!measureOpen) setLayersOpen(false);
                    setMeasureOpen((value) => !value);
                  }}
                  aria-pressed={measureOpen}
                  aria-label="اندازه‌گیری روی نقشه"
                  title="اندازه‌گیری مسافت، مساحت و شعاع"
                >
                  <Ruler size={15} />
                </button>
                <span className="mx-auto h-px w-4 bg-ink-100" aria-hidden />
                <button
                  type="button"
                  className={`grid h-8 w-8 place-items-center transition ${
                    fullscreen ? 'bg-brand-50 text-accent' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900'
                  }`}
                  onClick={() => setFullscreen((value) => !value)}
                  aria-pressed={fullscreen}
                  aria-label={fullscreen ? 'خروج از تمام‌صفحه' : 'نمایش تمام‌صفحه'}
                  title={fullscreen ? 'خروج از تمام‌صفحه' : 'نمایش تمام‌صفحه'}
                >
                  {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
              </div>
              {layersOpen ? (
                <MapLayersPanel
                  layers={layers}
                  center={center}
                  zoom={zoom}
                  onSelect={(layer) => void selectLayer(layer)}
                  onClose={() => setLayersOpen(false)}
                />
              ) : null}
              {measureOpen ? (
                <MapMeasurePanel
                  mode={measureMode}
                  readout={measureReadout}
                  canFinish={canFinishMeasure}
                  onStart={startMeasure}
                  onFinish={finishMeasure}
                  onClear={clearMeasure}
                  onClose={closeMeasure}
                />
              ) : null}
            </div>
            {/* راهنمای شناور پایین نقشه: جانمایی علامت، حالت جابه‌جایی و موقعیت
                انتخاب‌شده در یک ستون می‌آیند تا روی هم نیفتند. متن بلند راهنما
                فقط با دکمهٔ آیکون راهنما باز می‌شود. */}
            <MapEditBanner
              armedType={armedType}
              editing={editing}
              pending={pending}
              placingDevice={placingDevice}
              moveHelpOpen={moveHelpOpen}
              saving={saving}
              onCancelArmed={() => setArmedType(null)}
              onToggleHelp={() => setMoveHelpOpen((value) => !value)}
              onStopEditing={stopEditMode}
              onCancelPending={() => setPending(null)}
              onSavePosition={savePosition}
            />
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
            .nw-site-marker { background: transparent; border: 0; }
            .nw-site { position: relative; display:grid; place-items:center; width:30px; height:30px; border-radius:10px;
              background:#1d4ed8; color:#fff; border:2.5px solid #fff; box-shadow:0 8px 20px -8px rgba(29,78,216,.95);
              font-family: Vazirmatn, Tahoma, sans-serif; }
            .nw-site-count { position:absolute; top:-7px; inset-inline-start:-7px; min-width:16px; height:16px; padding:0 4px;
              border-radius:999px; background:#0f172a; color:#fff; font-size:9.5px; font-weight:700; line-height:16px;
              text-align:center; direction:rtl; border:1.5px solid #fff; }
            .nw-site .nw-map-label { top: -3px; }
            /* کنترل زوم: دکمه‌های گرد و مدرن به‌جای مربع‌های پیش‌فرض Leaflet */
            .leaflet-control-zoom.leaflet-bar { border: 0 !important; border-radius: 14px !important; box-shadow: 0 10px 24px -10px rgba(15,23,42,.45) !important; overflow: hidden; background: transparent; }
            .leaflet-control-zoom a, .leaflet-touch .leaflet-control-zoom a { width: 36px !important; height: 36px !important; line-height: 34px !important; background: rgba(255,255,255,.94) !important; backdrop-filter: blur(10px); border: 0 !important; color: #334155 !important; font-size: 19px !important; font-weight: 600 !important; text-indent: 0 !important; transition: background .15s ease, color .15s ease; }
            .leaflet-control-zoom a:hover, .leaflet-touch .leaflet-control-zoom a:hover { background: #eff6ff !important; color: #1d4ed8 !important; }
            .leaflet-touch .leaflet-control-zoom-in { border-radius: 14px 14px 0 0 !important; border-bottom: 1px solid rgba(226,232,240,.9) !important; }
            .leaflet-touch .leaflet-control-zoom-out { border-radius: 0 0 14px 14px !important; }
            .leaflet-control-zoom a.leaflet-disabled, .leaflet-touch .leaflet-control-zoom a.leaflet-disabled { background: rgba(248,250,252,.85) !important; color: #cbd5e1 !important; }
            .leaflet-bottom .leaflet-control-zoom { margin-bottom: 16px; }
          `}</style>
        </div>

        <div
          className={
            fullscreen
              ? `fixed inset-y-0 left-0 z-[1200] flex w-[330px] max-w-[88vw] flex-col gap-2 p-3 transition-transform duration-300 ${
                  sideOpen ? 'translate-x-0' : 'pointer-events-none -translate-x-full'
                }`
              : `relative flex shrink-0 flex-col gap-2 ${sideOpen ? 'xl:w-[var(--nw-side-w)]' : 'xl:w-auto'}`
          }
          style={fullscreen ? undefined : ({ '--nw-side-w': `${sideWidth}px` } as React.CSSProperties)}
          aria-hidden={fullscreen && !sideOpen ? true : undefined}
        >
          {/* ناحیهٔ نامرئی روی لبهٔ راست خود کادر؛ بدون خط اضافه، خود حاشیهٔ منو
              با موس گرفته و کشیده می‌شود. */}
          {!fullscreen && sideOpen ? (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="تغییر عرض فهرست نقشه"
              title="برای بزرگ یا کوچک کردن فهرست، لبهٔ آن را بکشید"
              onPointerDown={startSideResize}
              className="absolute inset-y-0 -right-2 z-10 hidden w-4 cursor-col-resize xl:block"
              style={{ touchAction: 'none' }}
            />
          ) : null}
          {!sideOpen && !fullscreen ? (
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-soft border border-ink-200 bg-surface/90 text-ink-500 shadow-soft transition hover:text-ink-800"
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
                  sideTab === 'devices' ? 'bg-surface text-accent shadow-soft' : 'text-ink-500 hover:text-ink-700'
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
                  sideTab === 'markers' ? 'bg-surface text-accent shadow-soft' : 'text-ink-500 hover:text-ink-700'
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
                devices={individualDevices}
                groups={groupNames}
                sites={mapSites}
                hiddenGroups={hiddenGroups}
                hiddenSiteIds={hiddenSiteIds}
                onToggleGroup={(g) => setHiddenGroups((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]))}
                onToggleSite={(id) => setHiddenSiteIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
                onAddSite={() => setSiteFormOpen(true)}
                selectedId={pending?.id ?? placingDevice ?? null}
                onFlyTo={flyToDevice}
                onFlyToSite={(id) => {
                  const site = mapSites.find((s) => s.id === id);
                  const map = mapRef.current;
                  if (!site || !map || site.latitude == null || site.longitude == null) return;
                  map.setView([site.latitude, site.longitude], Math.max(map.getZoom(), 14), { animate: true });
                  sitePopupViews.current.get(id)?.showList();
                  schedulePopup(() => siteMarkers.current.get(id));
                }}
                onDragStart={(id) => {
                  if (editing) setPlacingDevice(id);
                }}
              />
            ) : (
              <MarkersList
                types={markerTypes}
                markers={visibleMarkers}
                hiddenTypeIds={hiddenTypeIds}
                onSetHiddenTypes={setHiddenTypeIds}
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

      <SiteFormModal
        open={siteFormOpen}
        groups={meta?.groups ?? []}
        devices={devices}
        sites={mapSites}
        onClose={() => setSiteFormOpen(false)}
        onSaved={() => {
          setSiteFormOpen(false);
          refreshSites();
          refresh();
        }}
      />

      <CoordsExportModal open={exportOpen} onClose={() => setExportOpen(false)} groups={exportGroups} types={markerTypes} />
    </div>
  );
}
