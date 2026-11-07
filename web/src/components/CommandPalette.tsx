import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Command, Search, Server, Settings2, WifiOff } from 'lucide-react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { statusMeta } from '../lib/format';
import { matchesQuery, NAV_ACTIONS, NAV_ITEMS, type NavItem } from '../lib/navigation';
import type { Device } from '../lib/types';

interface Result {
  id: string;
  label: string;
  hint: string;
  to: string;
  kind: 'page' | 'action' | 'device';
  status?: string;
}

/**
 * جست‌وجوی سراسری با Ctrl/Cmd+K.
 * صفحه‌ها و میان‌برها محلی‌اند؛ تجهیزات فقط پس از تایپ عبارت از API خوانده
 * می‌شوند تا باز کردن پالت درخواست بی‌مورد ایجاد نکند.
 */
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [devices, setDevices] = useState<Device[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setDevices([]);
    setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      window.clearTimeout(timer);
      previousFocus.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setDevices([]);
      setLoadingDevices(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoadingDevices(true);
      void api
        .devices({ search: q, pageSize: 6, sort: 'name', order: 'asc' }, controller.signal)
        .then((res) => setDevices(res.items ?? []))
        .catch((error: unknown) => {
          if ((error as { name?: string }).name !== 'AbortError') setDevices([]);
        })
        .finally(() => setLoadingDevices(false));
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim();
    const pages: Result[] = NAV_ITEMS.filter((item) => matchesQuery(`${item.label} ${item.description} ${item.keywords?.join(' ') ?? ''}`, q))
      .map((item: NavItem) => ({
        id: `page-${item.to}`,
        label: item.label,
        hint: item.description,
        to: item.to,
        kind: 'page',
      }));
    const actions: Result[] = NAV_ACTIONS.filter((action) => matchesQuery(`${action.label} ${action.keywords.join(' ')}`, q)).map(
      (action) => ({
        id: `action-${action.to}-${action.label}`,
        label: action.label,
        hint: 'میان‌بر عملیاتی',
        to: action.to,
        kind: 'action',
      })
    );
    const foundDevices: Result[] = devices.map((device) => ({
      id: `device-${device.id}`,
      label: device.name,
      hint: `${device.ip}${device.groupName ? ` · ${device.groupName}` : ''}`,
      to: `/devices/${device.id}`,
      kind: 'device',
      status: device.status,
    }));
    return [...pages, ...actions, ...foundDevices].slice(0, 16);
  }, [query, devices]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  const go = (result: Result) => {
    navigate(result.to);
    onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => {
        if (!results.length) return 0;
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        return (current + delta + results.length) % results.length;
      });
      return;
    }
    if (event.key === 'Enter' && results[active]) {
      event.preventDefault();
      go(results[active]);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[1150] flex items-start justify-center bg-scrim/30 px-3 pt-[10vh] sm:pt-[14vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="جست‌وجوی سراسری"
        className="w-full max-w-2xl overflow-hidden rounded-card border border-ink-200 bg-surface shadow-pop"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3">
          <Search size={17} className="shrink-0 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="جست‌وجوی صفحه، تجهیز، IP یا عملیات…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink-800 outline-none placeholder:text-ink-400"
            aria-label="عبارت جست‌وجوی سراسری"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={results[active] ? `command-result-${results[active].id}` : undefined}
          />
          <kbd className="hidden rounded-md border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[10px] text-ink-400 sm:inline">Esc</kbd>
        </div>

        <div id="command-results" role="listbox" aria-label="نتایج جست‌وجو" className="max-h-[55vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-ink-400">
              {loadingDevices ? 'در حال جست‌وجوی تجهیزات…' : 'نتیجه‌ای پیدا نشد. نام صفحه، تجهیز یا IP را وارد کنید.'}
            </p>
          ) : (
            results.map((result, index) => (
              <button
                key={result.id}
                id={`command-result-${result.id}`}
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(result)}
                className={`flex w-full items-center gap-3 rounded-soft px-3 py-2.5 text-right transition ${
                  index === active ? 'bg-brand-50 text-accent' : 'text-ink-700 hover:bg-ink-50'
                }`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-ink-100 bg-surface text-ink-500">
                  {result.kind === 'device' ? (
                    result.status === 'offline' ? <WifiOff size={14} /> : <Server size={14} />
                  ) : result.kind === 'action' ? (
                    <Command size={14} />
                  ) : (
                    <Settings2 size={14} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{result.label}</span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-ink-400">{result.hint}</span>
                </span>
                {result.kind === 'device' && result.status ? (
                  <span className={`chip ${statusMeta(result.status).bg} ${statusMeta(result.status).text} ${statusMeta(result.status).border}`}>
                    {statusMeta(result.status).label}
                  </span>
                ) : (
                  <ArrowLeft size={13} className="shrink-0 text-ink-300" />
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink-100 bg-ink-50/60 px-4 py-2 text-[11px] text-ink-400">
          <span><kbd className="num">↑ ↓</kbd> جابه‌جایی</span>
          <span><kbd>Enter</kbd> باز کردن</span>
          <span className="ms-auto">صفحه‌ها، تجهیزات و عملیات</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
