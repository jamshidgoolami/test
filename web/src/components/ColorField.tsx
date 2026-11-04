import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/**
 * انتخاب رنگ مشترک برنامه.
 *
 * کنار انتخابگر سیستمی (RGB) یک پالت ۲۴ رنگی با طیف‌های متفاوت هست تا انتخاب
 * رنگ سریع و یکدست باشد، بدون اینکه کاربر مجبور شود کد رنگ را حفظ کند.
 */
export const STANDARD_COLORS = [
  // قرمز ← نارنجی ← زرد
  '#7f1d1d', '#dc2626', '#ef4444', '#f97316', '#f59e0b', '#facc15',
  // سبز ← فیروزه‌ای
  '#14532d', '#16a34a', '#4ade80', '#0d9488', '#06b6d4', '#67e8f9',
  // آبی ← نیلی
  '#1e3a8a', '#2563eb', '#3b82f6', '#6366f1', '#8b5cf6', '#c4b5fd',
  // صورتی ← خاکستری ← تیره/روشن
  '#be185d', '#ec4899', '#f9a8d4', '#64748b', '#1e293b', '#f8fafc',
] as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** مقدار معتبر رنگ را برمی‌گرداند؛ ورودی ناقص (مثل «#25») تصحیح نمی‌شود. */
export function safeColor(value: string | null | undefined, fallback = '#2563eb'): string {
  return value && HEX_RE.test(value) ? value : fallback;
}

/** شبکهٔ ۲۴ رنگ استاندارد */
export function ColorSwatches({
  value,
  onChange,
  disabled,
  columns = 12,
  className = '',
}: {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  /** تعداد ستون‌ها؛ در پاپ‌اورهای باریک ۸ بهتر جا می‌شود. */
  columns?: 6 | 8 | 12;
  className?: string;
}) {
  const current = value?.toLowerCase();
  return (
    <div
      className={`grid gap-1.5 ${columns === 6 ? 'grid-cols-6' : columns === 8 ? 'grid-cols-8' : 'grid-cols-12'} ${className}`}
      role="group"
      aria-label="رنگ‌های استاندارد"
    >
      {STANDARD_COLORS.map((hex) => {
        const selected = current === hex;
        return (
          <button
            key={hex}
            type="button"
            disabled={disabled}
            title={hex}
            aria-label={`رنگ ${hex}`}
            aria-pressed={selected}
            onClick={() => onChange(hex)}
            className={`relative grid aspect-square w-full place-items-center rounded-md border transition hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50 ${
              selected ? 'border-ink-800 ring-2 ring-brand-300' : 'border-black/10'
            }`}
            style={{ background: hex }}
          >
            {selected ? <Check size={11} className={current === '#f8fafc' ? 'text-ink-900' : 'text-white'} /> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * فیلد کامل رنگ: انتخابگر سیستمی + کد رنگ قابل ویرایش + پالت استاندارد.
 * در فرم‌ها و پنل‌ها استفاده می‌شود.
 */
export function ColorField({
  value,
  onChange,
  disabled,
  className = '',
}: {
  value: string | null | undefined;
  onChange: (hex: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const color = safeColor(value);
  const [draft, setDraft] = useState(color);
  useEffect(() => {
    setDraft(safeColor(value));
  }, [value]);

  const commit = (raw: string) => {
    const v = raw.trim();
    if (!v.startsWith('#')) return;
    if (HEX_RE.test(v)) onChange(v.toLowerCase());
  };

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-ink-200 bg-white p-0.5"
          value={color}
          disabled={disabled}
          aria-label="انتخاب رنگ"
          onChange={(e) => onChange(e.target.value.toLowerCase())}
        />
        <input
          dir="ltr"
          className="field num !py-1.5 text-[12px]"
          value={draft}
          disabled={disabled}
          placeholder="#2563eb"
          aria-label="کد رنگ (HEX)"
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => setDraft(color)}
        />
      </div>
      <ColorSwatches value={color} onChange={onChange} disabled={disabled} className="mt-2" />
    </div>
  );
}

/**
 * نسخهٔ جمع‌وجور برای نوار ابزار: دکمهٔ رنگ + پاپ‌اور پالت.
 * کلیک بیرون یا Escape پاپ‌اور را می‌بندد.
 */
export function ColorPickerPopover({
  value,
  onChange,
  disabled,
  title = 'انتخاب رنگ',
  className = '',
  children,
}: {
  value: string | null | undefined;
  onChange: (hex: string) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const color = safeColor(value);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-xl border border-ink-200 bg-white/70 px-1.5 py-1 text-[11px] text-ink-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {children}
        <span className="h-4 w-4 rounded border border-black/10" style={{ background: color }} />
        <ChevronDown size={11} />
      </button>
      {open ? (
        <div className="absolute z-50 mt-1 w-[228px] rounded-card border border-ink-200 bg-white p-2.5 shadow-pop" role="dialog">
          <ColorSwatches value={color} onChange={onChange} columns={8} />
          <div className="mt-2 flex items-center gap-2 border-t border-ink-100 pt-2">
            <input
              type="color"
              className="h-7 w-9 shrink-0 cursor-pointer rounded border border-ink-200 bg-white p-0.5"
              value={color}
              aria-label="انتخاب رنگ سفارشی"
              onChange={(e) => onChange(e.target.value.toLowerCase())}
            />
            <span className="ltr num text-[11px] text-ink-500">{color}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
