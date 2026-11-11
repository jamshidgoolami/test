/**
 * تعریف ستون‌های جدول تجهیزات و بازکردن آدرس وب دستگاه.
 * این ماژول فقط داده و رفتار خالص دارد تا جدول و صفحه هر دو بدون وابستگی
 * چرخه‌ای از آن استفاده کنند.
 */
import type { Device } from '../../../lib/types';

export type ViewMode = 'cards' | 'table';

export type DeviceTableColumn = {
  key: string;
  label: string;
  sortable?: boolean;
  className?: string;
};

export const DEVICE_TABLE_COLUMNS: DeviceTableColumn[] = [
  { key: 'name', label: 'نام تجهیز', sortable: true },
  { key: 'ip', label: 'آدرس IP', sortable: true, className: 'num' },
  { key: 'type', label: 'نوع' },
  { key: 'group', label: 'گروه', sortable: true },
  { key: 'installed', label: 'تاریخ نصب', sortable: true, className: 'num text-[11px] text-ink-500' },
  { key: 'status', label: 'وضعیت', sortable: true },
  { key: 'latency', label: 'تأخیر', sortable: true, className: 'num' },
  { key: 'loss', label: 'افت بسته', sortable: true, className: 'num' },
  { key: 'uptime', label: 'دسترس‌پذیری', sortable: true, className: 'num' },
  { key: 'last_check', label: 'آخرین بررسی', sortable: true, className: 'text-[11px] text-ink-500' },
  { key: 'outages', label: 'قطعی', sortable: true, className: 'num' },
  { key: 'actions', label: 'عملیات', className: 'text-center' },
];

export const TABLE_COLUMN_KEYS = DEVICE_TABLE_COLUMNS.map((column) => column.key);

/**
 * آدرس وب تجهیز را از IP می‌سازد؛ IPv6 در براکت قرار می‌گیرد. فقط http/https
 * پذیرفته می‌شود و پنجرهٔ تازه بدون دسترسی به opener باز می‌شود.
 */
export function openDeviceAddress(device: Device) {
  const host = String(device.ip || '').trim();
  if (!host) return;
  const bracketed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  try {
    const url = new URL(`http://${bracketed}`);
    if (url.protocol !== 'http:' || !url.hostname) return;
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  } catch {
    /* آدرس نامعتبر نباید پنجرهٔ خالی باز کند */
  }
}
