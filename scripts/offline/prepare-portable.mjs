#!/usr/bin/env node
/**
 * NetWatch — ساخت بستهٔ Portable ویندوز x64
 * ------------------------------------------------------------------
 * روی یک سیستم آنلاین اجرا می‌شود:
 *
 *     npm run offline:portable
 *
 * بستهٔ خروجی شامل Node.js ویندوز x64، وابستگی‌های Production و رابط
 * Build‌شده است؛ سیستم مقصد به Node، npm، اینترنت یا Build نیاز ندارد.
 *
 * دادهٔ برنامه در پوشهٔ data کنار برنامه نگه داشته می‌شود و در بستهٔ جدید
 * قرار نمی‌گیرد؛ بنابراین استخراج نسخهٔ تازه روی همان پوشه، داده‌ها را
 * دست‌نخورده باقی می‌گذارد.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Node 22 LTS؛ با NETWATCH_NODE_VERSION می‌توان نسخهٔ دیگری از شاخهٔ 22 را انتخاب کرد.
const NODE_VERSION = process.env.NETWATCH_NODE_VERSION || 'v22.23.5';
const OFFLINE_DIR = path.join(ROOT, '.offline');
const BUNDLE_NAME = `netwatch-portable-${pkg.version}-win64`;
const BUNDLE_DIR = path.join(OFFLINE_DIR, BUNDLE_NAME);
const ARCHIVE = path.join(OFFLINE_DIR, `${BUNDLE_NAME}.tar.gz`);
const NODE_CACHE = path.join(OFFLINE_DIR, '.node-cache');
const NPM_CACHE = path.join(OFFLINE_DIR, '.npm-cache');

/** مسیرهایی که هرگز وارد بستهٔ Portable نمی‌شوند (نسبت به ریشهٔ پروژه). */
const IGNORE = [
  /^node_modules(\/|$)/,
  /^data(\/|$)/,
  /^\.git(\/|$)/,
  /^\.offline(\/|$)/,
  /^\.freebuff(\/|$)/,
  /^\.cloud-attachments(\/|$)/,
  /^web\/dist(\/|$)/,
  /^server\/tests(\/|$)/,
  /^web\/tests(\/|$)/,
  /^test-results(\/|$)/,
  /^playwright-report(\/|$)/,
  /^artifacts(\/|$)/,
  /^coverage(\/|$)/,
  /^playwright\.config\./,
  /^eslint\.config\./,
  /^\.github(\/|$)/,
  /^\.env(?!\.example$)/,
  /\.log$/,
  /^\.DS_Store$/,
];

const ignored = (rel) => rel !== '' && IGNORE.some((re) => re.test(rel));
const log = (msg) => console.log(`[portable] ${msg}`);
const fail = (msg) => {
  console.error(`\n[portable] ERROR: ${msg}`);
  process.exit(1);
};

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.error) fail(`could not run ${cmd}: ${res.error.message}`);
  if (res.status !== 0) fail(`${cmd} ${args.join(' ')} failed with code ${res.status}.`);
}

/** حذف همهٔ پوشه‌های .bin؛ روی سازندهٔ غیرویندوزی symlink می‌شوند و برای اجرا لازم نیستند. */
function removeBinDirs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (e.name === '.bin') fs.rmSync(p, { recursive: true, force: true });
    else removeBinDirs(p);
  }
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

const human = (n) =>
  n > 1024 * 1024 * 1024
    ? `${(n / 1024 ** 3).toFixed(2)} GiB`
    : `${(n / 1024 ** 2).toFixed(1)} MiB`;

/** بسته‌های باینری Production که باید برای win32/x64 موجود باشند. */
function requiredWin64Packages(lockPath) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  return Object.entries(lock.packages || {})
    .filter(([key, v]) => {
      if (!key || v.link || v.dev) return false;
      if (!v.os && !v.cpu && !v.libc) return false;
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
    console.error(`[portable] missing Windows x64 packages (${missing.length}):`);
    for (const m of missing) console.error(`  - ${m}`);
    return false;
  }
  log(`all ${required.length} Windows x64 production packages are present.`);
  return true;
}

async function ensureNodeExe() {
  fs.mkdirSync(NODE_CACHE, { recursive: true });
  const zipName = `node-${NODE_VERSION}-win-x64.zip`;
  const zipPath = path.join(NODE_CACHE, zipName);
  const base = `https://nodejs.org/dist/${NODE_VERSION}`;
  const sumUrl = `${base}/SHASUMS256.txt`;

  const sumsRes = await fetch(sumUrl);
  if (!sumsRes.ok) fail(`could not download ${sumUrl} (HTTP ${sumsRes.status})`);
  const sums = await sumsRes.text();
  const line = sums.split(/\r?\n/).find((l) => l.trim().endsWith(`  ${zipName}`));
  if (!line) fail(`checksum entry for ${zipName} was not found.`);
  const expected = line.trim().split(/\s+/)[0];

  let valid = false;
  if (fs.existsSync(zipPath) && fs.statSync(zipPath).size > 10 * 1024 * 1024) {
    valid = sha256(zipPath) === expected;
    if (!valid) log('cached Node zip checksum is wrong; downloading again.');
  }
  if (!valid) {
    log(`downloading Node.js ${NODE_VERSION} for Windows x64…`);
    const res = await fetch(`${base}/${zipName}`, { signal: AbortSignal.timeout(180000) });
    if (!res.ok) fail(`could not download ${zipName} (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(zipPath, buf);
    if (sha256(zipPath) !== expected) fail('downloaded Node.js checksum does not match SHASUMS256.txt.');
  }

  const extractDir = path.join(NODE_CACHE, `extract-${process.pid}`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  let res = spawnSync('unzip', ['-q', zipPath, '-d', extractDir], { stdio: 'inherit' });
  if (res.error || res.status !== 0) {
    res = spawnSync('tar', ['-xf', zipPath, '-C', extractDir], { stdio: 'inherit' });
  }
  if (res.error || res.status !== 0) fail('could not extract the Node.js zip (unzip/tar failed).');

  const exe = path.join(extractDir, `node-${NODE_VERSION}-win-x64`, 'node.exe');
  if (!fs.existsSync(exe)) fail(`node.exe was not found in the extracted Node.js zip.`);
  fs.copyFileSync(exe, path.join(BUNDLE_DIR, 'node.exe'));
  fs.rmSync(extractDir, { recursive: true, force: true });
  log(`Node.js ${NODE_VERSION} (win-x64) added.`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/* ------------------------------------------------------------------ */
/* 1) Build و کپی سورس                                                 */
/* ------------------------------------------------------------------ */

log(`version: ${pkg.version} — target: win32/x64 — Node ${NODE_VERSION}`);
fs.mkdirSync(OFFLINE_DIR, { recursive: true });
fs.mkdirSync(NPM_CACHE, { recursive: true });
fs.rmSync(BUNDLE_DIR, { recursive: true, force: true });
fs.mkdirSync(BUNDLE_DIR, { recursive: true });

log('building the web UI…');
run('npm', ['run', 'build'], ROOT);

const filter = (src) => {
  const rel = path.relative(ROOT, src).split(path.sep).join('/');
  return !ignored(rel);
};

let copied = 0;
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (ignored(entry.name)) continue;
  fs.cpSync(path.join(ROOT, entry.name), path.join(BUNDLE_DIR, entry.name), {
    recursive: true,
    filter,
  });
  copied += 1;
}
fs.cpSync(path.join(ROOT, 'web', 'dist'), path.join(BUNDLE_DIR, 'web', 'dist'), {
  recursive: true,
});
log(`${copied} source items copied; web/dist included.`);

/* ------------------------------------------------------------------ */
/* 2) وابستگی‌های Production برای ویندوز x64                            */
/* ------------------------------------------------------------------ */

log('installing production dependencies for Windows x64 (no dev dependencies)…');
run(
  'npm',
  ['ci', '--omit=dev', '--os=win32', '--cpu=x64', '--no-audit', '--no-fund', '--cache', NPM_CACHE],
  BUNDLE_DIR,
);

const required = requiredWin64Packages(path.join(BUNDLE_DIR, 'package-lock.json'));
if (!verifyWin64(BUNDLE_DIR, required)) {
  fail('the production Windows x64 dependency set is incomplete.');
}
// .bin (حتی .bin تودرتو) روی سازندهٔ غیرویندوزی symlink می‌شود و برای اجرا لازم نیست.
removeBinDirs(path.join(BUNDLE_DIR, 'node_modules'));

/* ------------------------------------------------------------------ */
/* 3) Node.exe و لانچر                                                  */
/* ------------------------------------------------------------------ */

await ensureNodeExe();

fs.writeFileSync(
  path.join(BUNDLE_DIR, 'NetWatch.cmd'),
  [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'if not exist "%~dp0data" mkdir "%~dp0data"',
    'set "NETWATCH_DATA_DIR=%~dp0data"',
    'set "NODE_ENV=production"',
    'if not defined HOST set "HOST=127.0.0.1"',
    'if not defined PORT set "PORT=8787"',
    'echo NetWatch is starting...',
    'echo Open http://localhost:%PORT% in your browser.',
    '"%~dp0node.exe" server\\index.js',
    '',
  ].join('\r\n'),
);

fs.writeFileSync(
  path.join(BUNDLE_DIR, 'README-PORTABLE.md'),
  `# NetWatch Portable ${pkg.version} (Windows x64)

این پوشه برنامه را بدون نصب Node.js، npm یا Build اجرا می‌کند.
Node.js ${NODE_VERSION} و وابستگی‌های Production از قبل داخل آن هستند.

## اجرا

روی \`NetWatch.cmd\` دابل‌کلیک کنید و سپس
\`http://localhost:8787\` را باز کنید.

داده‌ها در پوشهٔ \`data\` کنار همین فایل ساخته می‌شوند. برای دسترسی از
شبکهٔ داخلی، در یک پنجرهٔ cmd این را اجرا کنید:

\`\`\`bat
set HOST=0.0.0.0
NetWatch.cmd
\`\`\`

## بروزرسانی

1. برنامه را ببندید (Ctrl+C).
2. بستهٔ جدید را در یک پوشهٔ جداگانه باز کنید.
3. محتوای پوشهٔ جدید را روی پوشهٔ نصب فعلی کپی کنید و فایل‌های قدیمی را
   جایگزین کنید. پوشهٔ \`data\` را حذف یا جایگزین نکنید؛ بستهٔ جدید عمداً
   هیچ پوشهٔ \`data\` ندارد.
4. \`NetWatch.cmd\` را دوباره اجرا کنید.

Migration پایگاه‌داده در اولین اجرا خودکار انجام می‌شود. برای بازگشت، از
پشتیبان \`data/backups\` استفاده کنید.

جزئیات: \`docs/offline-install-update.md\`.
`,
  'utf8',
);

/* ------------------------------------------------------------------ */
/* 4) آرشیو و گزارش                                                     */
/* ------------------------------------------------------------------ */

log('creating tar.gz archive…');
const tar = spawnSync('tar', ['czf', ARCHIVE, '-C', OFFLINE_DIR, BUNDLE_NAME], {
  stdio: 'inherit',
});
if (tar.error || tar.status !== 0) {
  fail(`archive was not created (${tar.error?.message ?? `code ${tar.status}`}).`);
}

const archiveBytes = fs.statSync(ARCHIVE).size;
log(`archive: ${path.relative(ROOT, ARCHIVE)} (${human(archiveBytes)})`);
log(`sha256: ${sha256(ARCHIVE)}`);
log(`folder: ${path.relative(ROOT, BUNDLE_DIR)} (${human(dirSize(BUNDLE_DIR))})`);
console.log(`
Next steps:
  1) Transfer ${path.basename(ARCHIVE)} to the offline Windows x64 machine.
  2) Extract it with tar or Explorer (Windows 11).
  3) Double-click NetWatch.cmd.
`);
