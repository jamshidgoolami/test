import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Eye, EyeOff, KeyRound, Lock, Save, Search, Server, Wand2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useSubmitGuard, useToast } from '../../lib/store';
import { assessSecretPreview, splitTags } from '../../lib/credential-rules';
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
}

const EMPTY: FormState = {
  label: '',
  kind: 'other',
  deviceId: '',
  username: '',
  secret: '',
  host: '',
  port: '',
  tags: '',
  notes: '',
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
  };
}

/**
 * انتخاب تجهیز مرتبط با جست‌وجو.
 * فهرست تجهیزات می‌تواند صدها ردیف باشد، بنابراین به‌جای select بومی یک
 * ترکیب جست‌وجو + فهرست کشویی استفاده می‌شود؛ انتخاب با صفحه‌کلید هم ممکن است.
 */
function DevicePicker({
  devices,
  value,
  onChange,
}: {
  devices: Device[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = devices.find((device) => String(device.id) === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fa');
    if (!needle) return devices;
    return devices.filter((device) =>
      `${device.name} ${device.ip}`.toLocaleLowerCase('fa').includes(needle)
    );
  }, [devices, query]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        className="field-strong flex items-center gap-1.5 text-right"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="انتخاب تجهیز مرتبط"
      >
        <Server size={14} className="shrink-0 text-ink-400" />
        <span className={`min-w-0 flex-1 truncate ${selected ? 'text-ink-800' : 'text-ink-400'}`}>
          {selected ? `${selected.name} — ${selected.ip}` : 'بدون تجهیز'}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-ink-400 transition ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-soft border border-ink-200 bg-surface shadow-pop">
          <div className="flex items-center gap-1.5 border-b border-ink-100 px-2.5">
            <Search size={13} className="shrink-0 text-ink-400" />
            <input
              autoFocus
              className="w-full bg-transparent py-2 text-[12px] text-ink-800 outline-none placeholder:text-ink-400"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="جست‌وجوی نام یا IP تجهیز…"
              aria-label="جست‌وجوی تجهیز"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setOpen(false);
                }
              }}
            />
          </div>
          <div className="max-h-52 overflow-y-auto p-1" role="listbox" aria-label="تجهیزات">
            <button
              type="button"
              role="option"
              aria-selected={!value}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-right text-[12px] transition ${
                !value ? 'bg-brand-50 text-accent' : 'text-ink-600 hover:bg-ink-50'
              }`}
              onClick={() => choose('')}
            >
              <span className="min-w-0 flex-1 truncate">بدون تجهیز</span>
              {!value ? <Check size={13} /> : null}
            </button>
            {matches.map((device) => {
              const active = String(device.id) === value;
              return (
                <button
                  key={device.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-right text-[12px] transition ${
                    active ? 'bg-brand-50 text-accent' : 'text-ink-600 hover:bg-ink-50'
                  }`}
                  onClick={() => choose(String(device.id))}
                >
                  <span className="min-w-0 flex-1 truncate">{device.name}</span>
                  <span className="num shrink-0 text-[10.5px] text-ink-400" dir="ltr">
                    {device.ip}
                  </span>
                  {active ? <Check size={13} className="shrink-0" /> : null}
                </button>
              );
            })}
            {!matches.length ? (
              <p className="px-2 py-3 text-center text-[11px] text-ink-400">تجهیزی با این عبارت پیدا نشد.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * فرم ذخیره/ویرایش یک ورود خزانه.
 * در حالت ویرایش، خالی‌بودن رمز یعنی «بدون تغییر»؛ رمز فعلی هرگز برای پرکردن
 * فرم از سرور خوانده نمی‌شود.
 *
 * فیلدهای «نوع دسترسی»، «میزبان» و «پورت» عمداً از فرم حذف شده‌اند تا ثبت
 * رمز ساده بماند؛ دادهٔ قبلی این ستون‌ها هنگام ویرایش دست‌نخورده می‌ماند.
 */
export default function CredentialForm({
  open,
  credential,
  devices,
  suggestedSecret = '',
  onClose,
  onSaved,
}: {
  open: boolean;
  credential: Credential | null;
  devices: Device[];
  suggestedSecret?: string;
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
    const base = stateOf(credential);
    setForm(suggestedSecret ? { ...base, secret: suggestedSecret } : base);
    setShowSecret(Boolean(suggestedSecret));
    setGeneratorOpen(false);
    setError(null);
  }, [open, credential, suggestedSecret]);

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
      setError('عنوان ورود الزامی است.');
      return;
    }
    if (!editing && !form.secret) {
      setError('رمز عبور را وارد کنید یا با تولیدکننده بسازید.');
      return;
    }
    const port = form.port.trim() ? Number(form.port) : null;
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      setError('پورت باید عددی بین ۱ و ۶۵۵۳۵ باشد.');
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
    };
    if (form.secret) payload.secret = form.secret;

    const saved = await run(async () => {
      try {
        const result = editing
          ? await api.updateCredential(credential!.id, payload)
          : await api.createCredential(payload);
        onSaved(result, editing ? 'update' : 'create');
        push(editing ? 'رمز عبور به‌روزرسانی شد.' : 'رمز عبور در خزانه ذخیره شد.', 'success');
        return result;
      } catch (e) {
        const message = e instanceof Error ? e.message : 'ذخیرهٔ رمز ممکن نشد.';
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
      title={editing ? `ویرایش رمز عبور — ${credential?.label}` : 'ذخیرهٔ رمز عبور جدید'}
      subtitle="نام کاربری و رمز در خزانهٔ رمز عبور با AES‑256‑GCM رمزنگاری می‌شوند و رمز فقط با درخواست صریح نمایش داده می‌شود."
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            انصراف
          </button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={busy}>
            <Save size={15} />
            {busy ? 'در حال ذخیره…' : editing ? 'ذخیرهٔ تغییرات' : 'ذخیرهٔ رمز'}
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
              className="field-strong"
              value={form.label}
              maxLength={120}
              onChange={(e) => set('label', e.target.value)}
              placeholder="SSH سوئیچ اصلی"
              autoFocus
            />
          </Field>

          <Field label="نام کاربری">
            <input
              className="field-strong"
              dir="ltr"
              value={form.username}
              maxLength={255}
              onChange={(e) => set('username', e.target.value)}
              placeholder="admin"
              autoComplete="off"
            />
          </Field>

          <Field label="تجهیز مرتبط" hint="اختیاری؛ با جست‌وجو بین تجهیزات انتخاب کنید">
            <DevicePicker devices={devices} value={form.deviceId} onChange={(value) => set('deviceId', value)} />
          </Field>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="label mb-0">
              {editing ? 'رمز جدید (برای تغییر)' : 'رمز عبور'} {!editing ? <span className="text-danger">*</span> : null}
            </span>
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => setGeneratorOpen((value) => !value)}
              aria-expanded={generatorOpen}
            >
              <Wand2 size={13} />
              {generatorOpen ? 'بستن تولیدکننده' : 'تولید رمز قوی'}
            </button>
          </div>
          <div className="flex items-stretch gap-2">
            <input
              className="field-strong flex-1 font-mono"
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
              className="field-strong"
              value={form.tags}
              onChange={(e) => set('tags', e.target.value)}
              placeholder="core ، طبقه۲ ، cisco"
            />
          </Field>
          <Field label="یادداشت" hint="رمزنگاری‌شده ذخیره می‌شود و در جزئیات همان ورود دیده می‌شود">
            <textarea
              className="field-strong min-h-[44px] resize-y"
              value={form.notes}
              maxLength={2000}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="مثلاً: دسترسی فقط از VLAN مدیریت"
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-soft border border-ink-100 bg-ink-50/60 px-3 py-2 text-[11.5px] text-ink-500">
          <span className="inline-flex items-center gap-1.5">
            <KeyRound size={13} className="text-accent" /> ذخیره در خزانهٔ رمز عبور با AES‑256‑GCM
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Server size={13} /> {faDigits(devices.length)} تجهیز برای اتصال در دسترس است
          </span>
        </div>
      </div>
    </Modal>
  );
}
