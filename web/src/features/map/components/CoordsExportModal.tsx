import { useState } from 'react';
import { Check, Download, Layers } from 'lucide-react';
import { downloadUrl } from '../../../lib/api';
import { faDigits } from '../../../lib/format';
import { Modal } from '../../../components/ui';
import type { MarkerType } from '../../../lib/types';
import { MarkerGlyph } from '../lib/markers';

export function CoordsExportModal({
  open,
  onClose,
  groups,
  types,
}: {
  open: boolean;
  onClose: () => void;
  /** نام گروه‌های تجهیزات؛ «__none__» یعنی تجهیزات بدون گروه */
  groups: string[];
  types: MarkerType[];
}) {
  // گروه‌ها و انواعی که از خروجی کنار گذاشته می‌شوند؛ پیش‌فرض هیچ‌کدام حذف نمی‌شود.
  const [excludedGroups, setExcludedGroups] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<number[]>([]);
  if (!open) return null;

  const chosenGroups = groups.filter((g) => !excludedGroups.includes(g));
  const chosen = types.filter((t) => !excluded.includes(t.id));
  const withMarkers = chosen.length > 0;
  const url = downloadUrl('/devices/export/geo', {
    format: 'xlsx',
    // فهرست گروه‌های انتخاب‌شده همیشه فرستاده می‌شود؛ `__none_selected__`
    // یعنی هیچ گروهی انتخاب نشده و فایل فقط علامت‌ها را در بر می‌گیرد.
    groups: chosenGroups.length ? chosenGroups.join(',') : '__none_selected__',
    markers: withMarkers ? 1 : 0,
    types: withMarkers && chosen.length !== types.length ? chosen.map((t) => t.id).join(',') : undefined,
  });

  return (
    <Modal
      open
      elevated
      size="sm"
      onClose={onClose}
      title="خروجی مختصات"
      subtitle="گروه تجهیزات و انواع علامت‌های حاضر در فایل خروجی را مشخص کنید"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            انصراف
          </button>
          <a className="btn-primary" href={url} onClick={onClose} download>
            <Download size={15} />
            دریافت خروجی
          </a>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-ink-600">گروه تجهیزات</span>
            <div className="flex items-center gap-1">
              <button type="button" className="btn-ghost btn-xs !px-2" onClick={() => setExcludedGroups([])}>
                همه
              </button>
              <button type="button" className="btn-ghost btn-xs !px-2" onClick={() => setExcludedGroups(groups)}>
                هیچ‌کدام
              </button>
            </div>
          </div>
          <div className="max-h-[220px] space-y-1 overflow-y-auto rounded-soft border border-ink-200 bg-surface/70 p-1.5">
            {groups.length === 0 ? <p className="px-1 py-2 text-[11px] text-ink-400">گروهی تعریف نشده است</p> : null}
            {groups.map((g) => {
              const on = !excludedGroups.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px] transition hover:bg-ink-50"
                  onClick={() => setExcludedGroups((prev) => (on ? [...prev, g] : prev.filter((name) => name !== g)))}
                  aria-pressed={on}
                >
                  <span
                    className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${
                      on ? 'border-brand-500 bg-brand-500 text-white' : 'border-ink-300 bg-surface text-transparent'
                    }`}
                  >
                    <Check size={9} />
                  </span>
                  <span className="shrink-0 text-ink-400">
                    <Layers size={11} />
                  </span>
                  <span className="truncate" style={{ color: on ? undefined : '#94a3b8' }}>
                    {g === '__none__' ? 'بدون گروه' : g}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[10.5px] leading-4 text-ink-400">
            تنها تجهیزات دارای مختصات از گروه‌های انتخاب‌شده در فایل می‌آیند؛ با «هیچ‌کدام» فایل فقط علامت‌ها را شامل
            می‌شود.
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-ink-600">انواع علامت</span>
            <div className="flex items-center gap-1">
              <button type="button" className="btn-ghost btn-xs !px-2" onClick={() => setExcluded([])}>
                همه
              </button>
              <button
                type="button"
                className="btn-ghost btn-xs !px-2"
                onClick={() => setExcluded(types.map((t) => t.id))}
              >
                هیچ‌کدام
              </button>
            </div>
          </div>
          <div className="max-h-[220px] space-y-1 overflow-y-auto rounded-soft border border-ink-200 bg-surface/70 p-1.5">
            {types.length === 0 ? <p className="px-1 py-2 text-[11px] text-ink-400">نوعی تعریف نشده است</p> : null}
            {types.map((t) => {
              const on = !excluded.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px] transition hover:bg-ink-50"
                  onClick={() => setExcluded((prev) => (on ? [...prev, t.id] : prev.filter((id) => id !== t.id)))}
                  aria-pressed={on}
                >
                  <span
                    className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${
                      on ? 'border-brand-500 bg-brand-500 text-white' : 'border-ink-300 bg-surface text-transparent'
                    }`}
                  >
                    <Check size={9} />
                  </span>
                  <span className="shrink-0" style={{ color: on ? t.color : '#94a3b8' }}>
                    <MarkerGlyph name={t.icon} size={11} />
                  </span>
                  <span className="truncate" style={{ color: on ? undefined : '#94a3b8' }}>
                    {t.name}
                  </span>
                  <span className="num ms-auto text-[10px] text-ink-400">{faDigits(t.markerCount ?? 0)}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[10.5px] leading-4 text-ink-400">
            اگر هیچ نوع علامتی انتخاب نشود، فایل فقط تجهیزات دارای مختصات را شامل می‌شود.
          </p>
        </div>
      </div>
    </Modal>
  );
}
