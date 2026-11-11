import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '../../../lib/api';
import { useSubmitGuard, useToast } from '../../../lib/store';
import { ColorField } from '../../../components/ColorField';
import { Field, Modal } from '../../../components/ui';
import type { MapMarker, MarkerType } from '../../../lib/types';
import { MARKER_ICON_NAMES, MarkerGlyph } from '../lib/markers';

export function MarkerTypeForm({
  draft,
  onClose,
  onSaved,
}: {
  draft: Partial<MarkerType>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { push } = useToast();
  const editing = !!draft.id;
  const [name, setName] = useState(draft.name ?? '');
  const [color, setColor] = useState(draft.color ?? '#0ea5e9');
  const [icon, setIcon] = useState(draft.icon ?? 'map-pin');
  const [description, setDescription] = useState(draft.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const { busy: saving, run: runGuarded } = useSubmitGuard();

  const submit = () => {
    if (!name.trim()) return setError('نام نوع علامت الزامی است');
    void runGuarded(async () => {
      try {
        if (editing) await api.updateMarkerType(draft.id!, { name, color, icon, description });
        else await api.createMarkerType({ name, color, icon, description });
        push(editing ? 'نوع علامت به‌روزرسانی شد' : 'نوع علامت ساخته شد', 'success');
        onSaved();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <Modal
      open
      elevated
      size="sm"
      onClose={onClose}
      title={editing ? `ویرایش نوع — ${draft.name}` : 'نوع علامت جدید'}
      subtitle="نام، رنگ و آیکون این نوع علامت را مشخص کنید"
      footer={
        <>
          {error ? <p className="me-auto text-xs text-danger">{error}</p> : null}
          <button type="button" className="btn-ghost" onClick={onClose}>
            انصراف
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
            {saving ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نام نوع علامت" required className="sm:col-span-2">
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثلاً تجهیز در حال نصب"
          />
        </Field>
        <Field label="رنگ">
          <ColorField value={color} onChange={setColor} />
        </Field>
        <Field label="آیکون">
          <select className="field" value={icon} onChange={(e) => setIcon(e.target.value)}>
            {MARKER_ICON_NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="توضیحات" className="sm:col-span-2">
          <input className="field" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="sm:col-span-2 flex items-center gap-3 rounded-soft border border-ink-200 bg-surface/70 p-3">
          <span className="text-[11.5px] text-ink-500">پیش‌نمایش:</span>
          <span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: `${color}1f`, color }}>
            <MarkerGlyph name={icon} size={16} />
          </span>
          <span className="text-[12.5px] font-medium text-ink-700">{name || 'نام نوع علامت'}</span>
        </div>
      </div>
    </Modal>
  );
}

/* ----------------------------- فرم علامت ----------------------------- */
export function MarkerForm({
  open,
  draft,
  types,
  onClose,
  onSaved,
}: {
  open: boolean;
  draft: { latitude: number; longitude: number; typeId: number | null; typeName: string; marker?: MapMarker } | null;
  types: MarkerType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { push } = useToast();
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState<string>('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { busy: saving, run: runGuarded } = useSubmitGuard();

  useEffect(() => {
    if (!open || !draft) return;
    setError(null);
    setName(draft.marker?.name ?? '');
    setTypeId(String(draft.marker?.typeId ?? draft.typeId ?? types[0]?.id ?? ''));
    setLatitude(String(draft.marker?.latitude ?? draft.latitude));
    setLongitude(String(draft.marker?.longitude ?? draft.longitude));
    setNotes(draft.marker?.notes ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  if (!open || !draft) return null;
  const editing = !!draft.marker;

  const submit = () => {
    if (!name.trim()) return setError('نام علامت الزامی است');
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return setError('عرض جغرافیایی نامعتبر است');
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return setError('طول جغرافیایی نامعتبر است');
    void runGuarded(async () => {
      try {
        const payload = { name: name.trim(), type_id: Number(typeId) || null, latitude: lat, longitude: lng, notes };
        if (editing) await api.updateMarker(draft.marker!.id, payload);
        else await api.createMarker(payload);
        push(editing ? 'علامت به‌روزرسانی شد' : 'علامت روی نقشه جانمایی شد', 'success');
        onSaved();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <Modal
      open
      elevated
      size="sm"
      onClose={onClose}
      title={editing ? `ویرایش علامت — ${draft.marker!.name}` : 'جانمایی علامت جدید'}
      subtitle={editing ? 'مشخصات علامت را ویرایش کنید' : 'نام و نوع این علامت را مشخص کنید'}
      footer={
        <>
          {error ? <p className="me-auto text-xs text-danger">{error}</p> : null}
          <button type="button" className="btn-ghost" onClick={onClose}>
            انصراف
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
            <Save size={15} />
            {saving ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نام علامت" required className="sm:col-span-2">
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثلاً نصب سوئیچ — ساختمان اداری"
          />
        </Field>
        <Field label="نوع علامت" className="sm:col-span-2">
          <select className="field" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="عرض جغرافیایی">
          <input dir="ltr" className="field num" value={latitude} onChange={(e) => setLatitude(e.target.value)} />
        </Field>
        <Field label="طول جغرافیایی">
          <input dir="ltr" className="field num" value={longitude} onChange={(e) => setLongitude(e.target.value)} />
        </Field>
        <Field label="توضیحات" className="sm:col-span-2">
          <textarea className="field min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
