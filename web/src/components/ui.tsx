import React, { useEffect, useId, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Inbox, ChevronRight, ChevronLeft, AlertTriangle } from 'lucide-react';
import { STATUS_META, statusMeta } from '../lib/format';
import type { DeviceStatus } from '../lib/types';

/* ------------------------------- Cards ------------------------------- */
export function Card({
  children,
  className = '',
  padded = true,
  as: As = 'div',
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
  as?: React.ElementType;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={`card ${padded ? 'p-5' : ''} ${className}`} {...rest}>
      {children}
    </As>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
  className = '',
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 ${className}`}>
      <div className="flex items-start gap-3 min-w-0">
        {icon ? (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-soft bg-brand-50 text-accent border border-brand-100">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-ink-800 truncate">{title}</h3>
          {subtitle ? <p className="text-xs text-ink-500 mt-0.5">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ------------------------------ StatCard ----------------------------- */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
  onClick,
  delay = 0,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'brand' | 'emerald' | 'sun' | 'red' | 'violet' | 'ink';
  onClick?: () => void;
  delay?: number;
}) {
  const tones: Record<string, string> = {
    brand: 'bg-brand-50 text-accent border-brand-100',
    emerald: 'bg-emerald-50 text-success border-emerald-100',
    sun: 'bg-sun-50 text-warning border-sun-100',
    red: 'bg-red-50 text-danger border-red-100',
    violet: 'bg-violet-50 text-violet-600 border-violet-100',
    ink: 'bg-ink-100 text-ink-500 border-ink-200',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{ animationDelay: `${delay}ms` }}
      className={`card animate-fade-up p-4 text-right w-full h-full transition-all duration-300 ${
        onClick ? 'hover:-translate-y-0.5 hover:shadow-pop cursor-pointer' : 'cursor-default'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-500 truncate">{label}</p>
          <p className="mt-1.5 text-2xl font-bold text-ink-800 num">{value}</p>
          {hint ? (
            <p className="mt-1 text-[11px] text-ink-400 truncate" title={typeof hint === 'string' ? hint : undefined}>
              {hint}
            </p>
          ) : null}
        </div>
        {icon ? (
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-soft border ${tones[tone]}`}>{icon}</span>
        ) : null}
      </div>
    </button>
  );
}

/* ------------------------------ StatusPill ---------------------------- */
export function StatusPill({
  status,
  size = 'md',
  showLabel = true,
  pulse = true,
}: {
  status: DeviceStatus | string;
  size?: 'sm' | 'md';
  showLabel?: boolean;
  pulse?: boolean;
}) {
  const meta = statusMeta(status);
  return (
    <span className={`chip shrink-0 whitespace-nowrap ${meta.bg} ${meta.text} ${meta.border} ${size === 'sm' ? 'px-2 py-0.5 text-[10px]' : ''}`}>
      <span className="relative flex h-2 w-2">
        {pulse && status === 'offline' ? <span className={`absolute inline-flex h-full w-full rounded-full ${meta.dot} opacity-60 animate-pulse-ring`} /> : null}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${meta.dot}`} />
      </span>
      {showLabel ? meta.label : null}
    </span>
  );
}

export function Badge({
  children,
  className = '',
  tone = 'ink',
}: {
  children: React.ReactNode;
  className?: string;
  tone?: 'ink' | 'brand' | 'sun' | 'emerald' | 'red' | 'violet';
}) {
  const tones: Record<string, string> = {
    ink: 'bg-ink-100 text-ink-600 border-ink-200',
    brand: 'bg-brand-50 text-accent border-brand-200',
    sun: 'bg-sun-50 text-warning border-sun-200',
    emerald: 'bg-emerald-50 text-success border-emerald-200',
    red: 'bg-red-50 text-danger border-red-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
  };
  return <span className={`chip ${tones[tone]} ${className}`}>{children}</span>;
}

/* -------------------------------- Modal ------------------------------- */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  elevated = false,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /**
   * بالاتر از لایه‌های تمام‌صفحه باز شود. نقشهٔ تمام‌صفحه (z-1100) و فهرست آن
   * (z-1200) روی صفحه ثابت می‌شوند؛ پنجره‌هایی که از داخل همان حالت باز می‌شوند
   * باید بالاتر از آن‌ها باشند وگرنه پشت نقشه پنهان می‌مانند.
   */
  elevated?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () =>
      [...(panel?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? [])].filter((element) => element.offsetParent !== null);
    const focusTimer = window.setTimeout(() => focusables()[0]?.focus(), 20);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };
  // پنجره به body پورتال می‌شود: اگر یکی از اجداد `transform`/`filter` داشته
  // باشد (`animate-fade-up` در انتها transform صفر باقی می‌گذارد)، `position:
  // fixed` نسبت به همان جداد محاسبه می‌شود و پنجره داخل همان کارت/بخش صفحه
  // باز می‌شد، نه در مرکز صفحه. پورتال از این وابستگی جداست و تراز عمودی هم
  // وسط صفحه است.
  return createPortal(
    <div
      className={`fixed inset-0 flex items-center justify-center overflow-y-auto bg-scrim/30 p-4 sm:p-6 ${elevated ? 'z-[1300]' : 'z-[1000]'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`relative my-auto flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden ${widths[size]} animate-fade-up rounded-card bg-surface shadow-pop border border-ink-200`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-ink-100 p-5">
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-semibold text-ink-800 truncate">{title}</h3>
            {subtitle ? <p className="text-xs text-ink-500 mt-1">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="btn-ghost btn-xs shrink-0" aria-label="بستن">
            <X size={15} />
          </button>
        </div>
        {/* بدنه تنها بخش اسکرول‌شونده است تا هدر و دکمه‌های پایین همیشه دیده شوند */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-ink-100 bg-ink-50/60 p-4 rounded-b-card">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

/* -------------------------------- Fields ------------------------------ */
export function Field({
  label,
  hint,
  required,
  error,
  children,
  className = '',
}: {
  label?: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const generatedId = useId();
  const inputId = React.isValidElement(children) ? (children.props as { id?: string }).id ?? generatedId : generatedId;
  const hintId = `${generatedId}-hint`;
  const errorId = `${generatedId}-error`;
  const child = React.isValidElement(children)
    ? React.cloneElement(
        children as React.ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>,
        {
          id: inputId,
          'aria-describedby':
            [error ? errorId : hint ? hintId : null, (children.props as { 'aria-describedby'?: string })['aria-describedby']]
              .filter(Boolean)
              .join(' ') || undefined,
          ...(error ? { 'aria-invalid': true } : {}),
        }
      )
    : children;
  return (
    <div className={className}>
      {label ? (
        <label className="label" htmlFor={inputId}>
          {label} {required ? <span className="text-danger" aria-hidden>*</span> : null}
          {required ? <span className="sr-only"> (الزامی)</span> : null}
        </label>
      ) : null}
      {child}
      {error ? (
        <p id={errorId} className="mt-1 text-[12px] text-danger" role="alert">{error}</p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-[12px] text-ink-400">{hint}</p>
      ) : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-pill transition-colors duration-200 ${
          checked ? 'bg-brand-500' : 'bg-ink-200'
        }`}
        aria-pressed={checked}
        aria-label={label ?? 'تغییر وضعیت'}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all duration-200 ${
            checked ? 'right-0.5' : 'right-[22px]'
          }`}
        />
      </button>
      {label ? (
        <span className="min-w-0">
          <span className="block text-sm text-ink-700">{label}</span>
          {hint ? <span className="block text-[11px] text-ink-400 mt-0.5">{hint}</span> : null}
        </span>
      ) : null}
    </label>
  );
}

/* --------------------------------- Tabs ------------------------------- */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  size = 'md',
  className = '',
}: {
  tabs: { value: T; label: string; icon?: React.ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const move = (index: number) => {
    const next = tabs[index];
    if (!next) return;
    onChange(next.value);
    window.requestAnimationFrame(() => {
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
    });
  };
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="انتخاب بخش"
      className={`inline-flex max-w-full flex-wrap items-center gap-1 rounded-soft bg-ink-100/70 p-1 ${className}`}
    >
      {tabs.map((t, index) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          id={`tab-${t.value}`}
          aria-selected={value === t.value}
          tabIndex={value === t.value ? 0 : -1}
          onClick={() => onChange(t.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              if (event.key === 'Home') move(0);
              else if (event.key === 'End') move(tabs.length - 1);
              else move((index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length);
            }
          }}
          className={`inline-flex items-center gap-1.5 rounded-xl font-medium transition-all duration-200 ${
            size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-[13px]'
          } ${value === t.value ? 'bg-surface text-accent shadow-soft' : 'text-ink-500 hover:text-ink-700'}`}
        >
          {t.icon}
          {t.label}
          {t.count != null ? (
            <span className={`num rounded-pill px-1.5 py-0.5 text-[10px] ${value === t.value ? 'bg-brand-50 text-accent' : 'bg-ink-200/70 text-ink-500'}`}>
              {t.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Feedback ------------------------------ */
export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} size={18} />;
}

export function PageLoader({ label = 'در حال بارگذاری…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-ink-400">
      <Spinner className="text-brand-500" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function SkeletonCard({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`card p-5 ${className}`}>
      <div className="skeleton h-4 w-1/3 mb-4" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton h-3 w-full mb-2.5" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className = '',
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-ink-200 bg-surface/60 px-6 py-14 text-center ${className}`}>
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-500 border border-brand-100">
        {icon ?? <Inbox size={22} />}
      </span>
      <div>
        <p className="text-sm font-semibold text-ink-700">{title}</p>
        {description ? <p className="mt-1 text-xs text-ink-500 max-w-md">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-red-100 bg-red-50/60 px-6 py-12 text-center">
      <AlertTriangle className="text-danger" size={24} />
      <p className="text-sm text-danger">{message}</p>
      {onRetry ? (
        <button type="button" className="btn-ghost btn-xs" onClick={onRetry}>
          تلاش دوباره
        </button>
      ) : null}
    </div>
  );
}

/* ----------------------------- Pagination ----------------------------- */
export function Pagination({
  page,
  pages,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  const nums = useMemo(() => {
    const out: number[] = [];
    const start = Math.max(1, Math.min(page - 2, pages - 4));
    for (let i = start; i <= Math.min(pages, start + 4); i++) out.push(i);
    return out;
  }, [page, pages]);
  if (pages <= 1) {
    return (
      <div className="flex items-center justify-between px-1 py-3 text-xs text-ink-500">
        <span>{total.toLocaleString('fa-IR')} مورد</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-3">
      <span className="text-xs text-ink-500">
        {total.toLocaleString('fa-IR')} مورد — صفحه {page.toLocaleString('fa-IR')} از {pages.toLocaleString('fa-IR')}
      </span>
      <div className="flex items-center gap-1">
        <button type="button" className="btn-ghost btn-xs" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronRight size={14} />
          قبلی
        </button>
        {nums.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onPage(n)}
            className={`num h-8 w-8 rounded-xl text-xs font-medium transition ${
              n === page ? 'bg-brand-500 text-white shadow-glow' : 'bg-surface text-ink-600 border border-ink-200 hover:border-brand-200'
            }`}
          >
            {n.toLocaleString('fa-IR')}
          </button>
        ))}
        <button type="button" className="btn-ghost btn-xs" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          بعدی
          <ChevronLeft size={14} />
        </button>
      </div>
      <span className="hidden text-xs text-ink-400 sm:block">صفحه‌بندی</span>
    </div>
  );
}

/* ----------------------------- HealthRing ----------------------------- */
export function HealthRing({
  score,
  size = 132,
  label = 'شاخص سلامت شبکه',
  caption,
  color = '#2563eb',
  fluid = false,
}: {
  score: number;
  size?: number;
  label?: string;
  caption?: string;
  color?: string;
  /** اگر داخل ویجت با ارتفاع دلخواه باشد، قطر حلقه با ارتفاع همان ویجت هم‌مقیاس می‌شود */
  fluid?: boolean;
}) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * c;
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`relative ${fluid ? 'h-[clamp(112px,28cqh,208px)] w-[clamp(112px,28cqh,208px)]' : ''}`}
        style={fluid ? undefined : { width: size, height: size }}
      >
        <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%" className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef2f7" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
            style={{ transition: 'stroke-dasharray 900ms cubic-bezier(0.22,1,0.36,1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-2xl font-bold text-ink-800">{score.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}</span>
          <span className="text-[10px] text-ink-400">از ۱۰۰</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs font-medium text-ink-600">{label}</p>
        {caption ? <p className="text-[11px] text-ink-400 mt-0.5">{caption}</p> : null}
      </div>
    </div>
  );
}

/* ------------------------------ Progress ------------------------------ */
export function Progress({ value, color = '#2563eb', height = 6 }: { value: number; color?: string; height?: number }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="w-full rounded-pill bg-ink-100 overflow-hidden" style={{ height }}>
      <div className="h-full rounded-pill transition-all duration-700" style={{ width: `${v}%`, background: color }} />
    </div>
  );
}

export function StatusLegend({ className = '' }: { className?: string }) {
  const keys: DeviceStatus[] = ['online', 'warning', 'offline'];
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      {keys.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-ink-500">
          <span className={`h-2 w-2 rounded-full ${STATUS_META[k].dot}`} />
          {STATUS_META[k].label}
        </span>
      ))}
    </div>
  );
}

export function SectionTitle({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <h2 className="section-title">
      {icon}
      {children}
    </h2>
  );
}
