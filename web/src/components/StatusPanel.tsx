import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ChevronDown, ChevronUp, Database, HardDrive, RefreshCw, Server, ShieldCheck, Signal, Wifi, WifiOff } from 'lucide-react';
import { useApp, useLiveState } from '../lib/store';
import { faDigits, fmtRelative } from '../lib/format';

const MODE_LABEL: Record<string, string> = {
  auto: 'خودکار',
  icmp: 'ICMP',
  tcp: 'TCP',
  simulate: 'شبیه‌سازی',
};

const STATUS_PANEL_KEY = 'nw.systemStatus';

function readStatusPanelOpen(): boolean {
  try {
    return localStorage.getItem(STATUS_PANEL_KEY) !== 'collapsed';
  } catch {
    return true;
  }
}

function saveStatusPanelOpen(open: boolean) {
  try {
    localStorage.setItem(STATUS_PANEL_KEY, open ? 'expanded' : 'collapsed');
  } catch {
    /* ذخیره‌سازی مرورگر در دسترس نیست */
  }
}

type Tone = 'ok' | 'warn' | 'down' | 'wait';

const TONE: Record<Tone, { dot: string; text: string; ring: string }> = {
  ok: { dot: 'bg-emerald-500', text: 'text-emerald-700', ring: 'bg-emerald-400' },
  warn: { dot: 'bg-sun-500', text: 'text-sun-700', ring: 'bg-sun-400' },
  down: { dot: 'bg-red-500', text: 'text-red-600', ring: 'bg-red-400' },
  wait: { dot: 'bg-ink-300', text: 'text-ink-500', ring: 'bg-ink-300' },
};

function StatusRow({
  icon,
  label,
  tone,
  value,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  tone: Tone;
  value: string;
  title?: string;
}) {
  const t = TONE[tone];
  return (
    <div className="flex items-center justify-between gap-2 text-[10.5px]" title={title}>
      <span className="flex min-w-0 items-center gap-1.5 text-ink-500">
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          {tone !== 'wait' ? (
            <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${t.ring} ${tone === 'ok' ? 'animate-pulse-ring' : ''}`} />
          ) : null}
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${t.dot}`} />
        </span>
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <span className={`num shrink-0 font-medium ${t.text}`}>{value}</span>
    </div>
  );
}

/**
 * سه وضعیت مستقل و قابل‌اعتماد:
 *   ۱) سرور/API و پایگاه‌داده (از پاسخ واقعی /api/status)
 *   ۲) موتور پایش (اجرا/توقف/کهنگی چرخه/رهبری)
 *   ۳) تجهیزات (وصل/قطع) + وضعیت اتصال زندهٔ SSE
 * سلامت برنامه (پشتیبان، دیسک، آخرین Probe) هم جدا از سلامت شبکه نمایش داده
 * می‌شود. داده از AppProvider می‌آید تا با داشبورد درخواست تکراری نداشته باشیم.
 */
export default function StatusPanel({ collapsed = false }: { collapsed?: boolean }) {
  const live = useLiveState();
  const { status: data, statusError: error, refreshStatus } = useApp();
  const [open, setOpen] = useState(readStatusPanelOpen);

  useEffect(() => saveStatusPanelOpen(open), [open]);

  const serverTone: Tone = error ? 'down' : data?.server.ok ? 'ok' : 'wait';
  const serverText = error ? 'بی‌پاسخ' : data?.server.ok ? 'متصل' : 'در حال بررسی…';

  const engine = data?.engine;
  const engineTone: Tone = !engine
    ? 'wait'
    : !engine.running
      ? 'down'
      : engine.stale
        ? 'warn'
        : engine.leader === false
          ? 'warn'
          : 'ok';
  const engineText = !engine
    ? '—'
    : !engine.running
      ? 'متوقف'
      : engine.stale
        ? 'چرخهٔ کهنه'
        : engine.leader === false
          ? 'آماده (بدون رهبری)'
          : 'در حال اجرا';

  const devices = data?.devices;
  const devicesTone: Tone = !devices ? 'wait' : devices.down > 0 ? 'warn' : 'ok';
  const devicesText = !devices ? '—' : `${faDigits(devices.up)} وصل · ${faDigits(devices.down)} قطع`;

  const transportTone: Tone = live.connected ? 'ok' : live.connectionState === 'offline' ? 'down' : 'warn';
  const transportText = live.connected
    ? 'برقرار'
    : live.connectionState === 'reconnecting'
      ? `اتصال مجدد (${faDigits(live.reconnectAttempt)})`
      : live.connectionState === 'offline'
        ? 'قطع'
        : 'در حال اتصال…';

  const app = data?.app;
  const dbTone: Tone = !app ? 'wait' : app.db.ok ? 'ok' : 'down';
  const dbText = !app ? '—' : app.db.ok ? (app.db.sizeBytes ? `${fmtMb(app.db.sizeBytes)}` : 'سالم') : 'خطا';

  const backup = app?.backup;
  const backupTone: Tone = !backup
    ? 'wait'
    : backup.running || backup.restoring
      ? 'warn'
      : backup.lastBackupAt
        ? backup.ok
          ? 'ok'
          : 'warn'
        : backup.enabled
          ? 'warn'
          : 'wait';
  const backupText = !backup
    ? '—'
    : backup.restoring
      ? 'بازیابی در جریان'
      : backup.running
        ? 'در حال پشتیبان‌گیری'
        : backup.lastBackupAt
          ? fmtRelative(backup.lastBackupAt)
          : backup.enabled
            ? 'هنوز اجرا نشده'
            : 'غیرفعال';

  const diskTone: Tone = !app?.disk ? 'wait' : app.disk.ok ? 'ok' : 'down';
  const diskText = !app?.disk
    ? '—'
    : app.disk.freeBytes == null
      ? 'نامشخص'
      : fmtMb(app.disk.freeBytes);

  return (
    <div
      className={`mx-3 mb-3 rounded-card border border-ink-200/70 bg-ink-50/60 p-3 ${
        collapsed ? 'lg:mx-auto lg:mb-4 lg:flex lg:items-center lg:justify-center lg:p-2' : ''
      }`}
    >
      <div className={`flex items-center justify-between gap-2 text-[11px] font-medium text-ink-600 ${collapsed ? 'lg:hidden' : ''}`}>
        <span className="flex min-w-0 items-center gap-2">
          <Activity size={14} className="shrink-0 text-brand-500" />
          <span className="truncate">وضعیت سامانه</span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className="btn-ghost btn-xs !p-1"
            onClick={() => void refreshStatus()}
            aria-label="به‌روزرسانی وضعیت"
            title="به‌روزرسانی وضعیت"
          >
            <RefreshCw size={12} />
          </button>
          <button
            type="button"
            className="btn-ghost btn-xs !p-1"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="status-panel-body"
            aria-label={open ? 'پنهان کردن وضعیت سامانه' : 'نمایش وضعیت سامانه'}
            title={open ? 'پنهان کردن وضعیت سامانه' : 'نمایش وضعیت سامانه'}
          >
            {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </span>
      </div>
      {collapsed ? <Activity size={16} className="hidden text-brand-500 lg:block" /> : null}

      <div id="status-panel-body" hidden={!open}>
      <div className={`mt-2.5 space-y-1.5 ${collapsed ? 'lg:hidden' : ''}`}>
        <StatusRow icon={<Server size={11} />} label="API" tone={serverTone} value={serverText} title={error || undefined} />
        <StatusRow
          icon={live.connected ? <Wifi size={11} /> : <WifiOff size={11} />}
          label="اتصال زنده (SSE)"
          tone={transportTone}
          value={transportText}
        />
        <StatusRow icon={<Database size={11} />} label="پایگاه‌داده" tone={dbTone} value={dbText} title="شامل حجم فایل پایگاه‌داده" />
        <StatusRow
          icon={<Signal size={11} />}
          label="موتور"
          tone={engineTone}
          value={engineText}
          title={engine ? `حالت: ${MODE_LABEL[engine.mode] ?? engine.mode}` : undefined}
        />
        <StatusRow
          icon={<Activity size={11} />}
          label="تجهیزات"
          tone={devicesTone}
          value={devicesText}
          title={devices ? `${faDigits(devices.monitoring)} تحت پایش از ${faDigits(devices.total)}` : undefined}
        />
        <StatusRow
          icon={<ShieldCheck size={11} />}
          label="پشتیبان‌گیری"
          tone={backupTone}
          value={backupText}
          title={backup ? `آخرین نسخه: ${backup.lastBackupAt ? fmtRelative(backup.lastBackupAt) : '—'} · ${faDigits(backup.count)} نسخه` : undefined}
        />
        <StatusRow
          icon={<HardDrive size={11} />}
          label="فضای دیسک"
          tone={diskTone}
          value={diskText}
          title={app?.disk ? `حداقل مجاز: ${fmtMb(app.disk.minFreeBytes)}` : undefined}
        />
      </div>

      <div className={`mt-2.5 space-y-1 border-t border-ink-200/60 pt-2 text-[10px] text-ink-400 ${collapsed ? 'lg:hidden' : ''}`}>
        <p className="flex items-center justify-between">
          <span>حالت موتور</span>
          <span className="font-medium text-ink-600">{engine ? (MODE_LABEL[engine.mode] ?? engine.mode) : '—'}</span>
        </p>
        <p className="flex items-center justify-between">
          <span>آخرین Probe موفق</span>
          <span className="num font-medium text-ink-600">{fmtRelative(app?.probe.lastSuccessAt)}</span>
        </p>
        <p className="flex items-center justify-between">
          <span>آخرین به‌روزرسانی</span>
          <span className="num font-medium text-ink-600">{fmtRelative(data?.generatedAt)}</span>
        </p>
      </div>

      <Link to="/settings" className={`mt-2 block text-center text-[10.5px] text-brand-600 hover:text-brand-700 ${collapsed ? 'lg:hidden' : ''}`}>
        مدیریت تنظیمات موتور
      </Link>
      </div>
    </div>
  );
}

function fmtMb(bytes: number): string {
  const mb = Math.round(bytes / 1024 / 1024);
  return `${faDigits(mb.toLocaleString('en-US'))} MB`;
}
