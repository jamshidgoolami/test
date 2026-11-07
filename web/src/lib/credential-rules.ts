/**
 * NetWatch — قواعد مشترک مخزن اعتبارنامه (سمت کلاینت)
 * ----------------------------------------------------------------
 * • فهرست نوع‌ها و برچسب‌ها یک منبع واحد برای فرم، فیلتر و جدول است.
 * • «برآورد» قدرت رمز فقط برای بازخورد فوری هنگام تایپ است؛ امتیاز ذخیره‌شده و
 *   ملاک هشدار، همان است که سرور در `credential-strength.js` حساب می‌کند.
 * • هیچ رمزی در این ماژول ذخیره یا لاگ نمی‌شود.
 */
import type { CredentialAssessment, CredentialKind, PasswordGeneratorOptions } from './types';

export const CREDENTIAL_KINDS: { id: CredentialKind; label: string; hint: string }[] = [
  { id: 'ssh', label: 'SSH', hint: 'دسترسی خط فرمان تجهیزات' },
  { id: 'https', label: 'پنل وب (HTTPS)', hint: 'مدیریت وب سوئیچ/روتر/سرور' },
  { id: 'telnet', label: 'Telnet', hint: 'تجهیزات قدیمی' },
  { id: 'snmp', label: 'SNMP', hint: 'Community یا کاربر SNMPv3' },
  { id: 'console', label: 'کنسول / سریال', hint: 'دسترسی محلی یا سرور کنسول' },
  { id: 'wifi', label: 'Wi‑Fi', hint: 'رمز شبکهٔ بی‌سیم یا کنترلر' },
  { id: 'api', label: 'API / توکن', hint: 'کلید یا توکن سرویس' },
  { id: 'database', label: 'پایگاه‌داده', hint: 'کاربر پایگاه‌دادهٔ تجهیز' },
  { id: 'mail', label: 'ایمیل', hint: 'حساب ارسال هشدار' },
  { id: 'other', label: 'سایر', hint: 'هر دسترسی دیگر' },
];

const KIND_MAP = new Map(CREDENTIAL_KINDS.map((item) => [item.id, item.label]));

export function kindLabel(kind: string): string {
  return KIND_MAP.get(kind as CredentialKind) ?? 'سایر';
}

/** رنگ و برچسب هر سطح قدرت؛ هم‌خوان با ۰..۴ سرور. */
export const STRENGTH_META = [
  { label: 'بسیار ضعیف', bar: '#dc2626', text: 'text-danger', chip: 'red' as const },
  { label: 'ضعیف', bar: '#f97316', text: 'text-orange-600', chip: 'sun' as const },
  { label: 'متوسط', bar: '#eab308', text: 'text-warning', chip: 'sun' as const },
  { label: 'قوی', bar: '#16a34a', text: 'text-success', chip: 'emerald' as const },
  { label: 'بسیار قوی', bar: '#0d9488', text: 'text-teal-600', chip: 'emerald' as const },
];

export function strengthMeta(score: number) {
  return STRENGTH_META[Math.max(0, Math.min(4, Number(score) || 0))];
}

const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'pass',
  '123456', '1234567', '12345678', '123456789', '1234567890', '111111', '000000',
  'abc123', 'abcd1234', 'qwerty', 'qwerty123', 'qwertyuiop', 'admin', 'admin123',
  'administrator', 'root', 'toor', 'default', 'guest', 'letmein', 'welcome',
  'welcome123', 'changeme', 'changeme123', 'cisco', 'cisco123', 'ubnt',
  'mikrotik', 'netgear', 'dlink', 'tp-link', 'public', 'private', 'snmp',
  'community', 'enable', 'support', 'service', 'secret', 'test', 'test123',
  'netwatch', 'netwatch123',
]);

const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function poolSize(value: string) {
  let pool = 0;
  if (/[a-z]/.test(value)) pool += 26;
  if (/[A-Z]/.test(value)) pool += 26;
  if (/\d/.test(value)) pool += 10;
  if (/[^A-Za-z0-9]/.test(value)) pool += 33;
  return pool;
}

function normalize(value: string) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s._-]+/g, '');
}

/**
 * برآورد قدرت برای بازخورد زندهٔ فرم (بدون رفت‌وبرگشت شبکه).
 * امتیاز نهایی که ذخیره می‌شود را سرور تعیین می‌کند.
 */
export function assessSecretPreview(
  secret: string,
  context: { label?: string; username?: string; host?: string } = {}
): CredentialAssessment {
  const value = String(secret ?? '');
  if (!value) return { score: 0, label: 'بسیار ضعیف', weak: true, reasons: [], entropyBits: 0 };

  const pool = Math.max(poolSize(value), 2);
  const entropyBits = Math.round(value.length * Math.log2(pool) * 10) / 10;
  let score = entropyBits < 26 ? 0 : entropyBits < 42 ? 1 : entropyBits < 62 ? 2 : entropyBits < 84 ? 3 : 4;
  const reasons: string[] = [];

  if (value.length < 8) {
    score = Math.min(score, 1);
    reasons.push('کوتاه‌تر از ۸ نویسه است؛ حداقل ۱۲ نویسه توصیه می‌شود.');
  } else if (value.length < 12) {
    score = Math.min(score, 2);
    reasons.push('کوتاه‌تر از ۱۲ نویسه است.');
  }

  const lower = value.toLowerCase();
  if (COMMON.has(lower)) {
    score = 0;
    reasons.push('از رمزهای پیش‌فرض و بسیار رایج تجهیزات است.');
  }
  if (SEQUENCES.some((seq) => (seq + seq).includes(lower))) {
    score = Math.min(score, 1);
    reasons.push('دنبالهٔ سادهٔ صفحه‌کلید یا الفبا است.');
  }
  if (/^(.)\1+$/.test(value)) {
    score = 0;
    reasons.push('تکرار یک نویسه است.');
  }
  if (pool < 36 && value.length < 20) {
    reasons.push('تنوع نویسه‌ها کم است (حروف کوچک/بزرگ، رقم و نماد را ترکیب کنید).');
  }

  const label = normalize(context.label ?? '');
  const username = normalize(context.username ?? '');
  const host = normalize(context.host ?? '');
  const plain = normalize(value);
  if (username.length >= 3) {
    const remainder = Math.abs(plain.length - username.length);
    const wraps = plain.startsWith(username) || plain.endsWith(username);
    if (plain === username || (wraps && remainder <= 6)) {
      score = Math.min(score, 1);
      reasons.push('مشابه نام کاربری است.');
    }
  }
  if (label.length >= 5 && plain.includes(label)) {
    score = Math.min(score, 1);
    reasons.push('نام یا عنوان تجهیز را در خود دارد.');
  }
  if (host.length >= 5 && plain.includes(host)) {
    score = Math.min(score, 1);
    reasons.push('آدرس یا نام میزبان را در خود دارد.');
  }

  const finalScore = Math.max(0, Math.min(4, score));
  return {
    score: finalScore,
    label: STRENGTH_META[finalScore].label,
    weak: finalScore <= 1,
    reasons: reasons.slice(0, 3),
    entropyBits,
  };
}

/** گزینهٔ پیش‌فرض تولید رمز: قوی، خوانا و بدون نویسهٔ مبهم. */
export const GENERATOR_DEFAULTS: PasswordGeneratorOptions = {
  mode: 'random',
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: true,
  requireEach: true,
  words: 6,
  separator: '-',
  addNumber: true,
  capitalize: false,
};

/** ورودی برچسب‌ها (رشتهٔ جداشده با ویرگول) → آرایهٔ تمیز و بدون تکرار */
export function splitTags(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(value ?? '').split(/[،,]/)) {
    const tag = raw.trim().slice(0, 32);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * قالب ورودی کنسول برای نمایش هدف اتصال: `user@host:port`
 * (فقط نمایشی است و در پایگاه‌داده ذخیره نمی‌شود).
 */
export function credentialTarget(credential: { username: string; host: string; port: number | null }): string {
  const host = credential.host ? `${credential.host}${credential.port ? `:${credential.port}` : ''}` : '';
  if (credential.username && host) return `${credential.username}@${host}`;
  return credential.username || host || '—';
}
