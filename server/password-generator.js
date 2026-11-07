/**
 * NetWatch — تولید رمز و عبارت عبور
 * ----------------------------------------------------------------
 * برای رمزهای تجهیزات (SSH، پنل وب، SNMP، کنسول …) تولید قطعی و بدون سوگیری
 * لازم است، چون این رمزها بعداً روی خود تجهیز تنظیم می‌شوند و باید با محدودیت
 * نویسه‌های آن تجهیز بخوانند.
 *
 * قواعد:
 *   • فقط `crypto.randomInt` استفاده می‌شود (بدون `Math.random` و بدون باقی‌ماندهٔ
 *     سوگیرانه).
 *   • هیچ گزینه‌ای باعث تولید رمز ضعیف نمی‌شود: طول و تعداد کلمه کف دارند و
 *     دستهٔ نویسهٔ خالی به پیش‌فرض امن برمی‌گردد.
 *   • خروجی شامل خود مقدار و برآورد انتروپی است؛ سنجش قدرت در
 *     `credential-strength.js` انجام می‌شود.
 */
import crypto from 'node:crypto';

export const GENERATOR_LIMITS = Object.freeze({
  minLength: 8,
  maxLength: 128,
  minWords: 3,
  maxWords: 12,
});

/** نویسه‌هایی که در چاپ/خواندن دستی اشتباه گرفته می‌شوند */
const AMBIGUOUS = new Set(['I', 'l', '1', 'O', '0', 'o', '|', '`']);

const BASE_SETS = Object.freeze({
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}:,.?',
});

/**
 * فهرست کلمات عبارات عبور. کلمات کوتاه، بدون فاصله و بدون ابهام املایی‌اند؛
 * همین فهرست ثابت می‌ماند تا انتروپی قابل محاسبه باشد (log2(طول فهرست) به ازای
 * هر کلمه).
 */
export const WORD_LIST = Object.freeze([
  'anchor', 'amber', 'apple', 'arctic', 'arrow', 'atlas', 'autumn', 'bamboo',
  'banjo', 'basalt', 'beacon', 'birch', 'bishop', 'blaze', 'bloom', 'boulder',
  'breeze', 'bridge', 'bronze', 'brook', 'butter', 'cabin', 'cactus', 'camera',
  'candle', 'canyon', 'carbon', 'castle', 'cedar', 'cello', 'chalk', 'cherry',
  'cinder', 'circle', 'citrus', 'clever', 'clover', 'cobalt', 'coffee', 'comet',
  'compass', 'copper', 'coral', 'cosmic', 'cotton', 'crater', 'crimson', 'crystal',
  'cypress', 'daisy', 'dapper', 'dawn', 'delta', 'denim', 'desert', 'diamond',
  'diesel', 'dolphin', 'dragon', 'drifter', 'ember', 'emerald', 'engine', 'falcon',
  'feather', 'fennel', 'ferry', 'fiber', 'fiddle', 'flint', 'forest', 'fossil',
  'fountain', 'fox', 'galaxy', 'garden', 'garnet', 'gecko', 'ginger', 'glacier',
  'glider', 'granite', 'grape', 'gravel', 'grotto', 'guitar', 'harbor', 'hazel',
  'helmet', 'heron', 'hickory', 'hollow', 'honey', 'hornet', 'humble', 'indigo',
  'iron', 'island', 'ivory', 'jacket', 'jaguar', 'jasper', 'jungle', 'juniper',
  'kayak', 'kettle', 'keystone', 'kitten', 'koala', 'lagoon', 'lantern', 'lattice',
  'lavender', 'lemon', 'lilac', 'linen', 'lizard', 'lobster', 'lotus', 'lumber',
  'lunar', 'magnet', 'mango', 'maple', 'marble', 'marina', 'meadow', 'melon',
  'meteor', 'mint', 'mirror', 'monsoon', 'mosaic', 'moss', 'mountain', 'mustard',
  'nectar', 'needle', 'nickel', 'nimble', 'noble', 'north', 'nutmeg', 'oasis',
  'ocean', 'olive', 'onyx', 'opal', 'orbit', 'orchid', 'osprey', 'otter',
  'oxygen', 'oyster', 'paddle', 'palace', 'panda', 'papaya', 'parrot', 'pastel',
  'pebble', 'pelican', 'pepper', 'pewter', 'phoenix', 'piano', 'pigeon', 'pine',
  'pixel', 'planet', 'plaza', 'plum', 'pocket', 'polar', 'poplar', 'poppy',
  'prairie', 'prism', 'pumpkin', 'quartz', 'quilt', 'rabbit', 'radar', 'rainbow',
  'raven', 'reef', 'ribbon', 'river', 'robin', 'rocket', 'rosemary', 'ruby',
  'rustic', 'saddle', 'saffron', 'salmon', 'sand', 'sapphire', 'satellite', 'scarlet',
  'sequoia', 'shadow', 'shell', 'silk', 'silver', 'sketch', 'slate', 'solar',
  'sparrow', 'spruce', 'stellar', 'stone', 'storm', 'sugar', 'summit', 'sunset',
  'surf', 'swallow', 'sycamore', 'table', 'talon', 'tango', 'teal', 'tempo',
  'thicket', 'thunder', 'tiger', 'timber', 'toffee', 'topaz', 'torch', 'tower',
  'tulip', 'tundra', 'turquoise', 'ultra', 'umbra', 'unity', 'valley', 'velvet',
  'vessel', 'violet', 'vista', 'walnut', 'willow', 'window', 'winter', 'wolf',
  'yarrow', 'yonder', 'zenith', 'zephyr', 'zinc', 'zodiac',
]);

const SEPARATORS = ['-', '.', '_', ' ', ''];

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** نویسه‌های هر دسته پس از حذف نویسه‌های مبهم */
function setsFor({ lower, upper, digits, symbols, avoidAmbiguous }) {
  const filter = (chars) => (avoidAmbiguous ? [...chars].filter((c) => !AMBIGUOUS.has(c)).join('') : chars);
  const out = {};
  if (lower) out.lower = filter(BASE_SETS.lower);
  if (upper) out.upper = filter(BASE_SETS.upper);
  if (digits) out.digits = filter(BASE_SETS.digits);
  if (symbols) out.symbols = filter(BASE_SETS.symbols);
  return out;
}

/** گزینه‌های ورودی را نرمال و مرزگذاری می‌کند؛ مقدار نامعتبر → پیش‌فرض امن. */
export function normalizeGeneratorOptions(input = {}) {
  const mode = input.mode === 'passphrase' ? 'passphrase' : 'random';
  let lower = input.lower !== false;
  let upper = input.upper !== false;
  let digits = input.digits !== false;
  const symbols = input.symbols !== false;
  if (!lower && !upper && !digits && !symbols) {
    lower = true;
    upper = true;
    digits = true;
  }
  return {
    mode,
    length: clampInt(input.length, GENERATOR_LIMITS.minLength, GENERATOR_LIMITS.maxLength, mode === 'passphrase' ? 20 : 20),
    lower,
    upper,
    digits,
    symbols,
    avoidAmbiguous: input.avoidAmbiguous !== false,
    requireEach: input.requireEach !== false,
    words: clampInt(input.words, GENERATOR_LIMITS.minWords, GENERATOR_LIMITS.maxWords, 6),
    separator: SEPARATORS.includes(String(input.separator ?? '-')) ? String(input.separator ?? '-') : '-',
    addNumber: input.addNumber === true,
    capitalize: input.capitalize === true,
  };
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function pick(chars) {
  return chars[crypto.randomInt(chars.length)];
}

/** انتروپی تقریبی یک مجموعهٔ نویسه (بیت) */
export function charsetEntropy(poolSize, length) {
  if (!poolSize || !length) return 0;
  return Math.round(length * Math.log2(poolSize) * 10) / 10;
}

/** تولید رمز تصادفی با دسته‌های انتخابی. */
export function generatePassword(rawOptions = {}) {
  const options = normalizeGeneratorOptions(rawOptions);
  const sets = setsFor(options);
  const classes = Object.values(sets).filter(Boolean);
  const all = classes.join('');
  if (!all) throw new Error('هیچ دستهٔ نویسه‌ای برای تولید رمز انتخاب نشده است.');

  const length = Math.max(options.length, options.requireEach ? classes.length : 0);
  const chars = [];
  if (options.requireEach) {
    // تضمین حداقل یک نویسه از هر دستهٔ فعال، سپس پرکردن و بی‌ترتیب‌سازی
    for (const charsOfSet of classes) chars.push(pick(charsOfSet));
  }
  while (chars.length < length) chars.push(pick(all));

  return {
    mode: 'random',
    value: shuffle(chars).join(''),
    charsetSize: all.length,
    entropyBits: charsetEntropy(all.length, length),
  };
}

/** تولید عبارت عبور از فهرست کلمات. */
export function generatePassphrase(rawOptions = {}) {
  const options = normalizeGeneratorOptions({ ...rawOptions, mode: 'passphrase' });
  const picked = [];
  // بدون تکرار کلمه در یک عبارت
  const used = new Set();
  let guard = 0;
  while (picked.length < options.words && guard < options.words * 20) {
    guard += 1;
    const word = WORD_LIST[crypto.randomInt(WORD_LIST.length)];
    if (used.has(word)) continue;
    used.add(word);
    picked.push(options.capitalize ? word[0].toUpperCase() + word.slice(1) : word);
  }
  if (options.addNumber) picked.push(String(crypto.randomInt(10, 100)));

  const separatorEntropy = Math.log2(WORD_LIST.length);
  return {
    mode: 'passphrase',
    value: picked.join(options.separator),
    charsetSize: WORD_LIST.length,
    entropyBits:
      Math.round((options.words * separatorEntropy + (options.addNumber ? Math.log2(90) : 0)) * 10) / 10,
  };
}

/** نقطهٔ ورود مشترک API: بر اساس حالت، رمز یا عبارت عبور می‌سازد. */
export function generateSecret(input = {}) {
  const options = normalizeGeneratorOptions(input);
  return options.mode === 'passphrase' ? generatePassphrase(options) : generatePassword(options);
}

export default { GENERATOR_LIMITS, WORD_LIST, normalizeGeneratorOptions, generatePassword, generatePassphrase, generateSecret };
