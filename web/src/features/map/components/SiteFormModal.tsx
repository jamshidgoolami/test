import { useEffect, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { api } from '../../../lib/api';
import { faDigits } from '../../../lib/format';
import { useSubmitGuard, useToast } from '../../../lib/store';
import { Field, Modal, StatusPill } from '../../../components/ui';
import type { MapDevice, MapSite } from '../model/types';

export function SiteFormModal({
  open,
  groups,
  devices,
  sites,
  onClose,
  onSaved,
}: {
  open: boolean;
  groups: { id: number; name: string }[];
  devices: MapDevice[];
  sites: MapSite[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { push } = useToast();
  const [groupId, setGroupId] = useState<string>('');
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { busy: saving, run: runGuarded } = useSubmitGuard();

  useEffect(() => {
    if (!open) return;
    setGroupId(groups[0] ? String(groups[0].id) : '__none__');
    setName('');
    setSearch('');
    setSelected([]);
    setError(null);
    // انتخاب گروه پیش‌فرض فقط هنگام باز شدن فرم تنظیم می‌شود.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const siteByDevice = useMemo(() => {
    const map = new Map<number, string>();
    for (const site of sites) for (const device of site.devices) map.set(device.id, site.name);
    return map;
  }, [sites]);

  // مقدار <select> شناسهٔ گروه است، اما گروه هر تجهیز در خروجی نقشه با «نام»
  // می‌آید؛ مقایسه با شناسه باعث می‌شد هیچ تجهیزی پیدا نشود.
  const groupName = groups.find((g) => String(g.id) === groupId)?.name ?? '__none__';
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return devices
      .filter((d) => (d.groupName || '__none__') === groupName)
      .filter(
        (d) =>
          !q ||
          [d.name, d.ip, d.location].some((value) =>
            String(value || '')
              .toLowerCase()
              .includes(q)
          )
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  }, [devices, groupName, search]);

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));

  const submit = () => {
    if (!name.trim()) return setError('نام ایستگاه الزامی است');
    if (!selected.length) return setError('حداقل یک تجهیز برای ایستگاه انتخاب کنید');
    void runGuarded(async () => {
      try {
        await api.createSite({
          name: name.trim(),
          group_id: groupId === '__none__' ? null : Number(groupId),
          device_ids: selected,
        });
        push(`ایستگاه «${name.trim()}» ساخته شد`, 'success');
        onSaved();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <Modal
      open={open}
      elevated
      onClose={onClose}
      title="افزودن ایستگاه"
      subtitle="گروه را انتخاب کنید، تجهیزات هم‌مکان را برگزینید و یک نام بگذارید"
      footer={
        <>
          {error ? <p className="me-auto text-xs text-danger">{error}</p> : null}
          <span className="num me-auto text-[11px] text-ink-400">{faDigits(selected.length)} تجهیز انتخاب شده</span>
          <button type="button" className="btn-ghost" onClick={onClose}>
            انصراف
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
            {saving ? 'در حال ذخیره…' : 'ساخت ایستگاه'}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="گروه" required>
            <select
              className="field"
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value);
                setSelected([]);
              }}
            >
              {groups.length ? null : <option value="__none__">بدون گروه</option>}
              {groups.map((g) => (
                <option key={g.id} value={String(g.id)}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="نام ایستگاه" required>
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثلاً ایستگاه مرکزی"
            />
          </Field>
        </div>

        <div className="relative">
          <Search size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            className="field pr-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جست‌وجوی تجهیز بر اساس نام، IP یا محل"
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-ink-500">
          <span>{faDigits(candidates.length)} تجهیز در این گروه</span>
          <div className="flex gap-1">
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => setSelected(candidates.filter((d) => !siteByDevice.has(d.id)).map((d) => d.id))}
            >
              انتخاب همه
            </button>
            <button type="button" className="btn-ghost btn-xs" onClick={() => setSelected([])}>
              هیچ‌کدام
            </button>
          </div>
        </div>

        <div className="max-h-64 overflow-auto rounded-soft border border-ink-200 bg-surface/70 p-1.5">
          {candidates.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-ink-400">تجهیزی در این گروه پیدا نشد</p>
          ) : null}
          <div className="grid gap-1">
            {candidates.map((d) => {
              const occupied = siteByDevice.get(d.id);
              const active = selected.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={!!occupied}
                  onClick={() => toggle(d.id)}
                  className={`flex items-center justify-between gap-2 rounded-soft border px-2 py-1.5 text-right transition ${
                    occupied
                      ? 'cursor-not-allowed border-ink-100 bg-ink-50/60 opacity-70'
                      : active
                        ? 'border-brand-300 bg-brand-50/70'
                        : 'border-ink-100 bg-surface hover:border-brand-200'
                  }`}
                  aria-pressed={active}
                  title={occupied ? `عضو ایستگاه «${occupied}» است` : `انتخاب ${d.name}`}
                >
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border ${
                      active ? 'border-brand-500 bg-brand-500 text-white' : 'border-ink-300 bg-surface text-transparent'
                    }`}
                  >
                    <Check size={11} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-ink-700">{d.name}</span>
                    <span className="num block text-[10px] text-ink-400">
                      {d.ip}
                      {d.location ? ` · ${d.location}` : ''}
                    </span>
                  </span>
                  {occupied ? (
                    <span className="shrink-0 rounded-pill bg-sun-50 px-1.5 py-0.5 text-[9.5px] text-warning">
                      در {occupied}
                    </span>
                  ) : (
                    <StatusPill status={d.status} size="sm" showLabel={false} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
