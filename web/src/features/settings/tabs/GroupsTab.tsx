import { useState } from 'react';
import { Layers, Plus, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { useApp, useAsync, useToast } from '../../../lib/store';

import { faDigits } from '../../../lib/format';
import { Card, CardHeader, EmptyState, Field, Modal } from '../../../components/ui';
import { ColorField } from '../../../components/ColorField';

export function GroupsTab() {
  const { push } = useToast();
  const { refreshMeta } = useApp();
  const { data, refresh } = useAsync((signal) => api.groups(signal), []);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: number; name: string; description: string; color: string } | null>(null);

  const save = async () => {
    if (!editing) return;
    try {
      if (editing.id) await api.updateGroup(editing.id, editing);
      else await api.createGroup(editing);
      push('گروه ذخیره شد', 'success');
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
        title="مدیریت گروه‌های تجهیزات"
        subtitle="دسته‌بندی تجهیزات در گروه‌های مختلف و تعیین بازه بررسی مستقل"
        icon={<Layers size={18} />}
        action={
          <button
            type="button"
            className="btn-soft btn-xs"
            onClick={() => {
              setEditing({ id: 0, name: '', description: '', color: '#2563eb' });
              setOpen(true);
            }}
          >
            <Plus size={13} />
            گروه جدید
          </button>
        }
      />
      <div className="mt-4 space-y-3">
        {(data?.items ?? []).map((g) => (
          <div
            key={g.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-soft border border-ink-200 bg-surface/70 p-3"
          >
            <div className="flex items-center gap-3">
              <span
                className="h-8 w-8 rounded-soft"
                style={{ background: `${g.color}22`, border: `1px solid ${g.color}55` }}
              />
              <div>
                <p className="text-[12.5px] font-semibold text-ink-700">{g.name}</p>
                <p className="mt-0.5 text-[11px] text-ink-500">{g.description || '—'}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-500">
              <span className="num">{faDigits(g.device_count ?? 0)} تجهیز</span>
              <span className="num text-success">{faDigits(g.online ?? 0)} در دسترس</span>
              <span className="num text-warning">{faDigits(g.warning ?? 0)} اختلال</span>
              <span className="num text-danger">{faDigits(g.offline ?? 0)} قطع</span>
              <button
                type="button"
                className="btn-ghost btn-xs"
                onClick={() => {
                  setEditing({ id: g.id, name: g.name, description: g.description, color: g.color });
                  setOpen(true);
                }}
              >
                ویرایش
              </button>
              <button
                type="button"
                className="btn-danger btn-xs"
                onClick={async () => {
                  if (!window.confirm(`حذف گروه «${g.name}»؟ تجهیزات این گروه بدون گروه خواهند شد.`)) return;
                  try {
                    await api.deleteGroup(g.id);
                    refresh();
                    refreshMeta();
                  } catch (e) {
                    push((e as Error).message, 'error');
                  }
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
        {(data?.items ?? []).length === 0 ? <EmptyState title="گروهی تعریف نشده است" /> : null}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing?.id ? 'ویرایش گروه' : 'افزودن گروه جدید'}
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نام گروه" required>
              <input
                className="field"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <Field label="رنگ گروه">
              <ColorField value={editing.color} onChange={(color) => setEditing({ ...editing, color })} />
            </Field>
            <Field label="توضیحات" className="sm:col-span-2">
              <textarea
                className="field min-h-[70px]"
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              />
            </Field>
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
