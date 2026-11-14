import { Badge } from '../../components/ui';
import { faDigits, fmtNumber } from '../../lib/format';
import type { ServerHealth } from '../../lib/types';

export const HEALTH_META: Record<ServerHealth, { label: string; tone: 'emerald' | 'sun' | 'red' | 'ink'; color: string }> = {
  ok: { label: 'سالم', tone: 'emerald', color: '#16a34a' },
  warning: { label: 'هشدار', tone: 'sun', color: '#d97706' },
  critical: { label: 'بحرانی', tone: 'red', color: '#dc2626' },
  unknown: { label: 'نامشخص', tone: 'ink', color: '#64748b' },
};

export function HealthBadge({ health, className = '' }: { health?: ServerHealth | null; className?: string }) {
  const meta = HEALTH_META[health ?? 'unknown'] || HEALTH_META.unknown;
  return (
    <Badge tone={meta.tone} className={className}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} aria-hidden />
      {meta.label}
    </Badge>
  );
}

export function formatBytes(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let n = Math.max(0, value);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${fmtNumber(n, i === 0 ? 0 : digits)} ${units[i]}`;
}

export function formatBitrate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
  let n = Math.max(0, value);
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i += 1;
  }
  return `${fmtNumber(n, i === 0 ? 0 : n >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${fmtNumber(value, digits)}٪`;
}

export function formatTemp(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${fmtNumber(value, 1)}°C`;
}

export function formatUptime(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  if (days > 0) return `${faDigits(days)} روز و ${faDigits(hours)} ساعت`;
  return `${faDigits(hours)} ساعت`;
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  return fmtNumber(value, digits);
}

export function sourceLabel(source: string): string {
  if (source === 'agent') return 'Agent ویندوز';
  if (source === 'redfish') return 'BMC / Redfish';
  if (source === 'ipmi') return 'BMC / IPMI';
  if (source === 'demo') return 'نمایشی';
  return source;
}
