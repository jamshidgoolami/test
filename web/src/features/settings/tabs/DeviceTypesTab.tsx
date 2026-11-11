import { useState } from 'react';
import { Plus, Server, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { useApp, useAsync, useToast } from '../../../lib/store';
import { useAuth } from '../../../lib/auth';
import { faDigits } from '../../../lib/format';
import { Card, CardHeader, EmptyState, Field, Modal } from '../../../components/ui';
import { ColorField } from '../../../components/ColorField';

import type { DeviceType } from '../../../lib/types';

export function DeviceTypesTab() {
  const { push } = useToast();
  const { refreshMeta } = useApp();
  const { can } = useAuth();
  const canWrite = can('inventory:write');
  const { data, refresh } = useAsync((signal) => api.deviceTypes(signal), []);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: number; name: string; color: string } | null>(null);

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      push('نام نوع تجهیز را وارد کنید', 'warning');
      return;
    }
    try {
      if (editing.id) await api.updateDeviceType(editing.id, { name: editing.name.trim(), color: editing.color });
      else await api.createDeviceType({ name: editing.name.trim(), color: editing.color });
      push('نوع تجهیز ذخیره شد', 'success');
      setOpen(false);
      setEditing(null);
      refresh();
      refreshMeta();
    } catch (e) {
      push((e as Error).message, 'error');
    }
  };

  return (
    <Card>
      <CardHeader
        title="انواع تجهیزات"
        subtitle="فهرست نوع‌هایی که در فیلد «نوع تجهیز» انتخاب می‌شوند؛ انواع ناشناخته در ورود گروهی هم خودکار افزوده می‌شوند"
        icon={<Server size={18} />}
        action={
          canWrite ? (
            <button
              type="button"
              className="btn-soft btn-xs"
              onClick={() => {
                setEditing({ id: 0, name: '', color: '#2563eb' });
                setOpen(true);
              }}
            >
              <Plus size={13} />
              نوع جدید
            </button>
          ) : null
        }
      />
      <div className="mt-4 flex flex-wrap gap-2">
        {(data?.items ?? []).map((t: DeviceType) => (
          <div
            key={t.id}
            className="flex items-center gap-2 rounded-soft border border-ink-200 bg-surface/70 px-3 py-2"
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
            <span className="text-[12.5px] font-medium text-ink-700">{t.name}</span>
            <span className="num text-[10.5px] text-ink-400">{faDigits(t.device_count ?? 0)} تجهیز</span>
            {canWrite ? (
              <>
                <button
                  type="button"
                  className="btn-ghost btn-xs"
                  onClick={() => {
                    setEditing({ id: t.id, name: t.name, color: t.color || '#2563eb' });
                    setOpen(true);
                  }}
                >
                  ویرایش
                </button>
                <button
                  type="button"
                  className="btn-danger btn-xs"
                  onClick={async () => {
                    if (!window.confirm(`حذف نوع «${t.name}»؟`)) return;
                    try {
                      await api.deleteDeviceType(t.id);
                      refresh();
                      refreshMeta();
                    } catch (e) {
                      push((e as Error).message, 'error');
                    }
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </>
            ) : null}
          </div>
        ))}
        {(data?.items ?? []).length === 0 ? <EmptyState title="نوع تجهیزی تعریف نشده است" /> : null}
      </div>
      <p className="mt-4 rounded-soft border border-brand-100 bg-brand-50/60 p-3 text-[11.5px] leading-relaxed text-accent">
        تغییر نام یک نوع، نوع همهٔ تجهیزات همان نوع را هم به‌روزرسانی می‌کند. حذف نوعی که تجهیز دارد تا زمانی که نوع آن
        تجهیزات تغییر نکند ممکن نیست.
      </p>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing?.id ? 'ویرایش نوع تجهیز' : 'افزودن نوع تجهیز'}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              انصراف
            </button>
            <button type="button" className="btn-primary" onClick={save}>
              ذخیره
            </button>
          </>
        }
      >
        {editing ? (
          <div className="grid gap-4">
            <Field label="نام نوع" required hint="مثلاً «چاپگر شبکه» یا «دستگاه حضور و غیاب»">
              <input
                className="field"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <Field label="رنگ نوع">
              <ColorField value={editing.color} onChange={(color) => setEditing({ ...editing, color })} />
            </Field>
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
