import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Save, ServerCog, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import type { ServerMutationResult, ServerSummary } from '../../lib/types';
import { Field, Modal, Toggle } from '../../components/ui';

type FormState = {
  name: string;
  osHostname: string;
  osIp: string;
  location: string;
  rack: string;
  vendor: string;
  model: string;
  serial: string;
  bmcIp: string;
  bmcProtocol: 'redfish' | 'ipmi' | 'demo' | 'none';
  bmcUsername: string;
  bmcPassword: string;
  bmcVerifyTls: boolean;
  bmcCaPem: string;
  clearCa: boolean;
  bmcSystemId: string;
  bmcChassisId: string;
  pollIntervalSec: number;
  enabled: boolean;
  alertEnabled: boolean;
  alertCpuPct: number;
  alertMemPct: number;
  alertTempC: number;
};

function initial(server?: ServerSummary | null): FormState {
  return {
    name: server?.name ?? '',
    osHostname: server?.osHostname ?? '',
    osIp: server?.osIp ?? '',
    location: server?.location ?? '',
    rack: server?.rack ?? '',
    vendor: server?.vendor ?? 'Supermicro',
    model: server?.model ?? '',
    serial: server?.serial ?? '',
    bmcIp: server?.bmcIp ?? '',
    bmcProtocol: server?.bmcProtocol ?? 'redfish',
    bmcUsername: server?.bmcUsername ?? '',
    bmcPassword: '',
    bmcVerifyTls: server?.bmcVerifyTls ?? true,
    bmcCaPem: '',
    clearCa: false,
    bmcSystemId: server?.bmcSystemId ?? '1',
    bmcChassisId: server?.bmcChassisId ?? '1',
    pollIntervalSec: server?.pollIntervalSec ?? 60,
    enabled: server?.enabled ?? true,
    alertEnabled: server?.alertEnabled ?? true,
    alertCpuPct: server?.alertCpuPct ?? 90,
    alertMemPct: server?.alertMemPct ?? 90,
    alertTempC: server?.alertTempC ?? 80,
  };
}

export default function ServerForm({
  open,
  server,
  onClose,
  onSaved,
}: {
  open: boolean;
  server?: ServerSummary | null;
  onClose: () => void;
  onSaved: (result: ServerMutationResult) => void;
}) {
  const [form, setForm] = useState<FormState>(() => initial(server));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const editing = !!server;
  const serverRef = useRef(server);
  serverRef.current = server;

  // فقط با بازشدن پنجره یا تغییر سرور ریست می‌شود. صفحهٔ جزئیات هر ۲۰ ثانیه
  // شیء تازه می‌گیرد؛ ریست‌کردن با هر refresh باعث پاک‌شدن ورودی کاربر می‌شد.
  useEffect(() => {
    if (!open) return;
    setForm(initial(serverRef.current));
    setError('');
    setAdvanced(false);
  }, [open, server?.id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (!form.name.trim()) {
      setError('نام سرور الزامی است.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        osHostname: form.osHostname,
        osIp: form.osIp,
        location: form.location,
        rack: form.rack,
        vendor: form.vendor,
        model: form.model,
        serial: form.serial,
        bmcIp: form.bmcIp,
        bmcProtocol: form.bmcProtocol,
        bmcUsername: form.bmcUsername,
        bmcVerifyTls: form.bmcVerifyTls,
        bmcSystemId: form.bmcSystemId,
        bmcChassisId: form.bmcChassisId,
        pollIntervalSec: Number(form.pollIntervalSec) || 60,
        enabled: form.enabled,
        alertEnabled: form.alertEnabled,
        alertCpuPct: Number(form.alertCpuPct) || 90,
        alertMemPct: Number(form.alertMemPct) || 90,
        alertTempC: form.alertTempC === 0 ? 0 : Number(form.alertTempC) || 80,
      };
      if (form.bmcPassword) body.bmcPassword = form.bmcPassword;
      if (form.clearCa) body.bmcCaPem = '';
      else if (form.bmcCaPem.trim()) body.bmcCaPem = form.bmcCaPem;
      const result = editing && server ? await api.updateServer(server.id, body) : await api.createServer(body);
      onSaved(result);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ذخیرهٔ سرور انجام نشد.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'ویرایش سرور' : 'افزودن سرور'}
      subtitle="Agent ویندوز متریک‌های سیستم‌عامل و BMC دما/سلامت سخت‌افزار را تأمین می‌کند."
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            انصراف
          </button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={saving}>
            <Save size={15} />
            {saving ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {error ? (
          <p className="rounded-soft border border-red-100 bg-red-50 px-3 py-2 text-xs text-danger" role="alert">
            {error}
          </p>
        ) : null}

        <section className="space-y-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-600">
            <ServerCog size={14} /> هویت سرور
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="نام سرور" required>
              <input className="field" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="SRV-DB-01" />
            </Field>
            <Field label="Hostname ویندوز">
              <input className="field" dir="ltr" value={form.osHostname} onChange={(e) => set('osHostname', e.target.value)} placeholder="srv-db-01" />
            </Field>
            <Field label="IP سرور (برای مستندسازی/Agent)" hint="Agent خودش از سرور به NetWatch متصل می‌شود؛ این IP فقط برای نمایش و عیب‌یابی است.">
              <input className="field" dir="ltr" value={form.osIp} onChange={(e) => set('osIp', e.target.value)} placeholder="10.0.0.20" />
            </Field>
            <Field label="سازنده">
              <input className="field" value={form.vendor} onChange={(e) => set('vendor', e.target.value)} placeholder="Supermicro" />
            </Field>
            <Field label="مدل">
              <input className="field" dir="ltr" value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="SYS-620U-TNR" />
            </Field>
            <Field label="شماره سریال">
              <input className="field" dir="ltr" value={form.serial} onChange={(e) => set('serial', e.target.value)} />
            </Field>
            <Field label="محل">
              <input className="field" value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="اتاق سرور اصلی" />
            </Field>
            <Field label="رک / موقعیت">
              <input className="field" value={form.rack} onChange={(e) => set('rack', e.target.value)} placeholder="Rack A / U12" />
            </Field>
          </div>
          <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="پایش این سرور فعال باشد" />
        </section>

        <section className="space-y-3 rounded-soft border border-amber-100 bg-amber-50/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-600">
            <AlertTriangle size={14} className="text-warning" /> آستانه‌های هشدار و اژیر
          </p>
          <p className="text-[11px] leading-relaxed text-ink-500">
            وقتی هر مقدار از آستانهٔ تعیین‌شده عبور کند، هشدار به همهٔ کلاینت‌های متصل فرستاده می‌شود و در صورت فعال بودن صدا، اژیر پخش می‌شود. با بازگشت مقدار به محدودهٔ مجاز، هشدار خودکار رفع می‌شود.
          </p>
          <Toggle
            checked={form.alertEnabled}
            onChange={(v) => set('alertEnabled', v)}
            label="هشدار آستانه‌ای این سرور فعال باشد"
            hint="برای خاموش کردن کامل اعلان‌ها و اژیر همین سرور، این گزینه را بردارید."
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="آستانهٔ CPU (٪)" hint="پیش‌فرض ۹۰">
              <input
                className="field num"
                dir="ltr"
                type="number"
                min={1}
                max={100}
                value={form.alertCpuPct}
                onChange={(e) => set('alertCpuPct', Number(e.target.value))}
              />
            </Field>
            <Field label="آستانهٔ RAM (٪)" hint="پیش‌فرض ۹۰">
              <input
                className="field num"
                dir="ltr"
                type="number"
                min={1}
                max={100}
                value={form.alertMemPct}
                onChange={(e) => set('alertMemPct', Number(e.target.value))}
              />
            </Field>
            <Field label="آستانهٔ دما (°C)" hint="پیش‌فرض ۸۰">
              <input
                className="field num"
                dir="ltr"
                type="number"
                min={0}
                max={150}
                value={form.alertTempC}
                onChange={(e) => set('alertTempC', Number(e.target.value))}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-3 rounded-soft border border-ink-100 bg-ink-50/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-600">
            <ShieldCheck size={14} /> BMC / IPMI
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="آدرس BMC" hint="IP یا نام میزبان پورت مدیریت Supermicro">
              <input className="field" dir="ltr" value={form.bmcIp} onChange={(e) => set('bmcIp', e.target.value)} placeholder="10.0.0.120" />
            </Field>
            <Field label="پروتکل">
              <select className="field" value={form.bmcProtocol} onChange={(e) => set('bmcProtocol', e.target.value as FormState['bmcProtocol'])}>
                <option value="redfish">Redfish (پیشنهادی)</option>
                <option value="ipmi">IPMI 2.0 (BMC قدیمی، نیازمند ipmitool)</option>
                <option value="demo">نمایشی (بدون سخت‌افزار)</option>
                <option value="none">بدون BMC</option>
              </select>
            </Field>
            <Field label="نام کاربری BMC">
              <input className="field" dir="ltr" autoComplete="username" value={form.bmcUsername} onChange={(e) => set('bmcUsername', e.target.value)} />
            </Field>
            <Field
              label="رمز BMC"
              hint={editing && server?.hasBmcPassword ? 'برای حفظ رمز فعلی خالی بگذارید.' : 'رمز فقط رمزنگاری‌شده ذخیره می‌شود.'}
            >
              <input
                className="field"
                dir="ltr"
                type="password"
                autoComplete="new-password"
                value={form.bmcPassword}
                onChange={(e) => set('bmcPassword', e.target.value)}
              />
            </Field>
            <Field label="فاصلهٔ Polling (ثانیه)" hint="حداقل ۳۰ ثانیه؛ BMC تجهیزات ضعیفی است.">
              <input
                className="field num"
                dir="ltr"
                type="number"
                min={30}
                max={3600}
                value={form.pollIntervalSec}
                onChange={(e) => set('pollIntervalSec', Number(e.target.value))}
              />
            </Field>
            <div className="flex items-end pb-1">
              <Toggle
                checked={form.bmcVerifyTls}
                onChange={(v) => set('bmcVerifyTls', v)}
                label="اعتبارسنجی گواهی TLS"
                hint="برای BMC با گواهی self-signed، یا CA را وارد کنید یا این گزینه را خاموش کنید."
              />
            </div>
          </div>
          <button type="button" className="text-[11px] text-accent" onClick={() => setAdvanced((v) => !v)}>
            {advanced ? 'بستن تنظیمات پیشرفته' : 'تنظیمات پیشرفتهٔ Redfish و TLS'}
          </button>
          {advanced ? (
            <div className="grid gap-3 border-t border-ink-100 pt-3 sm:grid-cols-2">
              <Field label="System ID" hint="پیش‌فرض 1">
                <input className="field" dir="ltr" value={form.bmcSystemId} onChange={(e) => set('bmcSystemId', e.target.value)} />
              </Field>
              <Field label="Chassis ID" hint="پیش‌فرض 1">
                <input className="field" dir="ltr" value={form.bmcChassisId} onChange={(e) => set('bmcChassisId', e.target.value)} />
              </Field>
              <Field label="CA Certificate (PEM)" className="sm:col-span-2" hint="برای BMC با گواهی داخلی؛ محتوای فایل ca.crt را بچسبانید.">
                <textarea
                  className="field min-h-24 font-mono text-[11px]"
                  dir="ltr"
                  value={form.bmcCaPem}
                  onChange={(e) => set('bmcCaPem', e.target.value)}
                  placeholder="-----BEGIN CERTIFICATE-----"
                />
              </Field>
              {editing && server?.bmcHasCa ? (
                <label className="flex items-center gap-2 text-xs text-ink-600 sm:col-span-2">
                  <input type="checkbox" checked={form.clearCa} onChange={(e) => set('clearCa', e.target.checked)} />
                  حذف CA ذخیره‌شده
                </label>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </Modal>
  );
}
