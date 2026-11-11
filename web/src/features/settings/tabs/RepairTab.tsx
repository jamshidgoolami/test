import { useState } from 'react';
import { Plus, Save, Wrench } from 'lucide-react';

import { Card, CardHeader } from '../../../components/ui';

import type { AppSettings } from '../../../lib/types';

export function RepairTab({
  local,
  set,
  persist,
  saving,
}: {
  local: AppSettings;
  set: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void;
  persist: (patch?: Partial<AppSettings>) => Promise<void>;
  saving: boolean;
}) {
  const [cause, setCause] = useState('');
  const [action, setAction] = useState('');
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader
          title="علت‌های خرابی و قطعی"
          subtitle="این فهرست در فرم ثبت سوابق تعمیرات استفاده می‌شود"
          icon={<Wrench size={18} />}
        />
        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            <input
              className="field"
              placeholder="افزودن علت جدید…"
              value={cause}
              onChange={(e) => setCause(e.target.value)}
            />
            <button
              type="button"
              className="btn-soft btn-xs"
              onClick={() => {
                if (!cause.trim()) return;
                set('repair_causes', [...new Set([...local.repair_causes, cause.trim()])]);
                setCause('');
              }}
            >
              <Plus size={13} />
              افزودن
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {local.repair_causes.map((c) => (
              <span key={c} className="chip border-ink-200 bg-surface text-ink-600">
                {c}
                <button
                  type="button"
                  className="text-ink-400 hover:text-danger"
                  onClick={() =>
                    set(
                      'repair_causes',
                      local.repair_causes.filter((x) => x !== c)
                    )
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="اقدامات انجام‌شده"
          subtitle="فهرست اقدامات قابل ثبت در سوابق نگهداری"
          icon={<Wrench size={18} />}
        />
        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            <input
              className="field"
              placeholder="افزودن اقدام جدید…"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
            <button
              type="button"
              className="btn-soft btn-xs"
              onClick={() => {
                if (!action.trim()) return;
                set('repair_actions', [...new Set([...local.repair_actions, action.trim()])]);
                setAction('');
              }}
            >
              <Plus size={13} />
              افزودن
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {local.repair_actions.map((a) => (
              <span key={a} className="chip border-ink-200 bg-surface text-ink-600">
                {a}
                <button
                  type="button"
                  className="text-ink-400 hover:text-danger"
                  onClick={() =>
                    set(
                      'repair_actions',
                      local.repair_actions.filter((x) => x !== a)
                    )
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      </Card>

      <div className="xl:col-span-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary btn-xs"
          disabled={saving}
          onClick={() => persist({ repair_causes: local.repair_causes, repair_actions: local.repair_actions })}
        >
          <Save size={13} />
          {saving ? 'در حال ذخیره…' : 'ذخیرهٔ علت‌ها و اقدامات'}
        </button>
        <span className="text-[12px] text-ink-400">فقط همین دو فهرست ذخیره می‌شود.</span>
      </div>
    </div>
  );
}
