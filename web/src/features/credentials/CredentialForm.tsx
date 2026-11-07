import React, { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, Save, Server, Wand2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useSubmitGuard, useToast } from '../../lib/store';
import { CREDENTIAL_KINDS, assessSecretPreview, splitTags } from '../../lib/credential-rules';
import { faDigits } from '../../lib/format';
import { Field, Modal } from '../../components/ui';
import type { Credential, Device, CredentialInput, CredentialKind } from '../../lib/types';
import PasswordGenerator from './PasswordGenerator';
import StrengthMeter from './StrengthMeter';

interface FormState {
  label: string;
  kind: CredentialKind;
  deviceId: string;
  username: string;
  secret: string;
  host: string;
  port: string;
  tags: string;
  notes: string;
  rotateEveryDays: string;
}

const EMPTY: FormState = {
  label: '',
  kind: 'ssh',
  deviceId: '',
  username: '',
  secret: '',
  host: '',
  port: '',
  tags: '',
  notes: '',
  rotateEveryDays: '',
};

function stateOf(credential: Credential | null): FormState {
  if (!credential) return { ...EMPTY };
  return {
    label: credential.label,
    kind: credential.kind,
    deviceId: credential.deviceId ? String(credential.deviceId) : '',
    username: credential.username,
    secret: '',
    host: credential.host,
    port: credential.port ? String(credential.port) : '',
    tags: credential.tags.join('، '),
    notes: credential.notes ?? '',
    rotateEveryDays: credential.rotateEveryDays ? String(credential.rotateEveryDays) : '',
  };
}

/**
 * فرم افزودن/ویرایش اعتبارنامه.
 * در حالت ویرایش، خالی‌بودن فیلد رمز یعنی «بدون تغییر»؛ رمز فعلی هرگز از
 * سرور برای پرکردن فرم خوانده نمی‌شود.
 */
export default function CredentialForm({
  open,
  credential,
  devices,
  onClose,
  onSaved,
}: {
  open: boolean;
  credential: Credential | null;
  devices: Device[];
  onClose: () => void;
  onSaved: (credential: Credential, mode: 'create' | 'update') => void;
}) {
  const { push } = useToast();
  const { busy, run } = useSubmitGuard();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [showSecret, setShowSecret] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(credential);

  useEffect(() => {
    if (!open) return;
    setForm(stateOf(credential));
    setShowSecret(false);
    setGeneratorOpen(false);
    setError(null);
  }, [open, credential]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const preview = useMemo(
    () =>
      assessSecretPreview(form.secret, {
        label: form.label,
        username: form.username,
        host: form.host,
      }),
    [form.secret, form.label, form.username, form.host]
  );

  const submit = async () => {
    const label = form.label.trim();
    if (!label) {
      setError('عنوان اعتبارنامه الزامی است.');
      return;
    }
    if (!editing && !form.secret) {
      setError('برای ثبت اعتبارنامه، رمز یا توکن را وارد کنید (یا با تولیدکننده بسازید).');
      return;
    }
    const port = form.port.trim() ? Number(form.port) : null;
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      setError('پورت باید عددی بین ۱ و ۶۵۵۳۵ باشد.');
      return;
    }
    const rotate = form.rotateEveryDays.trim() ? Number(form.rotateEveryDays) : null;
    if (rotate !== null && (!Number.isInteger(rotate) || rotate < 1 || rotate > 3650)) {
      setError('دورهٔ چرخش باید بین ۱ و ۳۶۵۰ روز باشد.');
      return;
    }

    const payload: CredentialInput = {
      label,
      kind: form.kind,
      deviceId: form.deviceId ? Number(form.deviceId) : null,
      username: form.username,
      host: form.host.trim(),
      port,
      tags: splitTags(form.tags),
      notes: form.notes,
      rotateEveryDays: rotate,
    };
    if (form.secret) payload.secret = form.secret;

    const saved = await run(async () => {
      try {
        const result = editing
          ? await api.updateCredential(credential!.id, payload)
          : await api.createCredential(payload);
        onSaved(result, editing ? 'update' : 'create');
        push(editing ? 'اعتبارنامه به‌روزرسانی شد.' : 'اعتبارنامه ثبت شد.', 'success');
        return result;
      } catch (e) {
        const message = e instanceof Error ? e.message : 'ثبت اعتبارنامه ممکن نشد.';
        setError(message);
        push(message, 'error');
        return null;
      }
    });
    if (saved) onClose();
  };

  const strength = editing && !form.secret ? null : preview;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `ویرایش «${credential?.label}»` : 'اعتبارنامهٔ جدید'}
      subtitle="نام کاربری، رمز و یادداشت با AES‑256‑GCM رمزنگاری می‌شوند و رمز فقط با دکمهٔ نمایش خوانده می‌شود."
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            انصراف
          </button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={busy}>
            <Save size={15} />
            {busy ? 'در حال ذخیره…' : editing ? 'ذخیرهٔ تغییرات' : 'ثبت اعتبارنامه'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? (
          <div className="rounded-soft border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-danger" role="alert">
            {error}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="عنوان" required className="sm:col-span-2" hint="مثال: «SSH سوئیچ طبقهٔ دو» یا «پنل وب فایروال»">
            <input
              className="input"
              value={form.label}
              maxLength={120}
              onChange={(e) => set('label', e.target.value)}
              placeholder="SSH سوئیچ اصلی"
              autoFocus
            />
          </Field>

          <Field label="نوع اعتبارنامه" required>
            <select className="input" value={form.kind} onChange={(e) => set('kind', e.target.value as CredentialKind)}>
              {CREDENTIAL_KINDS.map((kind) => (
                <option key={kind.id} value={kind.id}>
                  {kind.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="تجهیز مرتبط" hint="اختیاری؛ بدون تجهیز هم قابل ثبت است">
            <select className="input" value={form.deviceId} onChange={(e) => set('deviceId', e.target.value)}>
              <option value="">بدون تجهیز</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name} — {device.ip}
                </option>
              ))}
            </select>
          </Field>

          <Field label="نام کاربری" hint="در فهرست نمایش داده می‌شود ولی رمزنگاری‌شده ذخیره می‌شود">
            <input
              className="input"
              dir="ltr"
              value={form.username}
              maxLength={255}
              onChange={(e) => set('username', e.target.value)}
              placeholder="admin"
            />
          </Field>

          <div className="grid grid-cols-3 gap-2">
            <Field label="میزبان" className="col-span-2">
              <input
                className="input"
                dir="ltr"
                value={form.host}
                maxLength={255}
                onChange={(e) => set('host', e.target.value)}
                placeholder="10.0.0.2"
              />
            </Field>
            <Field label="پورت">
              <input
                className="input"
                dir="ltr"
                inputMode="numeric"
                value={form.port}
                onChange={(e) => set('port', e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
                placeholder="22"
              />
            </Field>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="label mb-0">
              {editing ? 'رمز جدید (برای تغییر)' : 'رمز / توکن'} {!editing ? <span className="text-danger">*</span> : null}
            </span>
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => setGeneratorOpen((value) => !value)}
              aria-expanded={generatorOpen}
            >
              <Wand2 size={13} />
              {generatorOpen ? 'بستن تولیدکننده' : 'تولید رمز'}
            </button>
          </div>
          <div className="flex items-stretch gap-2">
            <input
              className="input flex-1 font-mono"
              dir="ltr"
              type={showSecret ? 'text' : 'password'}
              value={form.secret}
              maxLength={1024}
              autoComplete="new-password"
              spellCheck={false}
              onChange={(e) => set('secret', e.target.value)}
              placeholder={editing ? 'بدون تغییر' : '••••••••'}
            />
            <button
              type="button"
              className="btn-ghost btn-xs px-2.5"
              onClick={() => setShowSecret((value) => !value)}
              aria-label={showSecret ? 'پنهان‌کردن رمز' : 'نمایش رمز'}
              title={showSecret ? 'پنهان‌کردن' : 'نمایش'}
            >
              {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          {strength ? (
            <div className="mt-2">
              <StrengthMeter score={strength.score} reasons={strength.reasons} entropyBits={strength.entropyBits} estimated />
            </div>
          ) : editing ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] text-ink-400">
              <Lock size={12} /> رمز فعلی دست‌نخورده می‌ماند؛ برای تغییر، رمز جدید را وارد کنید.
            </p>
          ) : null}

          {generatorOpen ? (
            <div className="mt-2.5">
              <PasswordGenerator
                onUse={(value) => {
                  set('secret', value);
                  setShowSecret(true);
                }}
              />
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="برچسب‌ها" hint="با ویرگول جدا کنید؛ برای جست‌وجو استفاده می‌شوند">
            <input
              className="input"
              value={form.tags}
              onChange={(e) => set('tags', e.target.value)}
              placeholder="core ، طبقه۲ ، cisco"
            />
          </Field>
          <Field label="دورهٔ چرخش (روز)" hint="اختیاری؛ موعد چرخش در فهرست هشدار داده می‌شود">
            <input
              className="input"
              dir="ltr"
              inputMode="numeric"
              value={form.rotateEveryDays}
              onChange={(e) => set('rotateEveryDays', e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
              placeholder="90"
            />
          </Field>
          <Field label="یادداشت" className="sm:col-span-2" hint="رمزنگاری‌شده ذخیره می‌شود و فقط در همین فرم دیده می‌شود">
            <textarea
              className="input min-h-[70px] resize-y"
              value={form.notes}
              maxLength={2000}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="مثلاً: دسترسی فقط از VLAN مدیریت"
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-soft border border-ink-100 bg-ink-50/60 px-3 py-2 text-[11.5px] text-ink-500">
          <span className="inline-flex items-center gap-1.5">
            <KeyRound size={13} className="text-accent" /> رمز با کلید سرور رمزنگاری می‌شود
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Server size={13} /> {faDigits(devices.length)} تجهیز برای اتصال در دسترس است
          </span>
        </div>
      </div>
    </Modal>
  );
}
