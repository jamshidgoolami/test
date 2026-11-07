import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * مدیریت تم روشن/تاریک.
 *
 * انتخاب کاربر در `localStorage` نگه داشته می‌شود و روی `<html>` کلاس `dark`
 * می‌گذارد؛ همهٔ رنگ‌ها از متغیرهای CSS در `index.css` می‌آیند، پس نیازی به
 * تغییر کلاس‌های صفحه‌ها نیست. حالت «هم‌سیستم» ترجیح سیستم‌عامل را دنبال
 * می‌کند و با تغییر آن زنده هم‌گام می‌شود.
 */
export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'nw.theme';
const META_COLOR = { light: '#f6f8fb', dark: '#090d14' } as const;

export function readThemeMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    /* ذخیره‌سازی مرورگر در دسترس نیست */
  }
  return 'system';
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

/** اعمال تم روی ریشهٔ سند؛ نوار آدرس مرورگر در موبایل هم هم‌رنگ می‌شود. */
function applyTheme(dark: boolean) {
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? META_COLOR.dark : META_COLOR.light);
}

type ThemeContextValue = {
  mode: ThemeMode;
  /** تم واقعاً فعال (هم‌سیستم حل‌شده) */
  resolved: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readThemeMode);
  const [systemDark, setSystemDark] = useState(prefersDark);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // انتخاب تم در تب/پنجرهٔ دیگر هم اعمال شود.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const value = event.newValue;
      setModeState(value === 'light' || value === 'dark' ? value : 'system');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const resolved: 'light' | 'dark' = mode === 'dark' || (mode === 'system' && systemDark) ? 'dark' : 'light';
  const dark = resolved === 'dark';

  useEffect(() => {
    applyTheme(dark);
  }, [dark]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ذخیره‌سازی مرورگر در دسترس نیست */
    }
  }, []);

  const toggle = useCallback(() => {
    setMode(dark ? 'light' : 'dark');
  }, [dark, setMode]);

  const value = useMemo<ThemeContextValue>(() => ({ mode, resolved, setMode, toggle }), [mode, resolved, setMode, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme باید داخل ThemeProvider استفاده شود');
  return context;
}
