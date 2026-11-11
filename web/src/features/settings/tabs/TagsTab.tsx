import { useState } from 'react';
import { Plus, Tag as TagIcon, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { useApp, useAsync, useToast } from '../../../lib/store';

import { faDigits } from '../../../lib/format';
import { Badge, Card, CardHeader, EmptyState, Field, Modal, Toggle } from '../../../components/ui';
import { ColorField } from '../../../components/ColorField';

export function TagsTab() {
  const { push } = useToast();
  const { refreshMeta } = useApp();
  const { data, refresh } = useAsync((signal) => api.tags(signal), []);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: number; name: string; color: string; show_on_map: number } | null>(null);

  const save = async () => {
    if (!editing) return;
    try {
      if (editing.id) await api.updateTag(editing.id, editing);
      else await api.createTag(editing);
      push('تگ ذخیره شد', 'success');
      setOpen(false);
      refresh();
      refreshMeta();
    } catch (e) {
      push((e as Error).message, 'error');
    }
  };

  return (
    <Card>
      <CardHeader
        title="مدیریت تگ‌ها"
        subtitle="تگ‌گذاری تجهیزات و کنترل نمایش آن‌ها روی نقشه"
        icon={<TagIcon size={18} />}
        action={
          <button
            type="button"
            className="btn-soft btn-xs"
            onClick={() => {
              setEditing({ id: 0, name: '', color: '#f59e0b', show_on_map: 1 });
              setOpen(true);
            }}
          >
            <Plus size={13} />
            تگ جدید
          </button>
        }
      />
      <div className="mt-4 flex flex-wrap gap-2">
        {(data?.items ?? []).map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2 rounded-soft border border-ink-200 bg-surface/70 px-3 py-2"
          >
            <span className="chip" style={{ borderColor: `${t.color}44`, background: `${t.color}12`, color: t.color }}>
              {t.name}
            </span>
            <span className="num text-[10.5px] text-ink-400">{faDigits(t.device_count ?? 0)} تجهیز</span>
            {t.show_on_map ? <Badge tone="brand">روی نقشه</Badge> : null}
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => {
                setEditing({ id: t.id, name: t.name, color: t.color, show_on_map: t.show_on_map ? 1 : 0 });
                setOpen(true);
              }}
            >
              ویرایش
            </button>
            <button
              type="button"
              className="btn-danger btn-xs"
              onClick={async () => {
                if (!window.confirm(`حذف تگ «${t.name}»؟`)) return;
                try {
                  await api.deleteTag(t.id);
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
        ))}
        {(data?.items ?? []).length === 0 ? <EmptyState title="تگی تعریف نشده است" /> : null}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing?.id ? 'ویرایش تگ' : 'افزودن تگ جدید'}
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
            <Field label="نام تگ" required>
              <input
                className="field"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <Field label="رنگ تگ">
              <ColorField value={editing.color} onChange={(color) => setEditing({ ...editing, color })} />
            </Field>
            <div className="sm:col-span-2">
              <Toggle
                checked={!!editing.show_on_map}
                onChange={(v) => setEditing({ ...editing, show_on_map: v ? 1 : 0 })}
                label="نمایش این تگ روی نقشه"
                hint="برچسب تگ کنار نشانگر تجهیز روی نقشه نمایش داده می‌شود"
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
