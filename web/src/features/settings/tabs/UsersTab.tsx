import { useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { api } from '../../../lib/api';
import { useApp, useAsync, useToast } from '../../../lib/store';

import { fmtDateTime } from '../../../lib/format';
import { Badge, Card, CardHeader, EmptyState, Field, Modal, Toggle } from '../../../components/ui';

import type { AuthRole, AuthUser } from '../../../lib/types';

export function UsersTab() {
  const { push } = useToast();
  const { tzOffset } = useApp();
  const { data, loading, error, refresh } = useAsync((signal) => api.users(signal), []);
  const [createOpen, setCreateOpen] = useState(false);
  const [passwordFor, setPasswordFor] = useState<AuthUser | null>(null);
  const [form, setForm] = useState({ username: '', displayName: '', password: '', role: 'viewer' as AuthRole });
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const roles = data?.roles ?? [
    { value: 'admin', label: 'Administrator' },
    { value: 'operator', label: 'Operator' },
    { value: 'viewer', label: 'Viewer' },
  ];
  const policy = data?.passwordPolicy;
  const items = data?.items ?? [];

  const run = async (action: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      push(ok, 'success');
      refresh();
    } catch (e) {
      push((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!form.username.trim() || !form.password) {
      push('نام کاربری و رمز عبور الزامی است.', 'warning');
      return;
    }
    await run(async () => {
      await api.createUser({
        username: form.username.trim(),
        password: form.password,
        role: form.role,
        displayName: form.displayName.trim() || undefined,
      });
      setCreateOpen(false);
      setForm({ username: '', displayName: '', password: '', role: 'viewer' });
    }, 'کاربر ساخته شد');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="مدیریت کاربران"
          subtitle="Administrator همهٔ مجوزها؛ Operator عملیات روزمره بدون نمایش رمز؛ Viewer فقط مشاهده. نمایش رمز را می‌توان جدا به هر کاربر داد."
          icon={<Users size={18} />}
          action={
            <button type="button" className="btn-primary btn-xs" onClick={() => setCreateOpen(true)}>
              <Plus size={14} />
              کاربر جدید
            </button>
          }
        />
        {policy?.rules?.length ? (
          <p className="mt-3 rounded-soft border border-ink-100 bg-ink-50/70 px-3 py-2 text-[11px] leading-relaxed text-ink-500">
            سیاست رمز: {policy.rules.join(' · ')}
          </p>
        ) : null}

        {loading && !data ? (
          <p className="py-10 text-center text-xs text-ink-400">در حال دریافت کاربران…</p>
        ) : error && !data ? (
          <p className="my-4 rounded-soft border border-red-100 bg-red-50/70 px-3 py-2 text-[12px] text-danger">
            {error}
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            title="کاربری یافت نشد"
            description="نخستین کاربر را با دکمهٔ «کاربر جدید» بسازید."
            icon={<Users size={22} />}
          />
        ) : (
          <div className="table-wrap mt-3">
            <table className="table">
              <thead>
                <tr>
                  <th>کاربر</th>
                  <th>نقش</th>
                  <th>وضعیت</th>
                  <th>آخرین ورود</th>
                  <th className="text-center">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className="block font-medium text-ink-800">{u.displayName || u.username}</span>
                      <span className="num block text-[10.5px] text-ink-400">@{u.username}</span>
                    </td>
                    <td>
                      <select
                        className="field !w-auto !rounded-pill !py-1 text-[11px]"
                        value={u.role}
                        disabled={busy}
                        aria-label={`نقش ${u.username}`}
                        onChange={(e) =>
                          run(() => api.updateUser(u.id, { role: e.target.value }), 'نقش کاربر تغییر کرد')
                        }
                      >
                        {roles.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Toggle
                          checked={!u.disabled}
                          disabled={busy}
                          onChange={(v) =>
                            run(() => api.updateUser(u.id, { disabled: !v }), v ? 'کاربر فعال شد' : 'کاربر غیرفعال شد')
                          }
                          label={u.disabled ? 'غیرفعال' : 'فعال'}
                        />
                        {u.locked ? <Badge tone="red">قفل‌شده</Badge> : null}
                      </div>
                    </td>
                    <td className="text-[11px] text-ink-500">
                      {u.lastLoginAt ? fmtDateTime(u.lastLoginAt, tzOffset) : 'هرگز'}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        {u.role !== 'admin' ? (
                          <button
                            type="button"
                            className={`btn-xs ${(u.extraPermissions ?? []).includes('credentials:reveal') ? 'btn-soft' : 'btn-ghost'}`}
                            disabled={busy}
                            title="اعطا یا لغو مجوز اختصاصی نمایش رمزهای واقعی"
                            onClick={() => {
                              const granted = (u.extraPermissions ?? []).includes('credentials:reveal');
                              void run(
                                () => api.updateUser(u.id, { extraPermissions: granted ? [] : ['credentials:reveal'] }),
                                granted ? 'مجوز نمایش رمز لغو شد' : 'مجوز نمایش رمز داده شد'
                              );
                            }}
                          >
                            {(u.extraPermissions ?? []).includes('credentials:reveal')
                              ? 'لغو نمایش رمز'
                              : 'اجازهٔ نمایش رمز'}
                          </button>
                        ) : null}
                        {u.locked ? (
                          <button
                            type="button"
                            className="btn-ghost btn-xs"
                            disabled={busy}
                            onClick={() => run(() => api.unlockUser(u.id), 'قفل حساب باز شد')}
                          >
                            بازکردن قفل
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-ghost btn-xs"
                          disabled={busy}
                          onClick={() => {
                            setNewPassword('');
                            setPasswordFor(u);
                          }}
                        >
                          تغییر رمز
                        </button>
                        <button
                          type="button"
                          className="btn-danger btn-xs"
                          disabled={busy}
                          title="حذف کاربر"
                          onClick={() => {
                            if (!window.confirm(`کاربر «${u.username}» حذف شود؟`)) return;
                            void run(() => api.deleteUser(u.id), 'کاربر حذف شد');
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="کاربر جدید"
        subtitle="نام کاربری یکتا، نقش و رمز مطابق سیاست امنیتی"
        footer={
          <>
            <button type="button" className="btn-ghost btn-xs" onClick={() => setCreateOpen(false)}>
              انصراف
            </button>
            <button type="button" className="btn-primary btn-xs" disabled={busy} onClick={() => void create()}>
              {busy ? 'در حال ساخت…' : 'ساخت کاربر'}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="نام کاربری" required>
            <input
              className="field num"
              dir="ltr"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              autoComplete="off"
            />
          </Field>
          <Field label="نام نمایشی">
            <input
              className="field"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </Field>
          <Field label="نقش">
            <select
              className="field"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as AuthRole })}
            >
              {roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="رمز عبور" required hint={policy?.rules?.[0]}>
            <input
              className="field"
              dir="ltr"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!passwordFor}
        onClose={() => setPasswordFor(null)}
        title={`تغییر رمز ${passwordFor?.username ?? ''}`}
        subtitle="با تغییر رمز، همهٔ نشست‌های فعال این کاربر بسته می‌شود."
        size="sm"
        footer={
          <>
            <button type="button" className="btn-ghost btn-xs" onClick={() => setPasswordFor(null)}>
              انصراف
            </button>
            <button
              type="button"
              className="btn-primary btn-xs"
              disabled={busy || !newPassword}
              onClick={() =>
                passwordFor &&
                void run(async () => {
                  await api.updateUser(passwordFor.id, { password: newPassword });
                  setPasswordFor(null);
                }, 'رمز کاربر تغییر کرد')
              }
            >
              ذخیرهٔ رمز
            </button>
          </>
        }
      >
        <Field label="رمز جدید" required hint={policy?.rules?.[0]}>
          <input
            className="field"
            dir="ltr"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
      </Modal>
    </div>
  );
}
