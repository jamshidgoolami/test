/**
 * نوار باریک «افزودن» — فقط انواع عمومی تجهیزات (سوئیچ، هاب، روتر، …).
 *
 * فهرست تجهیزات ثبت‌شدهٔ مانیتورینگ عمداً این‌جا نمایش داده نمی‌شود: بوم
 * دیاگرام برای کشیدن ساختار شبکه است، نه فهرست دارایی‌ها. هر چیپ را می‌توان
 * کشید و روی بوم رها کرد یا با کلیک مسلح شد.
 */
import React from 'react';
import { DEVICE_CATALOG, DEVICE_DRAG_MIME } from '../../lib/diagrams';
import type { DiagramDeviceDragPayload } from '../../lib/diagrams';
import { DeviceGlyph } from './DeviceGlyph';

export interface DiagramDeviceTrayProps {
  /** نوع تجهیزی که برای افزودن با کلیک مسلح شده است */
  activeDeviceKey?: string | null;
  onPickCatalog: (key: string) => void;
}

/** دادهٔ کشیدن را با نوع اختصاصی و متن سادهٔ پشتیبان می‌نویسد. */
function startDrag(event: React.DragEvent, payload: DiagramDeviceDragPayload) {
  const raw = JSON.stringify(payload);
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(DEVICE_DRAG_MIME, raw);
  // مرورگرهایی که نوع سفارشی را در drop برنمی‌گردانند، متن ساده را می‌خوانند.
  event.dataTransfer.setData('text/plain', raw);
}

export default function DiagramDeviceTray({ activeDeviceKey, onPickCatalog }: DiagramDeviceTrayProps) {
  return (
    <div
      className="flex items-stretch gap-1.5 overflow-x-auto pb-0.5"
      dir="rtl"
      role="group"
      aria-label="افزودن تجهیز عمومی به بوم"
    >
      <span className="flex shrink-0 items-center gap-1 text-[10px] leading-3 text-ink-400">
        نوع تجهیز را انتخاب کنید یا روی بوم بکشید
      </span>
      <span className="my-1 w-px shrink-0 bg-ink-200" aria-hidden />

      {DEVICE_CATALOG.map((type) => {
        const active = activeDeviceKey === type.key;
        return (
          <button
            key={type.key}
            type="button"
            draggable
            onDragStart={(event) => startDrag(event, { deviceKey: type.key, label: type.label })}
            onClick={() => onPickCatalog(type.key)}
            title={`${type.label} — برای افزودن بکشید و روی بوم رها کنید`}
            aria-label={`افزودن ${type.label} به بوم`}
            aria-pressed={active}
            className={`flex h-9 shrink-0 cursor-grab items-center gap-1.5 rounded-lg border px-2 transition active:cursor-grabbing ${
              active
                ? 'border-brand-300 bg-brand-50 text-accent'
                : 'border-ink-200 bg-surface text-ink-600 hover:border-brand-200 hover:bg-ink-50'
            }`}
          >
            <span
              className="grid h-5 w-5 shrink-0 place-items-center rounded-md"
              style={{ background: `${type.color}18`, color: type.color }}
            >
              <DeviceGlyph icon={type.icon} size={12} />
            </span>
            <span className="whitespace-nowrap text-[11px]">{type.label}</span>
          </button>
        );
      })}
    </div>
  );
}
