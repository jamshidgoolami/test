import React, { useEffect, useMemo, useState } from 'react';
import { Check, KeyRound, MapPin, Save, Server, SlidersHorizontal, Tag as TagIcon } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useToast } from '../lib/store';
import { DEVICE_TYPES, PRIORITY_META, faDigits, fmtIsoDate } from '../lib/format';
import JalaliDateInput from '../components/JalaliDateInput';
import { Field, Modal, Tabs, Toggle } from '../components/ui';
import type { Device, Priority } from '../lib/types';

interface FormState {
  name: string;
  ip: string;
  hostname: string;
  device_type: string;
  location: string;
  building: string;
  rack: string;
  latitude: string;
  longitude: string;
  vendor: string;
  model: string;
  serial: string;
  mac_address: string;
  asset_tag: string;
  access_username: string;
  access_password: string;
  clear_access_password: boolean;
  owner: string;
  notes: string;
  installedAt: string;
  groupIds: number[];
  priority: Priority;
  enabled: boolean;
  monitoring_enabled: boolean;
  ping_interval: string;
  timeout_ms: string;
  packet_count: string;
  retries: string;
  latency_threshold: string;
  loss_threshold: string;
  tags: string[];
}

const empty: FormState = {
  name: '',
  ip: '',
  hostname: '',
  device_type: 'سوئیچ',
  location: '',
  building: '',
  rack: '',
  latitude: '',
  longitude: '',
  vendor: '',
  model: '',
  serial: '',
  mac_address: '',
  asset_tag: '',
  access_username: '',
  access_password: '',
  clear_access_password: false,
  owner: '',
  notes: '',
  installedAt: '',
  groupIds: [],
  priority: 'normal',
  enabled: true,
  monitoring_enabled: true,
  ping_interval: '',
  timeout_ms: '',
  packet_count: '',
  retries: '',
  latency_threshold: '',
  loss_threshold: '',
  tags: [],
};

export default function DeviceForm({
  open,
  onClose,
  device,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  device?: Device | null;
  onSaved?: (d: Device) => void;
}) {
  const { meta, refreshMeta, settings } = useApp();
  const { push } = useToast();
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'general' | 'access' | 'monitoring' | 'geo'>('general');

  // فرم فقط هنگام باز شدن پنجره یا تغییر تجهیز مقداردهی می‌شود؛ به‌روزرسانی
  // دوره‌ای جزئیات تجهیز (شیء تازه با همان شناسه) نباید تب فعال و ورودی‌های
  // نیمه‌کارهٔ کاربر را به «اطلاعات عمومی» بازنشانی کند.
  const formKey = open ? String(device?.id ?? 'new') : null;
  const loadedKey = React.useRef<string | null>(null);

  useEffect(() => {
    if (formKey == null) {
      loadedKey.current = null;
      return;
    }
    if (loadedKey.current === formKey) return;
    loadedKey.current = formKey;
    setError(null);
    setTab('general');
    if (device) {
      setForm({
        name: device.name,
        ip: device.ip,
        hostname: device.hostname,
        device_type: device.deviceType,
        location: device.location,
        building: device.building,
        rack: device.rack,
        latitude: device.latitude == null ? '' : String(device.latitude),
        longitude: device.longitude == null ? '' : String(device.longitude),
        vendor: device.vendor,
        model: device.model,
        serial: device.serial,
        mac_address: device.macAddress ?? '',
        asset_tag: device.assetTag ?? '',
        access_username: device.accessUsername ?? '',
        // رمز موجود هرگز به فرم برنمی‌گردد؛ خالی ماندن یعنی «بدون تغییر».
        access_password: '',
        clear_access_password: false,
        owner: device.owner,
        notes: device.notes,
        installedAt: device.installedAt ? fmtIsoDate(device.installedAt, settings?.timezone_offset_minutes ?? 210) : '',
        groupIds: device.groupIds ?? (device.groupId ? [device.groupId] : []),
        priority: device.priority,
        enabled: device.enabled,
        monitoring_enabled: device.monitoringEnabled,
        ping_interval: device.pingInterval == null ? '' : String(device.pingInterval),
        timeout_ms: device.timeoutMs == null ? '' : String(device.timeoutMs),
        packet_count: device.packetCount == null ? '' : String(device.packetCount),
        retries: device.retries == null ? '' : String(device.retries),
        latency_threshold: device.latencyThreshold == null ? '' : String(device.latencyThreshold),
        loss_threshold: device.lossThreshold == null ? '' : String(device.lossThreshold),
        tags: (device.tags || []).map((t) => t.name),
      });
    } else {
      setForm({ ...empty });
    }
  }, [formKey, device, meta?.groups, settings?.timezone_offset_minutes]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  // فهرست انواع تجهیز از تنظیمات می‌آید؛ مقدار فعلی همیشه در فهرست می‌ماند تا
  // تجهیزی که نوعش بعداً از فهرست حذف شده، نوع خود را از دست ندهد.
  const deviceTypeNames = useMemo(() => {
    const names = (meta?.deviceTypes ?? []).map((t) => t.name);
    if (!names.length) return DEVICE_TYPES;
    return names.includes(form.device_type) ? names : [form.device_type, ...names];
  }, [meta?.deviceTypes, form.device_type]);

  const ipValid = useMemo(() => {
    if (!form.ip.trim()) return false;
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(form.ip.trim()) || /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(form.ip.trim());
  }, [form.ip]);

  const submit = async () => {
    // کلیک مکرر نباید دو تجهیز/دو به‌روزرسانی ثبت کند
    if (saving) return;
    setError(null);
    if (!form.name.trim()) return setError('نام تجهیز را وارد کنید');
    if (!ipValid) return setError('آدرس IP یا نام هاست معتبر نیست');
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      ip: form.ip.trim(),
      hostname: form.hostname.trim(),
      device_type: form.device_type,
      location: form.location.trim(),
      building: form.building.trim(),
      rack: form.rack.trim(),
      latitude: form.latitude === '' ? null : Number(form.latitude),
      longitude: form.longitude === '' ? null : Number(form.longitude),
      vendor: form.vendor.trim(),
      model: form.model.trim(),
      serial: form.serial.trim(),
      mac_address: form.mac_address.trim(),
      asset_tag: form.asset_tag.trim(),
      access_username: form.access_username.trim(),
      owner: form.owner.trim(),
      notes: form.notes.trim(),
      installed_at: form.installedAt || null,
      // هر تجهیز فقط عضو یک گروه است؛ فهرست خالی یعنی «بدون گروه».
      group_ids: form.groupIds.slice(0, 1),
      priority: form.priority,
      enabled: form.enabled ? 1 : 0,
      monitoring_enabled: form.monitoring_enabled ? 1 : 0,
      ping_interval: num(form.ping_interval),
      timeout_ms: num(form.timeout_ms),
      packet_count: num(form.packet_count),
      retries: num(form.retries),
      latency_threshold: num(form.latency_threshold),
      loss_threshold: num(form.loss_threshold),
      tagNames: form.tags,
    };
    // رمز خالی یعنی «رمز فعلی را نگه دار»؛ برای حذف، گزینهٔ صریح حذف ارسال می‌شود.
    if (form.access_password) payload.access_password = form.access_password;
    if (form.clear_access_password) payload.clear_access_password = true;
    // MAC اختیاری است؛ اگر وارد شد باید ۱۲ رقم هگز باشد (با یا بدون جداکننده).
    if (form.mac_address.trim() && !/^[0-9a-f]{12}$/i.test(form.mac_address.replace(/[\s:.-]/g, ''))) {
      return setError('آدرس MAC نامعتبر است (مثال: 00:1A:2B:3C:4D:5E)');
    }
    if (payload.latitude != null && (Number.isNaN(payload.latitude) || Math.abs(Number(payload.latitude)) > 90)) return setError('عرض جغرافیایی نامعتبر است');
    if (payload.longitude != null && (Number.isNaN(payload.longitude) || Math.abs(Number(payload.longitude)) > 180)) return setError('طول جغرافیایی نامعتبر است');

    setSaving(true);
    try {
      const saved = device ? await api.updateDevice(device.id, payload) : await api.createDevice(payload as never);
      push(device ? 'تغییرات تجهیز ذخیره شد' : 'تجهیز جدید افزوده شد', 'success');
      await refreshMeta();
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { key: 'general' as const, label: 'اطلاعات عمومی', icon: <Server size={14} /> },
    { key: 'access' as const, label: 'دسترسی تجهیز', icon: <KeyRound size={14} /> },
    { key: 'monitoring' as const, label: 'تنظیمات پایش', icon: <SlidersHorizontal size={14} /> },
    { key: 'geo' as const, label: 'موقعیت و تگ', icon: <MapPin size={14} /> },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={device ? `ویرایش تجهیز — ${device.name}` : 'افزودن تجهیز جدید'}
      subtitle="اطلاعات تجهیز را وارد کنید. فیلدهای ستاره‌دار الزامی هستند."
      footer={
        <>
          {error ? <p className="me-auto text-xs text-danger">{error}</p> : null}
          <button type="button" className="btn-ghost" onClick={onClose}>
            انصراف
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={saving}>
            <Save size={15} />
            {saving ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </>
      }
    >
      <Tabs
        tabs={tabs.map((item) => ({ value: item.key, label: item.label, icon: item.icon }))}
        value={tab}
        onChange={setTab}
        size="sm"
        className="mb-4 w-full"
      />

      {tab === 'general' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <p className="sm:col-span-2 text-[12px] font-semibold text-ink-500">هویت و اتصال</p>
          <Field label="نام تجهیز" required>
            <input className="field" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="مثلاً سوئیچ دسترسی طبقه ۳" />
          </Field>
          <Field label="آدرس IP" required error={form.ip && !ipValid ? 'آدرس IP نامعتبر است' : undefined}>
            <input dir="ltr" className="field num" value={form.ip} onChange={(e) => set('ip', e.target.value)} placeholder="192.168.1.10" />
          </Field>
          <Field label="نام هاست">
            <input dir="ltr" className="field num" value={form.hostname} onChange={(e) => set('hostname', e.target.value)} placeholder="sw-floor3.local" />
          </Field>
          <Field label="نوع تجهیز" hint="فهرست از تنظیمات ← انواع تجهیزات مدیریت می‌شود">
            <select className="field" value={form.device_type} onChange={(e) => set('device_type', e.target.value)}>
              {deviceTypeNames.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="عضویت در گروه" className="sm:col-span-2" hint="هر تجهیز فقط عضو یک گروه می‌تواند باشد؛ فیلتر و گزارش گروه از همین عضویت استفاده می‌کند.">
            <div className="flex max-h-32 flex-wrap gap-2 overflow-auto rounded-soft border border-ink-200 bg-surface/80 p-2.5">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill border border-ink-200 px-2.5 py-1 text-[11px] text-ink-600 hover:border-brand-200">
                <input
                  type="radio"
                  name="device-group"
                  className="accent-brand-600"
                  checked={form.groupIds.length === 0}
                  onChange={() => set('groupIds', [])}
                />
                بدون گروه
              </label>
              {(meta?.groups ?? []).map((g) => (
                <label key={g.id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill border border-ink-200 px-2.5 py-1 text-[11px] text-ink-600 hover:border-brand-200">
                  <input
                    type="radio"
                    name="device-group"
                    className="accent-brand-600"
                    checked={form.groupIds[0] === g.id}
                    onChange={() => set('groupIds', [g.id])}
                  />
                  <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />
                  {g.name}
                  {g.device_count != null ? <span className="num text-[10px] text-ink-400">({faDigits(g.device_count)})</span> : null}
                </label>
              ))}
            </div>
          </Field>
          <p className="sm:col-span-2 mt-1 text-[12px] font-semibold text-ink-500">موقعیت و نگهداری</p>
          <Field label="تاریخ نصب" hint="شمسی — در پایگاه‌داده به‌صورت استاندارد ذخیره می‌شود">
            <JalaliDateInput value={form.installedAt} onChange={(iso) => set('installedAt', iso)} />
          </Field>
          <Field label="محل استقرار">
            <input className="field" value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="تهران — ساختمان اداری" />
          </Field>
          <Field label="ساختمان">
            <input className="field" value={form.building} onChange={(e) => set('building', e.target.value)} />
          </Field>
          <Field label="رک / موقعیت فیزیکی">
            <input className="field" value={form.rack} onChange={(e) => set('rack', e.target.value)} placeholder="R12-U4" />
          </Field>
          <details className="sm:col-span-2 rounded-soft border border-ink-100 bg-ink-50/40 p-3">
            <summary className="cursor-pointer text-[12.5px] font-medium text-ink-600">
              مشخصات فنی و دارایی (اختیاری)
            </summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="سازنده">
                <input className="field" value={form.vendor} onChange={(e) => set('vendor', e.target.value)} placeholder="Cisco" />
              </Field>
              <Field label="مدل">
                <input className="field" value={form.model} onChange={(e) => set('model', e.target.value)} />
              </Field>
              <Field label="شماره سریال">
                <input dir="ltr" className="field num" value={form.serial} onChange={(e) => set('serial', e.target.value)} />
              </Field>
              <Field label="آدرس MAC" hint="مثال: 00:1A:2B:3C:4D:5E">
                <input dir="ltr" className="field num" value={form.mac_address} onChange={(e) => set('mac_address', e.target.value)} placeholder="00:1A:2B:3C:4D:5E" />
              </Field>
              <Field label="پلاک اموال" hint="شناسهٔ ثبتی دارایی در انبار/اموال">
                <input dir="ltr" className="field num" value={form.asset_tag} onChange={(e) => set('asset_tag', e.target.value)} placeholder="AST-10045" />
              </Field>
              <Field label="مسئول / تیم">
                <input className="field" value={form.owner} onChange={(e) => set('owner', e.target.value)} placeholder="تیم شبکه" />
              </Field>
              <Field label="اولویت پایش">
                <select className="field" value={form.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
                  {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_META[p].label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </details>
          <Field label="توضیحات" className="sm:col-span-2">
            <textarea className="field min-h-[76px]" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2 rounded-soft border border-ink-100 bg-surface/70 p-3">
            <p className="sm:col-span-2 text-[12px] font-semibold text-ink-500">وضعیت پایش</p>
            <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="تجهیز فعال است" hint="تجهیزات غیرفعال در گزارش‌ها و داشبورد لحاظ نمی‌شوند" />
            <Toggle
              checked={form.monitoring_enabled}
              onChange={(v) => set('monitoring_enabled', v)}
              label="پایش خودکار فعال باشد"
              hint="در صورت غیرفعال بودن، موتور مانیتورینگ برای این تجهیز Ping ارسال نمی‌کند"
            />
          </div>
        </div>
      ) : null}

      {tab === 'access' ? (
        <div className="space-y-4">
          <p className="rounded-soft border border-brand-100 bg-brand-50/60 p-3 text-[11.5px] leading-relaxed text-accent">
            نام کاربری و رمز عبور با AES-256-GCM رمزنگاری می‌شوند و در فهرست تجهیزات، خروجی فایل یا لاگ نمایش داده نمی‌شوند.
            رمز فعلی برای ویرایش خوانده نمی‌شود؛ برای تغییر، رمز تازه را وارد کنید و برای حذف، گزینهٔ حذف رمز را بزنید.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نام کاربری" hint="در پایگاه‌داده رمزنگاری‌شده ذخیره می‌شود">
              <input
                dir="ltr"
                className="field num"
                autoComplete="off"
                value={form.access_username}
                onChange={(e) => set('access_username', e.target.value)}
                placeholder="admin"
              />
            </Field>
            <Field
              label={device?.hasAccessPassword ? 'رمز عبور جدید' : 'رمز عبور'}
              hint={device?.hasAccessPassword ? 'خالی بماند: رمز فعلی حفظ می‌شود' : 'اختیاری — بعداً هم قابل ثبت است'}
            >
              <input
                dir="ltr"
                type="password"
                className="field num"
                autoComplete="new-password"
                value={form.access_password}
                onChange={(e) => {
                  set('access_password', e.target.value);
                  if (e.target.value) set('clear_access_password', false);
                }}
                placeholder={device?.hasAccessPassword ? '••••••••' : 'رمز عبور تجهیز'}
              />
            </Field>
          </div>
          {device?.hasAccessPassword ? (
            <label className="flex cursor-pointer items-center gap-2 rounded-soft border border-ink-200 bg-surface/80 px-3 py-2 text-[12px] text-ink-600">
              <input
                type="checkbox"
                className="accent-red-600"
                checked={form.clear_access_password}
                onChange={(e) => {
                  set('clear_access_password', e.target.checked);
                  if (e.target.checked) set('access_password', '');
                }}
              />
              رمز عبور ذخیره‌شده حذف شود
            </label>
          ) : null}
        </div>
      ) : null}

      {tab === 'monitoring' ? (
        <div className="space-y-4">
          <p className="rounded-soft border border-brand-100 bg-brand-50/60 p-3 text-[11.5px] leading-relaxed text-accent">
            در صورت خالی گذاشتن هر فیلد، مقدار عمومی تنظیمات برنامه استفاده می‌شود. مقادیر فعلی عمومی: بازه{' '}
            <span className="num font-semibold">{settings?.ping_interval ?? 30}</span> ثانیه، زمان انتظار{' '}
            <span className="num font-semibold">{settings?.timeout_ms ?? 1200}</span> میلی‌ثانیه، Packet{' '}
            <span className="num font-semibold">{settings?.packet_count ?? 3}</span>، تلاش مجدد{' '}
            <span className="num font-semibold">{settings?.retries ?? 1}</span>.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="بازه ارسال Ping (ثانیه)" hint="اولویت در موتور مانیتورینگ">
              <input type="number" min={5} dir="ltr" className="field num" value={form.ping_interval} onChange={(e) => set('ping_interval', e.target.value)} />
            </Field>
            <Field label="زمان انتظار پاسخ (ms)">
              <input type="number" min={100} dir="ltr" className="field num" value={form.timeout_ms} onChange={(e) => set('timeout_ms', e.target.value)} />
            </Field>
            <Field label="تعداد Packet در هر بررسی">
              <input type="number" min={1} max={10} dir="ltr" className="field num" value={form.packet_count} onChange={(e) => set('packet_count', e.target.value)} />
            </Field>
            <Field label="تعداد تلاش مجدد">
              <input type="number" min={0} max={5} dir="ltr" className="field num" value={form.retries} onChange={(e) => set('retries', e.target.value)} />
            </Field>
            <Field label="آستانه مجاز تأخیر (ms)">
              <input type="number" min={1} dir="ltr" className="field num" value={form.latency_threshold} onChange={(e) => set('latency_threshold', e.target.value)} />
            </Field>
            <Field label="آستانه مجاز افت بسته (٪)">
              <input type="number" min={0} max={100} dir="ltr" className="field num" value={form.loss_threshold} onChange={(e) => set('loss_threshold', e.target.value)} />
            </Field>
          </div>
        </div>
      ) : null}

      {tab === 'geo' ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="عرض جغرافیایی (Latitude)" hint="بین ۹۰- و ۹۰">
              <input dir="ltr" className="field num" value={form.latitude} onChange={(e) => set('latitude', e.target.value)} placeholder="35.6892" />
            </Field>
            <Field label="طول جغرافیایی (Longitude)" hint="بین ۱۸۰- و ۱۸۰">
              <input dir="ltr" className="field num" value={form.longitude} onChange={(e) => set('longitude', e.target.value)} placeholder="51.3890" />
            </Field>
          </div>
          <Field label="تگ‌ها" hint="با Enter یا کاما جدا کنید — تگ‌های جدید به‌صورت خودکار ساخته می‌شوند">
            <TagPicker value={form.tags} onChange={(tags) => set('tags', tags)} suggestions={(meta?.tags ?? []).map((t) => t.name)} />
          </Field>
        </div>
      ) : null}
    </Modal>
  );
}

function TagPicker({
  value,
  onChange,
  suggestions,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions: string[];
}) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw
      .split(/[,،]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...value, ...parts])]);
    setDraft('');
  };
  return (
    <div className="rounded-soft border border-ink-200 bg-surface/90 p-2.5">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {value.length === 0 ? <span className="text-[11px] text-ink-400">تگی انتخاب نشده است</span> : null}
        {value.map((t) => (
          <span key={t} className="chip border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] text-accent">
            <TagIcon size={11} />
            {t}
            <button type="button" className="text-brand-400 hover:text-danger" onClick={() => onChange(value.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="field !py-1.5 text-[12px]"
          value={draft}
          list="tag-suggestions"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            }
          }}
          placeholder="نام تگ…"
        />
        <datalist id="tag-suggestions">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <button type="button" className="btn-soft btn-xs" onClick={() => add(draft)}>
          <Check size={13} />
          افزودن
        </button>
      </div>
    </div>
  );
}
