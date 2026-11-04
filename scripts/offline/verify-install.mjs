#!/usr/bin/env node
/**
 * NetWatch — راستی‌آزمایی نصب آفلاین روی ویندوز x64
 * ------------------------------------------------------------------
 * توسط install.cmd / update.mjs صدا زده می‌شود؛ به‌تنهایی هم قابل اجراست:
 *
 *     node scripts/offline/verify-install.mjs --stage pre    # پیش از npm ci (فقط cache + Node)
 *     node scripts/offline/verify-install.mjs --stage deps   # پس از npm ci (بسته‌های باینری)
 *     node scripts/offline/verify-install.mjs --stage post   # پس از build (آمادهٔ اجرا)
 *
 * چرا لازم است: npm بستهٔ اختياریِ ناسازگار با پلتفرم را بی‌صدا رد می‌کند و با کد
 * خروجی صفر تمام می‌شود؛ بنابراین «npm ci موفق بود» به‌تنهایی یعنی نصب سالم نیست.
 * این اسکریپت صراحتاً همهٔ بسته‌های باینریِ پلتفرمِ فعلی را در node_modules می‌بیند
 * (روی سیستم مقصد: win32/x64).
 *
 * خروجی‌ها انگلیسی‌اند تا در کنسول ویندوز (codepage پیش‌فرض) خراب نمایش داده نشوند.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const idx = process.argv.indexOf('--stage');
const stage = idx >= 0 ? process.argv[idx + 1] : 'pre';

const errors = [];
const ok = (msg) => console.log(`  [ok] ${msg}`);

/* --- Node.js --- */
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  errors.push(`Node.js 22.12 or newer is required (found ${process.versions.node}).`);
} else {
  ok(`Node.js ${process.versions.node} (${process.arch})`);
}

/**
 * بسته‌های محدود به **همین پلتفرم** که باید در node_modules باشند.
 * پلتفرم از process.platform/process.arch خوانده می‌شود تا همین اسکریپت روی
 * ویندوز x64 (مقصد نصب) و روی سیستم سازندهٔ بسته هم درست کار کند.
 */
function requiredPlatformPackages() {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const libc =
    process.platform === 'linux'
      ? (process.report?.getReport?.()?.header?.glibcVersionRuntime ? 'glibc' : 'musl')
      : null;
  return Object.entries(lock.packages || {})
    .filter(([key, v]) => {
      if (!key || v.link) return false;
      if (!v.os && !v.cpu && !v.libc) return false;
      const osOk = !v.os || v.os.includes(process.platform);
      const cpuOk = !v.cpu || v.cpu.includes(process.arch);
      const libcOk = !v.libc || !libc || v.libc.includes(libc);
      return osOk && cpuOk && libcOk;
    })
    .map(([key]) => key);
}

function checkDeps() {
  const nm = path.join(ROOT, 'node_modules');
  if (!fs.existsSync(nm)) {
    errors.push('node_modules not found — run install.cmd first.');
    return;
  }
  ok('node_modules present');

  const required = requiredPlatformPackages();
  const missing = required.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
  if (missing.length) {
    errors.push(
      `Missing native binary packages for ${process.platform}/${process.arch} (${missing.length}):
    - ${missing.join('\n    - ')}` +
        `\n    Re-run install.cmd; if it repeats, the .npm-cache of this bundle is incomplete.`,
    );
  } else {
    ok(`all ${required.length} native binary packages installed (${process.platform}/${process.arch})`);
  }
}

if (stage === 'pre') {
  const cache = path.join(ROOT, '.npm-cache');
  if (!fs.existsSync(cache)) {
    errors.push(`Missing .npm-cache folder next to install.cmd (${cache}). The bundle is incomplete.`);
  } else {
    ok('.npm-cache folder present (offline dependency source)');
  }
} else {
  checkDeps();

  if (stage === 'post') {
    const dist = path.join(ROOT, 'web', 'dist', 'index.html');
    if (!fs.existsSync(dist)) {
      errors.push('web/dist/index.html not found — the UI build did not run (npm run build).');
    } else {
      ok('web build present (web/dist)');
    }

    // سلامت اتصال به بستهٔ باینری argon2 (همان چیزی که هنگام اجرا load می‌شود)
    try {
      await import('@node-rs/argon2');
      ok('argon2 native module loads');
    } catch (e) {
      errors.push(`@node-rs/argon2 failed to load: ${e.message}`);
    }
  }
}

if (errors.length) {
  console.error('\n[verify] FAILED:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('[verify] PASS');
