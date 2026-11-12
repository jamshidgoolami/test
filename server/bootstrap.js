/**
 * NetWatch — هماهنگ‌کنندهٔ راه‌اندازی
 * ----------------------------------------------------------------
 * ترتیب Startup عمداً همان ترتیب قبلی index.js است:
 *   آماده‌سازی DB/داده → ساخت App → خواندن TLS/ساخت Server →
 *   نصب Signalها → Frontend/listen → سرویس‌های دوره‌ای → Engine.
 * index.js فقط این تابع را صدا می‌زند و خطای پیش از ساخت Runtime را
 * گزارش می‌کند؛ آزادسازی منابع در همان‌جا انجام می‌شود.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db, seedIfEmpty, log, verifyDatabaseAtStartup } from './db.js';
import { config } from './config.js';
import { logEvent } from './logger.mjs';
import { initialSetupRequired } from './auth.js';
import { markInterruptedRetentionRuns } from './retention.js';
import { cleanupStaleUploads } from './upload.js';
import { sweepAttachmentOrphans } from './attachments.js';
import { sweepOrphanFiles as sweepMbtilesOrphans } from './mbtiles.js';
import { pruneBrokenDiagramLinks } from './routes/diagrams.js';
import { createApplication } from './app.js';
import { createServerRuntime } from './server-lifecycle.js';
import { createShutdown } from './server-shutdown.js';
import { installProcessHandlers } from './server-signals.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// نسخهٔ برنامه از package.json خوانده می‌شود. اتکا به npm_package_version
// فقط وقتی درست است که سرویس با `npm start` اجرا شود؛ systemd مستقیم
// `node server/index.js` را اجرا می‌کند و در آن حالت مقدار متغیر خالی است
// (و پیش‌تر نسخهٔ نادرست 1.0.0 گزارش می‌شد).
const APP_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
})();

let started = false;

/**
 * آماده‌سازی داده پیش از ساخت Application. این بخش همگام است و ترتیب
 * بررسی DB، Recovery زمان‌بندها، Seed و Sweepها را تغییر نمی‌دهد.
 */
export function prepareApplicationData() {
  // نخست سلامت فایل پایگاه‌داده (quick_check + کلید خارجی + جدول‌های الزامی).
  // در صورت خرابی، برنامه با پیام روشن متوقف می‌شود؛ ادامهٔ کار روی فایل خراب،
  // داده را بیشتر نابود می‌کند. با NETWATCH_DB_CHECK=warn فقط هشدار داده می‌شود.
  verifyDatabaseAtStartup();
  markInterruptedRetentionRuns();
  // در نصب تازه، دادهٔ نمایشی فقط اگر صریحاً غیرفعال نشده باشد بارگذاری می‌شود
  // (NETWATCH_SEED_DEMO=0 برای نصب Production خالی).
  if (config.seedDemo) seedIfEmpty();
  else logEvent('info', 'demo_seed_skipped', { reason: 'NETWATCH_SEED_DEMO=0' });
  // نخستین مدیر دیگر خودکار ساخته نمی‌شود؛ صفحهٔ ورود در نخستین بازدید فرم
  // راه‌اندازی اولیه (نام کاربری + رمز دو بار) را نشان می‌دهد. این پیام فقط
  // اپراتور را در لاگ راهنمایی می‌کند.
  if (initialSetupRequired()) {
    console.log('\n  راه‌اندازی اولیه: هنوز حسابی وجود ندارد؛ در نخستین بازدید از رابط کاربری، حساب مدیر را بسازید.\n');
  }
  // فایل‌های نیمه‌کارهٔ بارگذاری که پس از Crash/قطع برق مانده‌اند پاک می‌شوند.
  cleanupStaleUploads();
  // جبران خطا برای فایل/رکوردهای نیمه‌کاره (BUG-19): فایل یتیم پیوست و MBTiles
  // پاک می‌شود، اما رکوردی که فایلش گم شده حذف نمی‌شود؛ فقط هشدار ثبت می‌شود.
  try {
    // فایل‌های هر دو نوع پیوست (تجهیز و دیاگرام) مرجع‌اند؛ وگرنه Sweep، تصویر
    // روی بوم دیاگرام را به‌اشتباه یتیم می‌بیند و پاک می‌کند.
    const referencedAttachments = [
      ...db.prepare('SELECT stored_name FROM device_attachments').all(),
      ...db.prepare('SELECT stored_name FROM diagram_attachments').all(),
    ].map((r) => r.stored_name);
    const swept = sweepAttachmentOrphans({ referenced: referencedAttachments });
    if (swept.removedFiles || swept.trashed || swept.missingFiles) {
      logEvent('warn', 'attachment_orphan_sweep', swept);
    }
  } catch (e) {
    log('warn', `پاک‌سازی فایل‌های یتیم پیوست ناموفق بود: ${e?.message || e}`);
  }
  try {
    const referencedMaps = db
      .prepare("SELECT file_name FROM map_layers WHERE file_name IS NOT NULL AND file_name <> ''")
      .all()
      .map((r) => r.file_name);
    const swept = sweepMbtilesOrphans({ referenced: referencedMaps });
    if (swept.removed || swept.missing) {
      logEvent('warn', 'mbtiles_orphan_sweep', swept);
    }
  } catch (e) {
    log('warn', `پاک‌سازی فایل‌های یتیم نقشه ناموفق بود: ${e?.message || e}`);
  }
  // ارجاع‌های شکستهٔ دیاگرام‌ها (لینک به دیاگرام حذف‌شده یا خود) از نسخه‌های قبل
  // پاک می‌شوند تا نقشهٔ ارتباط و بوم‌ها دادهٔ یتیم نشان ندهند.
  try {
    const pruned = pruneBrokenDiagramLinks();
    if (pruned.links || pruned.diagrams) {
      logEvent('warn', 'diagram_links_pruned', pruned);
    }
  } catch (e) {
    log('warn', `پاک‌سازی لینک‌های شکستهٔ دیاگرام ناموفق بود: ${e?.message || e}`);
  }
}

function reportStartupFailure(error) {
  if (error?.code === 'TLS_STARTUP_FAILED') {
    console.error(`\n  ${error.message}\n`);
    return;
  }
  console.error('راه‌اندازی ناموفق:', error);
}

/**
 * یک‌بار در هر فرآیند اجرا می‌شود؛ فراخوانی دوباره به‌جای شروع مجدد
 * Engine/Schedulerها خطا می‌دهد.
 */
export async function bootstrap() {
  if (started) throw new Error('bootstrap already started');
  started = true;

  const tlsState = { enabled: false, files: null };
  let appRuntime = null;
  let shutdownController = null;

  try {
    prepareApplicationData();
    appRuntime = createApplication({ appVersion: APP_VERSION, tlsState });
    const runtime = createServerRuntime({ app: appRuntime.app, tlsState });
    shutdownController = createShutdown({
      server: runtime.server,
      appRuntime,
      getRedirectServer: runtime.getRedirectServer,
    });
    installProcessHandlers({ shutdown: shutdownController.shutdown, server: runtime.server, port: config.port });
    await runtime.start();
  } catch (error) {
    reportStartupFailure(error);
    if (shutdownController) {
      await shutdownController.shutdown(1);
      return;
    }
    // خطای پیش از ساخت Runtime (DB، App یا TLS): منابع نیمه‌ساخته آزاد می‌شوند.
    try {
      appRuntime?.closeRealtime();
    } catch {}
    try {
      db.close();
    } catch {}
    process.exit(1);
  }
}
