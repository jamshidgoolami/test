import { Plus } from 'lucide-react';

import { CONNECTION_TYPES } from '../../../lib/diagrams';
import type { DiagramConnectionKind, DiagramGraphItem } from '../../../lib/types';

export function OverviewLinkForm({
  items,
  sourceId,
  targetId,
  label,
  kind,
  busy,
  onSource,
  onTarget,
  onLabel,
  onKind,
  onCreate,
  onCancel,
}: {
  items: DiagramGraphItem[];
  sourceId: number | '';
  targetId: number | '';
  label: string;
  kind: DiagramConnectionKind;
  busy: boolean;
  onSource: (id: number) => void;
  onTarget: (id: number) => void;
  onLabel: (value: string) => void;
  onKind: (kind: DiagramConnectionKind) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-end gap-2 border-b border-ink-100 bg-brand-50/40 px-3 py-2"
      dir="rtl"
    >
      <label className="flex min-w-[140px] flex-1 flex-col gap-0.5 text-[10px] text-ink-500">
        دیاگرام مبدأ
        <select
          className="field !py-1 text-[11.5px]"
          value={sourceId}
          onChange={(event) => onSource(Number(event.target.value))}
        >
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-[140px] flex-1 flex-col gap-0.5 text-[10px] text-ink-500">
        دیاگرام مقصد
        <select
          className="field !py-1 text-[11.5px]"
          value={targetId}
          onChange={(event) => onTarget(Number(event.target.value))}
        >
          {items
            .filter((item) => item.id !== sourceId)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
      </label>
      <label className="flex min-w-[150px] flex-[1.4] flex-col gap-0.5 text-[10px] text-ink-500">
        برچسب (اختیاری)
        <input
          className="field !py-1 text-[11.5px]"
          value={label}
          placeholder="مثلاً اتصال به مرکز مخابرات"
          maxLength={120}
          onChange={(event) => onLabel(event.target.value)}
        />
      </label>
      <label className="flex min-w-[110px] flex-col gap-0.5 text-[10px] text-ink-500">
        نوع ارتباط
        <select
          className="field !py-1 text-[11.5px]"
          value={kind}
          onChange={(event) => onKind(event.target.value as DiagramConnectionKind)}
        >
          {CONNECTION_TYPES.map((type) => (
            <option key={type.kind} value={type.kind}>
              {type.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn-primary btn-xs" onClick={onCreate} disabled={busy || !targetId}>
        <Plus size={12} />
        {busy ? 'در حال ساخت…' : 'ساخت پیوند'}
      </button>
      <button type="button" className="btn-ghost btn-xs" onClick={onCancel}>
        انصراف
      </button>
    </div>
  );
}
