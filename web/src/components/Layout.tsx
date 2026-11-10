import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  Bell,
  FileBarChart,
  LayoutDashboard,
  Map as MapIcon,
  Menu,
  Network,
  Search,
  Waypoints,
  Server,
  Settings as SettingsIcon,
  Wrench,
  X,
  Command,
  Radio,
  LayoutTemplate,
  PanelRightClose,
  PanelRightOpen,
  LogOut,
} from 'lucide-react';
import { useApp, useLiveState } from '../lib/store';
import { useAuth } from '../lib/auth';
import { faDigits, fmtRelative, fmtTimezone } from '../lib/format';
import { api } from '../lib/api';
import { NAV_GROUPS, navItemForPath } from '../lib/navigation';
import { APP_VERSION } from '../lib/version';
import StatusPanel from './StatusPanel';
import { LiveBadge } from './Freshness';
import CommandPalette from './CommandPalette';
import { ThemeIconButton } from './ThemeToggle';

const NAV_ICONS: Record<string, React.ComponentType<{ size?: number | string; className?: string }>> = {
  '/dashboard': LayoutDashboard,
  '/devices': Server,
  '/map': MapIcon,
  '/diagrams': Waypoints,
  '/alerts': Bell,
  '/maintenance': Wrench,
  '/reports': FileBarChart,
  '/templates': LayoutTemplate,
  '/app-health': Activity,
  '/settings': SettingsIcon,
};

/** وضعیت جمع/باز بودن منوی کناری در حافظهٔ مرورگر نگه داشته می‌شود */
function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem('nw.sidebar') === 'collapsed';
  } catch {
    return false;
  }
}

function saveSidebarCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem('nw.sidebar', collapsed ? 'collapsed' : 'expanded');
  } catch {
    /* ذخیره‌سازی مرورگر در دسترس نیست */
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const [notifOpen, setNotifOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { settings } = useApp();
  const live = useLiveState();
  const { user, logout } = useAuth();

  useEffect(() => {
    setOpen(false);
    setNotifOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    saveSidebarCollapsed(collapsed);
  }, [collapsed]);

  // Ctrl/Cmd+K و Escape سراسری برای پالت جست‌وجو.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // منوی اعلان‌ها با کلیک بیرون یا Escape هم بسته می‌شود، نه فقط با تغییر مسیر.
  useEffect(() => {
    if (!notifOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!notifRef.current?.contains(event.target as Node)) setNotifOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotifOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [notifOpen]);

  const alertsApi = useAlertSummary(live.version + (notifOpen ? 1 : 0));

  const title = useMemo(
    () =>
      location.pathname.startsWith('/docs')
        ? 'مستندات و راهنما'
        : navItemForPath(location.pathname)?.label ?? settings?.site_name ?? 'مرکز پایش شبکه',
    [location.pathname, settings?.site_name]
  );

  return (
    <div className="min-h-screen">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 right-0 z-[900] shrink-0 border-l border-ink-200/70 bg-surface transition-all duration-300 lg:translate-x-0 ${
          collapsed ? 'w-[264px] lg:w-[76px]' : 'w-[264px]'
        } ${open ? 'translate-x-0 shadow-pop' : 'translate-x-full'}`}
      >
        <div className="flex h-full flex-col">
          <div className={`flex items-center gap-3 px-5 py-5 ${collapsed ? 'lg:justify-center lg:px-2' : ''}`}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-600 text-white shadow-soft">
              <Activity size={22} />
            </span>
            <div className={`min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
              <p className="text-[15px] font-bold text-ink-800 leading-tight">NetWatch</p>
              <p className="text-[11px] text-ink-400 truncate">{settings?.site_name ?? 'پایش شبکه'}</p>
            </div>
            <button type="button" className="btn-ghost btn-xs ms-auto lg:hidden" onClick={() => setOpen(false)} aria-label="بستن منو">
              <X size={14} />
            </button>
          </div>

          <nav className={`flex-1 space-y-3 overflow-y-auto px-3 pb-3 ${collapsed ? 'lg:px-2' : ''}`} aria-label="ناوبری اصلی">
            {NAV_GROUPS.map((group) => (
              <div key={group.id} className="space-y-1">
                <p className={`px-3 text-[10.5px] font-semibold uppercase tracking-wide text-ink-400 ${collapsed ? 'lg:hidden' : ''}`}>
                  {group.label}
                </p>
                {group.items.map((item) => {
                  const Icon = NAV_ICONS[item.to] ?? Server;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      title={collapsed ? item.label : undefined}
                      aria-label={item.label}
                      className={({ isActive }) =>
                        `nav-item ${isActive ? 'nav-item-active' : ''} ${collapsed ? 'lg:relative lg:justify-center lg:gap-0 lg:px-0' : ''}`
                      }
                    >
                      <Icon size={18} className="shrink-0" />
                      <span className={`flex-1 ${collapsed ? 'lg:hidden' : ''}`}>{item.label}</span>
                      {item.to === '/alerts' && alertsApi.active > 0 ? (
                        <span
                          className={`num rounded-pill bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white ${
                            collapsed ? 'lg:absolute lg:-top-1 lg:-left-1 lg:min-w-4 lg:px-1 lg:text-center lg:text-[10px]' : ''
                          }`}
                        >
                          {faDigits(alertsApi.active)}
                        </span>
                      ) : null}
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </nav>

          <StatusPanel collapsed={collapsed} />
        </div>
      </aside>

      {open ? <div className="fixed inset-0 z-[890] bg-scrim/20 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} /> : null}

      {/* Main */}
      <div className={`transition-[margin] duration-300 ${collapsed ? 'lg:mr-[76px]' : 'lg:mr-[264px]'}`}>
        <header className="sticky top-0 z-[800] border-b border-ink-200/70 bg-surface">
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 sm:flex-nowrap sm:gap-2 sm:px-4 sm:py-1.5">
            <button type="button" className="btn-ghost btn-xs lg:hidden" onClick={() => setOpen(true)} aria-label="منو">
              <Menu size={16} />
            </button>
            <button
              type="button"
              className="btn-ghost btn-xs hidden lg:inline-flex"
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? 'نمایش منوی کامل' : 'جمع کردن منو (فقط آیکون‌ها)'}
              aria-label={collapsed ? 'نمایش منوی کامل' : 'جمع کردن منو'}
              aria-expanded={!collapsed}
            >
              {collapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
            </button>
            <div className="hidden min-w-0 leading-tight sm:block">
              <h1 className="truncate text-[13.5px] font-semibold text-ink-800">{title}</h1>
              <p className="truncate text-[10px] text-ink-400">
                {settings?.timezone_offset_minutes != null ? `به وقت ${fmtTimezone(settings.timezone_offset_minutes)} · ` : ''}
                {live.lastEventAt ? `${fmtRelative(live.lastEventAt)} به‌روزرسانی` : 'در انتظار اولین رویداد زنده'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="btn-ghost order-last w-full justify-start !rounded-pill !py-1.5 sm:order-none sm:ms-auto sm:w-full sm:max-w-[280px]"
              aria-label="جست‌وجوی سراسری، Ctrl+K"
              aria-keyshortcuts="Control+K Meta+K"
            >
              <Search size={14} className="shrink-0 text-ink-400" />
              <span className="truncate text-[12px] font-normal text-ink-400">جست‌وجوی صفحه، تجهیز یا IP…</span>
              <kbd className="ms-auto hidden shrink-0 items-center gap-1 rounded-md border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[10px] text-ink-400 sm:inline-flex">
                <Command size={10} /> K
              </kbd>
            </button>

            <div className="hidden md:block">
              <LiveBadge showAttempt />
            </div>
            <div className="md:hidden">
              <LiveBadge compact />
            </div>

            <ThemeIconButton />

            <div className="relative" ref={notifRef}>
              <button
                type="button"
                className="btn-ghost btn-xs relative"
                onClick={() => setNotifOpen((v) => !v)}
                aria-label="هشدارهای فعال"
                aria-expanded={notifOpen}
                aria-haspopup="dialog"
              >
                <Bell size={16} />
                {alertsApi.active > 0 ? (
                  <span className="num absolute -left-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {faDigits(alertsApi.active)}
                  </span>
                ) : null}
              </button>
              {notifOpen ? (
                <div
                  role="dialog"
                  aria-label="هشدارهای فعال"
                  className="absolute left-0 mt-2 w-[min(20rem,calc(100vw-2rem))] animate-fade-up rounded-card border border-ink-200 bg-surface p-3 shadow-pop"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold text-ink-700">هشدارهای فعال</p>
                    <Link to="/alerts" className="text-[11px] text-accent">
                      مشاهده همه
                    </Link>
                  </div>
                  <div className="max-h-72 space-y-2 overflow-y-auto">
                    {alertsApi.items.length === 0 ? (
                      <p className="py-6 text-center text-[11px] text-ink-400">هشدار فعالی وجود ندارد</p>
                    ) : (
                      alertsApi.items.slice(0, 6).map((a) => (
                        <Link
                          key={a.id}
                          to={a.deviceId ? `/devices/${a.deviceId}` : '/alerts'}
                          className="block rounded-soft border border-ink-100 bg-ink-50/50 p-2.5 transition hover:border-brand-200"
                        >
                          <p className="truncate text-[12px] font-medium text-ink-700">{a.title}</p>
                          <p className="mt-0.5 line-clamp-2 text-[10.5px] text-ink-500">{a.message}</p>
                          <p className="mt-1 text-[10px] text-ink-400">{fmtRelative(a.createdAt)}</p>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <Link to="/devices" className="btn-primary btn-xs hidden sm:inline-flex">
              <Network size={14} />
              تجهیزات
            </Link>

            {/* کاربر جاری و خروج — نقش viewer فقط خواندنی است */}
            {user ? (
              <div className="flex shrink-0 items-center gap-1.5 border-s border-ink-100 ps-2">
                <div className="hidden text-right leading-tight sm:block">
                  <p className="max-w-[110px] truncate text-[11.5px] font-medium text-ink-700">{user.displayName}</p>
                  <p className="text-[10px] text-ink-400">
                    {user.role === 'admin' ? 'مدیر' : user.role === 'operator' ? 'اپراتور' : 'بیننده'}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost btn-xs"
                  title={`خروج از حساب ${user.username}`}
                  aria-label="خروج"
                  onClick={() => void logout()}
                >
                  <LogOut size={15} />
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] px-3 py-3 sm:px-4 sm:py-4">{children}</main>

        <footer className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-3 pb-3 text-[10.5px] text-ink-400 sm:px-4">
          <span className="inline-flex items-center gap-1.5">
            <Radio size={12} />
            اجرای کاملاً آفلاین — بدون وابستگی به سرویس‌های ابری
          </span>
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="num">{fmtTimezone(settings?.timezone_offset_minutes ?? 210)}</span>
            <span aria-hidden>·</span>
            <span>{settings?.calendar === 'jalali' ? 'تقویم شمسی' : 'تقویم میلادی'}</span>
            <span aria-hidden>·</span>
            <span className="num" dir="ltr">v{APP_VERSION}</span>
          </span>
        </footer>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export const MODE_LABEL: Record<string, string> = {
  auto: 'خودکار',
  icmp: 'ICMP',
  tcp: 'TCP',
  simulate: 'شبیه‌سازی',
};

interface AlertSummary {
  active: number;
  items: { id: number; title: string; message: string; createdAt: number; deviceId: number | null; severity: string }[];
}

function useAlertSummary(refreshKey: number): AlertSummary {
  const [data, setData] = useState<AlertSummary>({ active: 0, items: [] });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.alerts({ status: 'active', pageSize: 8 });
        if (alive)
          setData({
            active: res.stats.active,
            items: res.items.map((a) => ({ id: a.id, title: a.title, message: a.message, createdAt: a.createdAt, deviceId: a.deviceId, severity: a.severity })),
          });
      } catch {
        /* بی‌اثر */
      }
    };
    load();
    const id = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [refreshKey]);
  return data;
}
