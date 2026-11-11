export type MapDevice = {
  id: number;
  name: string;
  ip: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  deviceType: string;
  groupName: string | null;
  siteId: number | null;
  siteName: string | null;
  lastRtt: number | null;
  priority: string;
  location: string;
  mapLayerId: number | null;
};

/** ایستگاه: چند تجهیز هم‌مکان؛ موقعیتش میانگین موقعیت تجهیزات عضو است. */
export type MapSite = {
  id: number;
  name: string;
  groupName: string | null;
  devices: MapDevice[];
  latitude: number | null;
  longitude: number | null;
};

/** نمای قابل‌کنترل پاپ‌آپ ایستگاه: فهرست تجهیزات یا جزئیات یک تجهیز. */
export type SitePopupView = {
  element: HTMLElement;
  showDevice: (deviceId: number) => void;
  showList: () => void;
};
