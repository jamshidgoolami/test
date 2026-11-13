#!/usr/bin/env node
/**
 * NetWatch — بروزرسانی نصب موجود با حفظ داده‌ها
 * ------------------------------------------------------------------
 * از داخل **بستهٔ جدید** اجرا می‌شود:
 *
 *     node scripts/offline/update.mjs <install-dir> [--ignore-running] [--no-build] [--cache <dir>]
 *     update.cmd C:\NetWatch
 *
 * ترتیب کارها (شکست در هر گام = توقف، پیش از هر تغییر مخرب):
 *   1) اعتبارسنجی مسیر نصب + اخطار اگر برنامه روی پورت در حال اجراست
 *   2) پشتیبان از پایگاه‌داده (npm run db:backup) پیش از هر تغییری
 *   3) کپی کد جدید روی نصب موجود — با ردشدنِ data/، node_modules/، .npm-cache/، .git/ و .env
 *   4) npm ci --offline از cache همین بسته (به‌روزرسانی وابستگی‌ها طبق package-lock جدید)
 *   5) ساخت رابط کاربری + راستی‌آزمایی
 *
 * داده‌ها (`data/netwatch.db`، پشتیبان‌ها و `data/mbtiles`) هرگز کپی، بازنویسی یا
 * حذف نمی‌شوند. بازگشت: بازیابی همان پشتیبان + نصب بستهٔ قبلی (docs/offline-install-update.md).
 *
 * خروجی کنسول انگلیسی است تا در codepage پیش‌فرض ویندوز خراب نمایش داده نشود.
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE_DIR = path.resolve(SCRIPT_DIR, '..', '..');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));
const optValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};

const info = (m) => console.log(`[offline-update] ${m}`);
const fail = (m) => {
  console.error(`\n[offline-update] ERROR: ${m}`);
  process.exit(1);
};

if (!positional.length) {
  console.error('Usage: node scripts/offline/update.mjs <install-dir> [--ignore-running] [--no-build] [--cache <dir>]');
  process.exit(1);
}

const installDir = path.resolve(positional[0]);
const cacheDir = path.resolve(optValue('--cache') ?? path.join(BUNDLE_DIR, '.npm-cache'));

if (process.platform === 'win32' && process.arch !== 'x64') {
  fail(`64-bit Node.js is required on Windows (found ${process.arch}).`);
}

const readPkg = (dir) => {
  const f = path.join(dir, 'package.json');
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};

const bundlePkg = readPkg(BUNDLE_DIR);
const installPkg = readPkg(installDir);
if (!bundlePkg) fail(`bundle package.json not found in ${BUNDLE_DIR}`);
if (!installPkg || installPkg.name !== bundlePkg.name) {
  fail(
    `not a ${bundlePkg.name} installation: ${installDir}\n` +
      '  Point this at the folder where NetWatch is installed (it contains package.json and data\\).',
  );
}
if (installDir === BUNDLE_DIR) fail('the install folder and the bundle folder are the same path.');

const sameDir = fs.realpathSync(installDir) === fs.realpathSync(BUNDLE_DIR);
const isNested = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};
if (isNested(BUNDLE_DIR, installDir) || isNested(installDir, BUNDLE_DIR)) {
  fail('the install folder and the bundle folder must not contain each other.');
}
info(`installed version: ${installPkg.version ?? '?'}   new version: ${bundlePkg.version ?? '?'}`);
if (!fs.existsSync(cacheDir)) fail(`npm cache not found: ${cacheDir}`);

/* --- 1) برنامهٔ در حال اجرا؟ -------------------------------------- */

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (v) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(600);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

if (!flags.has('--ignore-running')) {
  const port = Number(process.env.PORT || 8787);
  if (await portOpen(port)) {
    fail(
      `something is listening on 127.0.0.1:${port} - probably NetWatch itself.\n` +
        '  Stop it first (Ctrl+C, or stop the service), then run this again.\n' +
        '  Use --ignore-running only if that port belongs to another program.',
    );
  }
  info('application is not running on the app port.');
}

/* --- 2) پشتیبان از پایگاه‌داده ------------------------------------ */

function run(cmd, args, cwd, extraEnv = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });
  if (res.error) fail(`could not run ${cmd}: ${res.error.message}`);
  if (res.status !== 0) fail(`${cmd} ${args.join(' ')} failed with code ${res.status}.`);
}

const configuredDataDir = process.env.NETWATCH_DATA_DIR?.trim();
const dataDir = configuredDataDir ? path.resolve(installDir, configuredDataDir) : path.join(installDir, 'data');
const configuredDb = process.env.NETWATCH_DB?.trim();
const dbFile = configuredDb ? path.resolve(installDir, configuredDb) : path.join(dataDir, 'netwatch.db');
const hasModules = fs.existsSync(path.join(installDir, 'node_modules'));
let backupLabel = null;

if (fs.existsSync(dbFile)) {
  if (!hasModules) {
    fail(
      'node_modules is missing, so a verified backup cannot be created.\n' +
        '  Run install.cmd in the existing installation first, then retry the update.',
    );
  }
  info('creating a database backup (npm run db:backup)…');
  const res = spawnSync('npm', ['run', 'db:backup'], {
    cwd: installDir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  process.stdout.write(res.stdout ?? '');
  process.stderr.write(res.stderr ?? '');
  if (res.status !== 0) {
    fail('database backup failed - nothing was changed. Fix the backup first, then re-run.');
  }
  const m = /"dir":\s*"([^"]+)"/.exec(res.stdout ?? '');
  backupLabel = m ? m[1] : 'data/backups';
  info(`backup created: ${backupLabel}`);
} else {
  info('no database yet - skipping backup.');
}

/* --- 3) کپی کد جدید (بدون دست‌زدن به data/) ------------------------ */

const SKIP =
  /^(node_modules|data|\.npm-cache|\.git|\.offline|\.freebuff|\.cloud-attachments|test-results|playwright-report|artifacts|web\/dist)(\/|$)|^\.env(?!\.example$)|\.log$|^\.DS_Store$/;

if (sameDir) {
  info('the bundle folder IS the install folder - skipping the file copy.');
} else {
  let count = 0;
  for (const e of fs.readdirSync(BUNDLE_DIR, { withFileTypes: true })) {
    if (SKIP.test(e.name)) continue;
    fs.cpSync(path.join(BUNDLE_DIR, e.name), path.join(installDir, e.name), {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(BUNDLE_DIR, src).split(path.sep).join('/');
        return rel === '' || !SKIP.test(rel);
      },
    });
    count += 1;
  }
  info(`${count} items copied over the installation (data\\ and .env untouched).`);
}

/* --- 4) وابستگی‌ها + 5) ساخت و راستی‌آزمایی ------------------------ */

info('installing dependencies from the bundle cache (npm ci --offline)…');
run('npm', ['ci', '--offline', '--no-audit', '--no-fund'], installDir, { npm_config_cache: cacheDir });
run('node', [path.join('scripts', 'offline', 'verify-install.mjs'), '--stage', 'deps'], installDir);

if (flags.has('--no-build')) {
  info('build skipped (--no-build).');
} else {
  info('building the web UI (npm run build)…');
  run('npm', ['run', 'build'], installDir);
  run('node', [path.join('scripts', 'offline', 'verify-install.mjs'), '--stage', 'post'], installDir);
}

console.log(`
[DONE] Update applied successfully.
  version : ${installPkg.version ?? '?'} -> ${bundlePkg.version ?? '?'}
  data    : ${dataDir}  (never modified by this script)
  backup  : ${backupLabel ?? '- (no database yet)'}
  start   : cd "${installDir}" && npm start     then open http://localhost:8787

  Rollback: npm run db:restore -- <backup-dir>   and install the previous bundle.
  Details  : docs/offline-install-update.md
`);
