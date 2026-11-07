/**
 * نوار باریک تجهیزات — فقط با کلیک «افزودن تجهیز» در نوار ابزار باز می‌شود.
 *
 * فهرست افقی تجهیزات ثبت‌شدهٔ مانیتورینگ را نشان می‌دهد و هر ردیف را می‌توان با
 * کشیدن و رها کردن روی بوم اضافه کرد. کلیک هم مثل قبل ابزار افزودن را مسلح
 * می‌کند تا افزودن با کلیک روی بوم هم امکان‌پذیر بماند. انواع آمادهٔ تجهیز هم
 * در همان ردیف هستند تا افزودن تجهیز بدون رکورد مانیتورینگ حذف نشود.
 */
import React from 'react';
import { RefreshCw } from 'lucide-react';
import { DEVICE_CATALOG, DEVICE_DRAG_MIME, deviceCatalogKey } from '../../lib/diagrams';
import type { DiagramDeviceDragPayload } from '../../lib/diagrams';
import { faDigits, statusMeta } from '../../lib/format';
import type { Device } from '../../lib/types';
import { DeviceGlyph } from './DeviceGlyph';

export interface DiagramDeviceTrayProps {
  /** تجهیزات ثبت‌شدهٔ مانیتورینگ */
  devices: Device[];
  loading?: boolean;
  /** نوع تجهیزی که برای افزودن با کلیک مسلح شده است */
  activeDeviceKey?: string | null;
  activeDeviceId?: number | null;
  onPickCatalog: (key: string) => void;
  onPickDevice: (device: Device) => void;
  onReload?: () => void;
}

/** دادهٔ کشیدن را با نوع اختصاصی و متن سادهٔ پشتیبان می‌نویسد. */
function startDrag(event: React.DragEvent, payload: DiagramDeviceDragPayload) {
  const raw = JSON.stringify(payload);
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(DEVICE_DRAG_MIME, raw);
  // مرورگرهایی که نوع سفارشی را در drop برنمی‌گردانند، متن ساده را می‌خوانند.
  event.dataTransfer.setData('text/plain', raw);
}

function chipClass(active: boolean): string {
  return `flex h-9 shrink-0 cursor-grab items-center gap-1.5 rounded-lg border px-1.5 transition active:cursor-grabbing ${
    active
      ? 'border-brand-300 bg-brand-50 text-accent'
      : 'border-ink-200 bg-surface text-ink-600 hover:border-brand-200 hover:bg-ink-50'
  }`;
}

export default function DiagramDeviceTray({
  devices,
  loading,
  activeDeviceKey,
  activeDeviceId,
  onPickCatalog,
  onPickDevice,
  onReload,
}: DiagramDeviceTrayProps) {
  return (
    <div
      className="flex items-stretch gap-1.5 overflow-x-auto pb-0.5"
      dir="rtl"
      role="group"
      aria-label="افزودن تجهیز به بوم"
    >
      <span className="flex shrink-0 items-center gap-1 text-[10px] leading-3 text-ink-400">
        بکشید و روی بوم رها کنید
      </span>
      <span className="my-1 w-px shrink-0 bg-ink-200" aria-hidden />

      {loading && devices.length === 0 ? (
        <span className="num flex shrink-0 items-center px-1 text-[10.5px] text-ink-400">در حال بارگذاری تجهیزات…</span>
      ) : null}

      {devices.map((device) => (
        <button
          key={`device-${device.id}`}
          type="button"
          draggable
          onDragStart={(event) =>
            startDrag(event, {
              deviceKey: deviceCatalogKey(device.deviceType),
              deviceId: device.id,
              label: device.name,
              model: device.model,
            })
          }
          onClick={() => onPickDevice(device)}
          title={`${device.name} — برای افزودن بکشید و روی بوم رها کنید`}
          aria-label={`افزودن ${device.name} به بوم`}
          className={chipClass(activeDeviceId === device.id)}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusMeta(device.status).dot}`} aria-hidden />
          <span className="min-w-0 text-right">
            <span className="block max-w-[104px] truncate text-[11px] font-medium leading-4">{device.name}</span>
            <span className="ltr num block max-w-[104px] truncate text-left text-[9.5px] leading-3 text-ink-400">
              {device.ip}
            </span>
          </span>
        </button>
      ))}

      {devices.length ? <span className="my-1 w-px shrink-0 bg-ink-200" aria-hidden /> : null}

      {DEVICE_CATALOG.map((type) => (
        <button
          key={`catalog-${type.key}`}
          type="button"
          draggable
          onDragStart={(event) => startDrag(event, { deviceKey: type.key, label: type.label })}
          onClick={() => onPickCatalog(type.key)}
          title={`${type.label} — برای افزودن بکشید و روی بوم رها کنید`}
          aria-label={`افزودن ${type.label} به بوم`}
          className={chipClass(activeDeviceId == null && activeDeviceKey === type.key)}
        >
          <span
            className="grid h-5 w-5 shrink-0 place-items-center rounded-md"
            style={{ background: `${type.color}18`, color: type.color }}
          >
            <DeviceGlyph icon={type.icon} size={12} />
          </span>
          <span className="whitespace-nowrap text-[11px]">{type.label}</span>
        </button>
      ))}

      <span className="flex shrink-0 items-center gap-1 ps-1 text-[10px] text-ink-400">
        <span className="num">{faDigits(devices.length)} تجهیز ثبت‌شده</span>
        {onReload ? (
          <button
            type="button"
            onClick={onReload}
            title="بازخوانی فهرست تجهیزات"
            aria-label="بازخوانی فهرست تجهیزات"
            className="grid h-6 w-6 place-items-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        ) : null}
      </span>
    </div>
  );
}
