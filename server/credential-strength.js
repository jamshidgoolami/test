/**
 * NetWatch — سنجش قدرت رمز تجهیزات
 * ----------------------------------------------------------------
 * برخلاف رمز کاربران (که با Argon2id هش می‌شود و فقط رد/قبول دارد)، رمز
 * تجهیزات اغلب روی خود دستگاه تنظیم می‌شود و گاهی طول کوتاه اجباری دارد؛
 * بنابراین این‌جا «هشدار» می‌دهیم، نه «ممانعت».
 *
 * امتیاز ۰..۴ ذخیره می‌شود تا فهرست و فیلتر «رمزهای ضعیف» بدون رمزگشایی
 * همهٔ ردیف‌ها کار کند. دلایل ضعف متنی و غیرحساس‌اند و رمز را بازگو نمی‌کنند.
 */
export const STRENGTH_LABELS = Object.freeze(['بسیار ضعیف', 'ضعیف', 'متوسط', 'قوی', 'بسیار قوی']);

/** فهرست کوتاه رمزهای پرتکرار در تجهیزات شبکه */
const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'pass',
  '123456', '1234567', '12345678', '123456789', '1234567890', '123456789012',
  '111111', '000000', 'abc123', 'abcd1234', 'qwerty', 'qwerty123', 'qwertyuiop',
  'admin', 'admin123', 'administrator', 'root', 'toor', 'default', 'guest',
  'letmein', 'welcome', 'welcome1', 'welcome123', 'changeme', 'changeme123',
  'cisco', 'cisco123', 'ubnt', 'mikrotik', 'netgear', 'dlink', 'tp-link',
  'public', 'private', 'snmp', 'community', 'enable', 'support', 'service',
  'iloveyou', 'monkey', 'dragon', 'master', 'secret', 'test', 'test123',
  'netwatch', 'netwatch123', 'user', 'user123', 'login', 'system',
]);

const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function poolSize(value) {
  let pool = 0;
  if (/[a-z]/.test(value)) pool += 26;
  if (/[A-Z]/.test(value)) pool += 26;
  if (/\d/.test(value)) pool += 10;
  if (/[^A-Za-z0-9]/.test(value)) pool += 33;
  return pool;
}

function isSequence(value) {
  if (value.length < 4) return false;
  const lower = value.toLowerCase();
  return SEQUENCES.some((seq) => {
    const doubled = seq + seq;
    return doubled.includes(lower) || [...doubled].reverse().join('').includes(lower);
  });
}

function normalizeForCompare(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s._-]+/g, '');
}

/**
 * ارزیابی رمز.
 * @param {string} secret
 * @param {{label?: string, username?: string, host?: string}} context
 * @returns {{score: 0|1|2|3|4, label: string, weak: boolean, reasons: string[], entropyBits: number}}
 */
export function assessSecret(secret, context = {}) {
  const value = String(secret ?? '');
  const reasons = [];
  if (!value) {
    return { score: 0, label: STRENGTH_LABELS[0], weak: true, reasons: ['رمزی ثبت نشده است.'], entropyBits: 0 };
  }

  const pool = poolSize(value);
  const entropyBits = Math.round(value.length * Math.log2(Math.max(pool, 2)) * 10) / 10;
  let score;
  if (entropyBits < 26) score = 0;
  else if (entropyBits < 42) score = 1;
  else if (entropyBits < 62) score = 2;
  else if (entropyBits < 84) score = 3;
  else score = 4;

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
  if (isSequence(value)) {
    score = Math.min(score, 1);
    reasons.push('دنبالهٔ سادهٔ صفحه‌کلید یا الفبا است.');
  }
  if (/^(.)\1+$/.test(value)) {
    score = 0;
    reasons.push('تکرار یک نویسه است.');
  }
  if (/(.)\1{3,}/.test(value)) {
    score = Math.min(score, 1);
    reasons.push('چهار نویسهٔ یکسان پشت‌سرهم دارد.');
  }
  if (pool < 36 && value.length < 20) {
    reasons.push('تنوع نویسه‌ها کم است (حروف کوچک/بزرگ، رقم و نماد را ترکیب کنید).');
  }

  const label = normalizeForCompare(context.label);
  const username = normalizeForCompare(context.username);
  const host = normalizeForCompare(context.host);
  const plain = normalizeForCompare(value);
  // نام کاربری + پسوند/پیشوند کوتاه (netadmin!2024) هنوز قابل‌حدس است؛ اما
  // «شامل بودن» نام در یک رمز بلند و تصادفی، رمز را ضعیف نمی‌کند.
  if (username.length >= 3) {
    const remainder = Math.abs(plain.length - username.length);
    const wraps = plain.startsWith(username) || plain.endsWith(username);
    if (plain === username || (wraps && remainder <= 6)) {
      score = Math.min(score, 1);
      reasons.push('مشابه نام کاربری است.');
    }
  }
  if (label.length >= 5 && (plain === label || plain.includes(label))) {
    score = Math.min(score, 1);
    reasons.push('نام یا عنوان تجهیز را در خود دارد.');
  }
  if (host.length >= 5 && (plain === host || plain.includes(host))) {
    score = Math.min(score, 1);
    reasons.push('آدرس یا نام میزبان را در خود دارد.');
  }

  const finalScore = Math.max(0, Math.min(4, score));
  return {
    score: finalScore,
    label: STRENGTH_LABELS[finalScore],
    weak: finalScore <= 1,
    reasons: reasons.slice(0, 4),
    entropyBits,
  };
}

export default { STRENGTH_LABELS, assessSecret };
