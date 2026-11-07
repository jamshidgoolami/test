import React from 'react';
import { Moon, Monitor, Sun } from 'lucide-react';
import { useTheme, type ThemeMode } from '../lib/theme';

/** دکمهٔ فشردهٔ تعویض تم برای نوار بالای برنامه. */
export function ThemeIconButton({ className = 'btn-ghost btn-xs' }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  const dark = resolved === 'dark';
  const Icon = dark ? Moon : Sun;
  return (
    <button
      type="button"
      className={className}
      onClick={toggle}
      title={dark ? 'تغییر به تم روشن' : 'تغییر به تم تاریک'}
      aria-label={dark ? 'تغییر به تم روشن' : 'تغییر به تم تاریک'}
      aria-pressed={dark}
    >
      <Icon size={16} />
    </button>
  );
}

const OPTIONS: { key: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { key: 'light', label: 'روشن', icon: <Sun size={14} /> },
  { key: 'dark', label: 'تاریک', icon: <Moon size={14} /> },
  { key: 'system', label: 'هم‌سیستم', icon: <Monitor size={14} /> },
];

/** انتخاب سه‌حالتهٔ تم برای صفحهٔ تنظیمات و صفحهٔ ورود. */
export function ThemeSegmented({ label = 'تم برنامه' }: { label?: string }) {
  const { mode, setMode } = useTheme();
  return (
    <div className="inline-flex w-full gap-1 rounded-soft border border-ink-200 bg-ink-50 p-1 sm:w-auto" role="radiogroup" aria-label={label}>
      {OPTIONS.map((option) => {
        const active = mode === option.key;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setMode(option.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium transition sm:flex-none ${
              active ? 'bg-surface text-accent shadow-soft' : 'text-ink-500 hover:bg-surface/70 hover:text-ink-700'
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
