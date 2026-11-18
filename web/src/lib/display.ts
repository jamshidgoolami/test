import { useSyncExternalStore } from 'react';

/**
 * ترجیحات نمایش که به ازای هر دستگاه/مرورگر ذخیره می‌شوند.
 *
 * چرا متغیرهای CSS کافی نیستند: برنامه روی نمایشگرهای خیلی مختلفی اجرا
 * می‌شود (لپ‌تاپ ۱۳۶۶ با مقیاس ۱۰۰٪ تا تلویزیون NOC). یک پلهٔ «بزرگ» متن‌های
 * ریزی را که در رابط زیادند خوانا می‌کند و «فشرده» برای نمایشگرهای کوچک فضای
 * بیشتری می‌دهد. «حالت نمایش» هم کروم برنامه را برای نمایش دائمی کنار می‌گذارد.
 */
export type Density = 'compact' | 'comfortable' | 'large';

export interface DisplayPrefs {
  density: Density;
  /** حالت نمایش/NOC: منو، هدر و فوتر مخفی می‌شوند و صفحه‌ها خودکار می‌چرخند. */
  present: boolean;
}

const STORAGE_KEY = 'nw.display';
const DENSITIES: Density[] = ['compact', 'comfortable', 'large'];
const DEFAULT: DisplayPrefs = { density: 'comfortable', present: false };

export const DENSITY_LABEL: Record<Density, string> = {
  compact: 'فشرده',
  comfortable: 'معمولی',
  large: 'بزرگ',
};

export const DENSITY_HINT: Record<Density, string> = {
  compact: 'برای نمایشگر کوچک یا پنجرهٔ باریک؛ ردیف‌های بیشتر در یک نما',
  comfortable: 'حالت پیش‌فرض دسکتاپ',
  large: 'برای نمایشگر بزرگ، تلویزیون و اتاق پایش',
};

function read(): DisplayPrefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null') as Partial<DisplayPrefs> | null;
    return {
      density: DENSITIES.includes(raw?.density as Density) ? (raw?.density as Density) : DEFAULT.density,
      present: Boolean(raw?.present),
    };
  } catch {
    return DEFAULT;
  }
}

function applyToDocument(prefs: DisplayPrefs) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.density = prefs.density;
  if (prefs.present) root.dataset.present = 'on';
  else delete root.dataset.present;
}

let state: DisplayPrefs = typeof window === 'undefined' ? DEFAULT : read();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** اعمال ترجیحات؛ در بارگذاری اول و پیش از نخستین رنگ‌آمیزی صدا زده می‌شود. */
export function initDisplay() {
  state = read();
  applyToDocument(state);
}

export function setDisplay(next: Partial<DisplayPrefs>) {
  state = { ...state, ...next };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ذخیره‌سازی مرورگر در دسترس نیست */
  }
  applyToDocument(state);
  emit();
}

export function useDisplay(): DisplayPrefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state
  );
}

initDisplay();
