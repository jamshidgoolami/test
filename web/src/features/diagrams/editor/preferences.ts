import { useEffect, useState } from 'react';

export function readPanelOpen(): boolean {
  try {
    return localStorage.getItem('nw.diagrams.panel') !== 'closed';
  } catch {
    return true;
  }
}

export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value === 'on';
  } catch {
    return fallback;
  }
}

export function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? 'on' : 'off');
  } catch {
    /* بی‌اثر */
  }
}

/** فوکوس داخل فیلدهای متنی نباید میان‌برهای بوم را بگیرد */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** ترجیح‌های محلی بوم (پنل، شبکه، کادر عنوان و ذخیرهٔ خودکار) */
export function useDiagramPreferences() {
  const [panelOpen, setPanelOpen] = useState(readPanelOpen);
  const [snapToGrid, setSnapToGrid] = useState(() => readFlag('nw.diagrams.snap', false));
  const [titleBlock, setTitleBlock] = useState(() => readFlag('nw.diagrams.titleblock', true));
  const [autoSave, setAutoSave] = useState(() => readFlag('nw.diagrams.autosave', true));

  useEffect(() => {
    try {
      localStorage.setItem('nw.diagrams.panel', panelOpen ? 'open' : 'closed');
    } catch {
      /* بی‌اثر */
    }
  }, [panelOpen]);

  useEffect(() => writeFlag('nw.diagrams.snap', snapToGrid), [snapToGrid]);
  useEffect(() => writeFlag('nw.diagrams.titleblock', titleBlock), [titleBlock]);
  useEffect(() => writeFlag('nw.diagrams.autosave', autoSave), [autoSave]);

  return {
    panelOpen,
    setPanelOpen,
    snapToGrid,
    setSnapToGrid,
    titleBlock,
    setTitleBlock,
    autoSave,
    setAutoSave,
  };
}
