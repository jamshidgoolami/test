import { useRef, useState } from 'react';
import { Check, ChevronDown, Crosshair, FileSpreadsheet, Layers, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { api, downloadUrl } from '../../../lib/api';
import { faDigits } from '../../../lib/format';
import { useToast } from '../../../lib/store';
import { Toggle } from '../../../components/ui';
import type { MapMarker, MarkerType } from '../../../lib/types';
import { MarkerGlyph } from '../lib/markers';
import { MarkerTypeForm } from './MarkerForms';

export function MarkersList({
  types,
  markers,
  hiddenTypeIds,
  onSetHiddenTypes,
  showLabels,
  onToggleLabels,
  armedTypeId,
  onArm,
  onFlyTo,
  onEdit,
  onChanged,
}: {
  types: MarkerType[];
  markers: MapMarker[];
  hiddenTypeIds: number[];
  onSetHiddenTypes: (hidden: number[]) => void;
  showLabels: boolean;
  onToggleLabels: (v: boolean) => void;
  armedTypeId: number | null;
  onArm: (t: MarkerType) => void;
  onFlyTo: (m: MapMarker) => void;
  onEdit: (m: MapMarker) => void;
  onChanged: () => void;
}) {
  const { push } = useToast();
  const [tab, setTab] = useState<'place' | 'types'>('place');
  const [typeForm, setTypeForm] = useState<Partial<MarkerType> | null>(null);
  const [typesOpen, setTypesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const visibleTypes = types.filter((t) => !hiddenTypeIds.includes(t.id));
  // نوعی که جانمایی روی نقشه و ورود فایل به آن نسبت داده می‌شود: تنها نوع قابل‌مشاهده.
  const placementType = visibleTypes[0] ?? null;
  // فهرست و نقشه هر دو فقط انواع انتخاب‌شده در منوی «انواع علامت» را نشان می‌دهند.
  const filtered = markers.filter((m) => m.typeId == null || !hiddenTypeIds.includes(m.typeId));

  const importFile = async (file: File) => {
    setBusy(true);
    try {
      // KML/KMZ (ترسیم‌های Google Earth) هم مسیر ورود خودش را دارد؛ صفحه‌گسترده
      // از همان مسیر Excel/CSV می‌رود.
      if (/\.(kml|kmz)$/i.test(file.name)) {
        const chosen = placementType;
        const res = await api.markerImportKml(file, { typeId: chosen?.id ?? null, type: chosen?.name });
        const skipped = res.skipped ? ` — ${faDigits(res.skipped)} مورد بدون نقطه یافت شد` : '';
        push(`${faDigits(res.inserted)} علامت از KML/KMZ وارد شد${skipped}`, res.inserted ? 'success' : 'warning');
        onChanged();
        return;
      }
      const res = await api.markerImport(file, 'append');
      push(
        `${faDigits(res.inserted)} علامت وارد شد${res.skipped ? ` — ${faDigits(res.skipped)} ردیف نامعتبر` : ''}`,
        res.inserted ? 'success' : 'warning'
      );
      onChanged();
    } catch (e) {
      push((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2">
        <div
          className="inline-flex items-center gap-0.5 rounded-soft border border-ink-200 bg-surface/70 p-0.5 text-[11px]"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'place'}
            className={`rounded-lg px-2 py-1 font-medium transition ${tab === 'place' ? 'bg-brand-50 text-accent' : 'text-ink-500 hover:text-ink-700'}`}
            onClick={() => setTab('place')}
          >
            جانمایی ({faDigits(markers.length)})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'types'}
            className={`rounded-lg px-2 py-1 font-medium transition ${tab === 'types' ? 'bg-brand-50 text-accent' : 'text-ink-500 hover:text-ink-700'}`}
            onClick={() => setTab('types')}
          >
            انواع ({faDigits(types.length)})
          </button>
        </div>
        <Toggle checked={showLabels} onChange={onToggleLabels} label="برچسب" />
      </div>

      {tab === 'place' ? (
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          {/* یک منو برای انتخاب انواعی که هم روی نقشه و هم در این فهرست دیده می‌شوند */}
          <div className="relative">
            <button
              type="button"
              className="field flex w-full items-center justify-between !rounded-pill !py-1.5 text-[12px]"
              onClick={() => setTypesOpen((value) => !value)}
              aria-expanded={typesOpen}
              aria-label="انتخاب انواع علامت نمایش‌داده‌شده"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Layers size={12} className="shrink-0 text-accent" />
                <span className="truncate">
                  {hiddenTypeIds.length
                    ? `${faDigits(visibleTypes.length)} از ${faDigits(types.length)} نوع علامت`
                    : 'همه انواع علامت'}
                </span>
              </span>
              <ChevronDown size={13} className={`shrink-0 text-ink-400 transition ${typesOpen ? 'rotate-180' : ''}`} />
            </button>
            {typesOpen ? (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-20 cursor-default"
                  aria-label="بستن منوی انواع علامت"
                  onClick={() => setTypesOpen(false)}
                />
                <div
                  className="absolute inset-x-0 z-30 mt-1 max-h-[240px] overflow-y-auto rounded-xl border border-ink-200 bg-surface p-1.5 shadow-pop"
                  role="group"
                  aria-label="انواع علامت"
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px] font-medium text-ink-700 transition hover:bg-ink-50"
                    onClick={() => onSetHiddenTypes([])}
                    aria-pressed={!hiddenTypeIds.length}
                  >
                    <span
                      className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${
                        hiddenTypeIds.length
                          ? 'border-ink-300 bg-surface text-transparent'
                          : 'border-brand-500 bg-brand-500 text-white'
                      }`}
                    >
                      <Check size={9} />
                    </span>
                    همه انواع
                    <span className="num ms-auto text-[10px] text-ink-400">{faDigits(markers.length)}</span>
                  </button>
                  <div className="my-1 h-px bg-ink-100" />
                  {types.map((t) => {
                    const hidden = hiddenTypeIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px] transition hover:bg-ink-50"
                        onClick={() =>
                          onSetHiddenTypes(
                            hidden ? hiddenTypeIds.filter((id) => id !== t.id) : [...hiddenTypeIds, t.id]
                          )
                        }
                        aria-pressed={!hidden}
                      >
                        <span
                          className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${
                            hidden
                              ? 'border-ink-300 bg-surface text-transparent'
                              : 'border-brand-500 bg-brand-500 text-white'
                          }`}
                        >
                          <Check size={9} />
                        </span>
                        <span className="shrink-0" style={{ color: hidden ? '#94a3b8' : t.color }}>
                          <MarkerGlyph name={t.icon} size={11} />
                        </span>
                        <span className="truncate" style={{ color: hidden ? '#94a3b8' : undefined }}>
                          {t.name}
                        </span>
                        <span className="num ms-auto text-[10px] text-ink-400">{faDigits(t.markerCount ?? 0)}</span>
                      </button>
                    );
                  })}
                  {types.length === 0 ? (
                    <p className="px-2 py-2 text-[10.5px] text-ink-400">نوعی تعریف نشده است</p>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>

          <div className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pe-1">
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-[11px] text-ink-400">علامتی جانمایی نشده است</p>
            ) : (
              filtered.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-2 rounded-soft border border-ink-100 bg-surface/70 px-2.5 py-2"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-right"
                    onClick={() => onFlyTo(m)}
                  >
                    <span
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full"
                      style={{ background: `${m.typeColor || '#0ea5e9'}1f`, color: m.typeColor || '#0ea5e9' }}
                    >
                      <MarkerGlyph name={m.typeIcon} size={13} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium text-ink-700">{m.name}</span>
                      <span className="num block text-[10px] text-ink-400">{m.typeName}</span>
                    </span>
                  </button>
                  <button type="button" className="btn-ghost btn-xs" title="ویرایش" onClick={() => onEdit(m)}>
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="btn-danger btn-xs"
                    title="حذف"
                    onClick={async () => {
                      if (!window.confirm(`علامت «${m.name}» حذف شود؟`)) return;
                      try {
                        await api.deleteMarker(m.id);
                        push('علامت حذف شد', 'success');
                        onChanged();
                      } catch (e) {
                        push((e as Error).message, 'error');
                      }
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="mt-2 space-y-2 border-t border-ink-100 pt-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                className="btn-primary btn-xs min-w-0 flex-1 justify-center"
                disabled={!types.length}
                onClick={() => {
                  if (placementType) onArm(placementType);
                }}
              >
                <Crosshair size={13} />
                جانمایی علامت روی نقشه
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv,.kml,.kmz"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importFile(f);
                  e.currentTarget.value = '';
                }}
              />
              <button
                type="button"
                className="btn-ghost btn-xs !px-2"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                title="ورود از فایل"
                aria-label="ورود از فایل"
              >
                <Upload size={13} />
              </button>
              <a
                className="btn-ghost btn-xs !px-2"
                href={downloadUrl('/markers/template', { format: 'xlsx' })}
                title="فایل نمونه"
                aria-label="فایل نمونه"
              >
                <FileSpreadsheet size={13} />
              </a>
            </div>
            {armedTypeId ? <p className="text-center text-[10.5px] text-accent">در انتظار کلیک روی نقشه…</p> : null}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pe-1">
            {types.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-soft border border-ink-100 bg-surface/70 px-2.5 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full"
                    style={{ background: `${t.color}1f`, color: t.color }}
                  >
                    <MarkerGlyph name={t.icon} size={13} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-ink-700">{t.name}</span>
                    <span className="num block text-[10px] text-ink-400">{faDigits(t.markerCount ?? 0)} علامت</span>
                  </span>
                </span>
                <button type="button" className="btn-ghost btn-xs" onClick={() => setTypeForm(t)}>
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  className="btn-danger btn-xs"
                  onClick={async () => {
                    if (!window.confirm(`نوع «${t.name}» حذف شود؟ علامت‌های این نوع بدون نوع خواهند شد.`)) return;
                    try {
                      await api.deleteMarkerType(t.id);
                      push('نوع علامت حذف شد', 'success');
                      onChanged();
                    } catch (e) {
                      push((e as Error).message, 'error');
                    }
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {types.length === 0 ? (
              <p className="py-6 text-center text-[11px] text-ink-400">نوعی تعریف نشده است</p>
            ) : null}
          </div>
          <button type="button" className="btn-soft btn-xs mt-2 w-full justify-center" onClick={() => setTypeForm({})}>
            <Plus size={13} />
            نوع علامت جدید
          </button>
        </div>
      )}

      {typeForm ? (
        <MarkerTypeForm
          draft={typeForm}
          onClose={() => setTypeForm(null)}
          onSaved={() => {
            setTypeForm(null);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}
