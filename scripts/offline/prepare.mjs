#!/usr/bin/env node
/**
 * NetWatch — ساخت بستهٔ نصب آفلاین (ویندوز x64)
 * ------------------------------------------------------------------
 * این اسکریپت روی یک سیستم **آنلاین** اجرا می‌شود (لینوکس/مک/ویندوز، Node ‏‎>= 22.12):
 *
 *     npm run offline:prepare          # یا: node scripts/offline/prepare.mjs
 *
 * خروجی:
 *     .offline/netwatch-offline-<version>-win64/           پوشهٔ نصب (قابل استفادهٔ مستقیم)
 *     .offline/netwatch-offline-<version>-win64.tar.gz     آرشیو برای انتقال با فلش/شبکه
 *
 * مراحل:
 *   1) کپی سورس برنامه؛ بدون node_modules، data (پایگاه‌داده)، .git، web/dist،
 *      فایل‌های .env و لاگ‌ها — یعنی هیچ داده یا Secretی منتقل نمی‌شود.
 *   2) `npm ci --os=win32 --cpu=x64` داخل همان پوشه با cache اختصاصی تا همهٔ
 *      tarballها — از جمله بسته‌های باینری ویندوز مثل
 *      @node-rs/argon2-win32-x64-msvc و @rolldown/binding-win32-x64-msvc — دانلود شوند.
 *   3) آزمون واقعی: نصب دوم با `npm ci --offline` (بدون هیچ دسترسی به شبکه) و
 *      راستی‌آزمایی وجود همهٔ بسته‌های win64؛ npm بستهٔ اختياریِ ناسازگار را بی‌صدا
 *      رد می‌کند، پس «خروجی صفر» به‌تنهایی کافی نیست و باید صراحتاً بررسی شود.
 *   4) حذف node_modules آزمایشی (روی سیستم مقصد دوباره از صفر ساخته می‌شود) و
 *      ساخت آرشیو tar.gz.
 *
 * خروجی فقط با `tar -xzf` (یا Explorer در ویندوز ۱۱) روی سیستم آفلاین باز می‌شود؛
 * اجرای نصب با `install.cmd` انجام می‌شود. جزئیات: docs/offline-install-update.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const BUNDLE_NAME = `netwatch-offline-${pkg.version}-win64`;
const OFFLINE_DIR = path.join(ROOT, '.offline');
const BUNDLE_DIR = path.join(OFFLINE_DIR, BUNDLE_NAME);
const CACHE_DIR = path.join(BUNDLE_DIR, '.npm-cache');
const ARCHIVE = path.join(OFFLINE_DIR, `${BUNDLE_NAME}.tar.gz`);

/** مسیرهایی که هرگز به بستهٔ آفلاین راه نمی‌یابند (نسبت به ریشهٔ پروژه) */
const IGNORE = [
  /^node_modules(\/|$)/,
  /^data(\/|$)/, // پایگاه‌داده و پشتیبان‌ها — دادهٔ کاربر هرگز منتقل نمی‌شود
  /^\.git(\/|$)/,
  /^\.offline(\/|$)/,
  /^\.freebuff(\/|$)/,
  /^\.cloud-attachments(\/|$)/,
  /^web\/dist(\/|$)/,
  /^test-results(\/|$)/,
  /^playwright-report(\/|$)/,
  /^artifacts(\/|$)/,
  /^\.env(?!\.example$)/, // .env، .env.local و… (اسرار) — .env.example مجاز است
  /\.log$/,
  /^\.DS_Store$/,
];

const ignored = (rel) => rel !== '' && IGNORE.some((re) => re.test(rel));

function log(msg) {
  console.log(`[offline-prepare] ${msg}`);
}

function fail(msg) {
  console.error(`\n[offline-prepare] خطا: ${msg}`);
  process.exit(1);
}

/** اجرای دستور با خروجی زنده؛ کد خروجی غیرصفر یعنی شکست */
function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.error) fail(`اجرای ${cmd} ممکن نشد: ${res.error.message}`);
  if (res.status !== 0) fail(`${cmd} ${args.join(' ')} با کد ${res.status} شکست خورد.`);
}

/**
 * بسته‌هایی که os/cpu محدود دارند و باید روی ویندوز x64 نصب شوند.
 * نام‌ها دقیقاً همان کلیدهای package-lock هستند (مثل node_modules/@node-rs/argon2-win32-x64-msvc).
 * @returns {string[]}
 */
function requiredWin64Packages(lockPath) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  return Object.entries(lock.packages || {})
    .filter(([key, v]) => {
      if (!key || v.link) return false;
      const restricted = Boolean(v.os || v.cpu || v.libc);
      if (!restricted) return false; // بستهٔ بدون محدودیت همیشه نصب می‌شود
      const osOk = !v.os || v.os.includes('win32');
      const cpuOk = !v.cpu || v.cpu.includes('x64');
      const libcOk = !v.libc || v.libc.includes('glibc');
      return osOk && cpuOk && libcOk;
    })
    .map(([key]) => key);
}

function verifyWin64(where, required) {
  const missing = required.filter((rel) => !fs.existsSync(path.join(where, rel)));
  if (missing.length) {
    console.error(`\n[offline-prepare] بسته‌های ویندوز x64 که پیدا نشدند (${missing.length}):`);
    for (const m of missing) console.error(`  - ${m}`);
    return false;
  }
  log(`همهٔ ${required.length} بستهٔ باینری ویندوز x64 موجود است.`);
  return true;
}

function dirSize(target) {
  let total = 0;
  const stack = [target];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else total += fs.statSync(p).size;
    }
  }
  return total;
}

const human = (n) => (n > 1024 * 1024 * 1024 ? `${(n / 1024 ** 3).toFixed(2)} GiB` : `${(n / 1024 ** 2).toFixed(1)} MiB`);

/* ------------------------------------------------------------------ */
/* 1) کپی سورس                                                         */
/* ------------------------------------------------------------------ */

log(`نسخهٔ برنامه: ${pkg.version} — هدف: win32/x64`);
fs.mkdirSync(OFFLINE_DIR, { recursive: true });
fs.rmSync(BUNDLE_DIR, { recursive: true, force: true });
fs.mkdirSync(BUNDLE_DIR, { recursive: true });

const filter = (src) => {
  const rel = path.relative(ROOT, src).split(path.sep).join('/');
  return !ignored(rel);
};

let copied = 0;
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (ignored(entry.name)) continue;
  const from = path.join(ROOT, entry.name);
  const to = path.join(BUNDLE_DIR, entry.name);
  fs.cpSync(from, to, { recursive: true, filter });
  copied += 1;
}
log(`${copied} مورد از سورس برنامه کپی شد (بدون data، node_modules، .git و .env).`);

// کارهای نصب/بروزرسانی در ریشهٔ بسته با دابل‌کلیک در دسترس باشند
for (const f of ['install.cmd', 'update.cmd']) {
  const src = path.join(SCRIPT_DIR, f);
  if (!fs.existsSync(src)) fail(`فایل راه‌انداز ${f} در scripts/offline پیدا نشد.`);
  fs.copyFileSync(src, path.join(BUNDLE_DIR, f));
}

/* ------------------------------------------------------------------ */
/* 2) دانلود وابستگی‌ها با هدف win32/x64 در cache اختصاصی              */
/* ------------------------------------------------------------------ */

const required = requiredWin64Packages(path.join(ROOT, 'package-lock.json'));
if (!required.length) fail('بستهٔ محدود-بومی‌ای در package-lock پیدا نشد؛ ساختار قفل تغییر کرده است.');

log('در حال دانلود وابستگی‌ها برای ویندوز x64 (npm ci --os=win32 --cpu=x64)…');
run('npm', ['ci', '--os=win32', '--cpu=x64', '--no-audit', '--no-fund', '--cache', CACHE_DIR], BUNDLE_DIR);

if (!verifyWin64(BUNDLE_DIR, required)) {
  fail('npm بسته‌های باینری ویندوز را دانلود نکرد؛ نصب آفلاین کار نمی‌کند.');
}

/* ------------------------------------------------------------------ */
/* 3) آزمون واقعیِ نصب آفلاین                                          */
/* ------------------------------------------------------------------ */

// پرچم‌های os/cpu باید همین‌ها باشند تا آزمون، دقیقاً همان چیزی را بسازد که روی
// ویندوز x64 ساخته می‌شود؛ بدون آنها npm روی این سیستم، بسته‌های darwin را برمی‌دارد
// و بسته‌های win32 را بی‌صدا رد می‌کند (خطای آرام، نه شکست آشکار).
log('آزمون نصب آفلاین (npm ci --offline --os=win32 --cpu=x64 — بدون شبکه)…');
run(
  'npm',
  ['ci', '--offline', '--os=win32', '--cpu=x64', '--no-audit', '--no-fund', '--cache', CACHE_DIR],
  BUNDLE_DIR,
);
if (!verifyWin64(BUNDLE_DIR, required)) {
  fail('cache for the offline install is incomplete; check the missing packages listed above.');
}

// node_modules آزمایشی به بسته راه نمی‌یابد: روی سیستم مقصد از صفر ساخته می‌شود
fs.rmSync(path.join(BUNDLE_DIR, 'node_modules'), { recursive: true, force: true });
log('cache آماده است (node_modules آزمایشی حذف شد).');

/* ------------------------------------------------------------------ */
/* 4) راهنمای کوتاه داخل بسته + آرشیو                                  */
/* ------------------------------------------------------------------ */

fs.writeFileSync(
  path.join(BUNDLE_DIR, 'README-OFFLINE.md'),
  `# بستهٔ نصب آفلاین NetWatch ${pkg.version} (ویندوز x64)

این پوشه همهٔ چیزی را که برای نصب بدون اینترنت لازم است دارد: سورس برنامه،
وابستگی‌های دانلودشده برای ویندوز x64 (پوشهٔ \`.npm-cache\`) و اسکریپت‌های نصب.

پیش‌نیاز: **Node.js نسخه ۲۲٫۱۲ یا بالاتر** (نسخهٔ ۶۴بیتی).

## نصب (یک‌بار)

\`\`\`bat
install.cmd
npm start
\`\`\`

سپس مرورگر را روی \`http://localhost:8787\` باز کنید. نصب کاملاً آفلاین است و
به هیچ سروری در اینترنت وصل نمی‌شود.

## بروزرسانی (با حفظ داده‌ها)

۱) برنامهٔ در حال اجرا را متوقف کنید (Ctrl+C).
۲) این بستهٔ **جدید** را در یک پوشهٔ جداگانه باز کنید.
۳) اجرا: \`update.cmd <مسیر نصب فعلی>\`

اسکریپت اول پشتیبان می‌گیرد (npm run db:backup)، بعد کد را جایگزین می‌کند و
\`data/\` (پایگاه‌داده) دست نمی‌خورد؛ سپس نصب وابستگی‌ها و ساخت رابط کاربری.
جزئیات و بازگشت (Rollback): \`docs/offline-install-update.md\`.
`,
  'utf8',
);

log('در حال ساخت آرشیو tar.gz…');
const tar = spawnSync('tar', ['czf', ARCHIVE, '-C', OFFLINE_DIR, BUNDLE_NAME], { stdio: 'inherit' });
if (tar.error || tar.status !== 0) {
  console.warn(`[offline-prepare] آرشیو ساخته نشد (${tar.error?.message ?? `کد ${tar.status}`}). خودِ پوشه آماده است.`);
} else {
  log(`آرشیو: ${path.relative(ROOT, ARCHIVE)} (${human(fs.statSync(ARCHIVE).size)})`);
}

log(`پوشهٔ نصب: ${path.relative(ROOT, BUNDLE_DIR)} (${human(dirSize(BUNDLE_DIR))})`);
console.log(`
مراحل بعدی:
  1) فایل ${path.basename(ARCHIVE)} را به سیستم آفلاین (ویندوز x64) منتقل کنید.
  2) با tar -xzf یا Explorer (ویندوز ۱۱) باز کنید.
  3) install.cmd را اجرا کنید، سپس npm start
راهنما: docs/offline-install-update.md
`);
