/**
 * NetWatch — چرخهٔ عمر HTTP و سرویس‌های دوره‌ای
 * ----------------------------------------------------------------
 * این ماژول فقط ساخت HTTP/HTTPS، سوارکردن رابط کاربری و شروع
 * زمان‌بندها/Engine را بر عهده دارد. مسیر موفقیت دقیقاً همان ترتیب
 * قبلی index.js را حفظ می‌کند: Frontend → listen → Redirect →
 * Sampling/Session/Retention/Backup → Config Log → Engine.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

import { config, configSummary } from './config.js';
import { DB_PATH, getSettings, log } from './db.js';
import { engine } from './engine.js';
import { logEvent } from './logger.mjs';
import { startBackupScheduler } from './backup.js';
import { startServerPoller } from './server-monitoring/poller.js';
import { startRetentionScheduler } from './retention.js';
import { startSessionSweeper } from './auth.js';
import { startSampling } from './metrics.js';
import { mountFrontend } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/**
 * گواهی TLS فقط از مسیرهای پیکربندی‌شده خوانده می‌شود؛ نبود فایل یا
 * تنظیم ناقص باید Startup را متوقف کند، نه اینکه بی‌صدا روی HTTP بیفتد.
 */
function readTlsFiles() {
  const tlsCfg = config.tls;
  if (!tlsCfg.enabled) return null;
  const certPath = tlsCfg.certPath;
  const keyPath = tlsCfg.keyPath;
  const caPath = tlsCfg.caPath && fs.existsSync(tlsCfg.caPath) ? tlsCfg.caPath : null;
  if (!certPath || !keyPath) {
    throw new Error('برای HTTPS باید هم NETWATCH_TLS_CERT و هم NETWATCH_TLS_KEY تنظیم شود (یا فقط NETWATCH_TLS_DIR).');
  }
  for (const [label, file] of [
    ['گواهی', certPath],
    ['کلید', keyPath],
    ['CA', caPath],
  ]) {
    if (file && !fs.existsSync(file)) throw new Error(`فایل ${label} پیدا نشد: ${file}`);
  }
  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
    ca: caPath ? fs.readFileSync(caPath) : undefined,
    files: { certPath, keyPath, caPath },
  };
}

/**
 * ساخت Runtime. خطای TLS به bootstrap برمی‌گردد تا منابع قبلی آزاد شوند؛
 * پیام و کد خطا برای حفظ پیام فعلی اپراتور جداگانه علامت‌گذاری می‌شود.
 */
export function createServerRuntime({ app, tlsState = { enabled: false, files: null } }) {
  let tls;
  try {
    tls = readTlsFiles();
  } catch (e) {
    const error = new Error(`راه‌اندازی HTTPS ناموفق بود: ${e.message}`);
    error.code = 'TLS_STARTUP_FAILED';
    throw error;
  }
  if (tls) {
    tlsState.enabled = true;
    tlsState.files = tls.files;
  }

  const server = tls ? https.createServer({ key: tls.key, cert: tls.cert, ca: tls.ca }, app) : http.createServer(app);
  // محدودیت‌های HTTP: درخواست نیمه‌کاره/کند (Slowloris) و هدرهای حجیم نمی‌توانند
  // اتصال را بی‌پایان باز نگه دارند. keep-alive کوتاه است تا سوکت‌های idle سریع
  // آزاد شوند و خاموشی سرویس معطل نماند.
  server.requestTimeout = config.http.requestTimeoutMs;
  server.headersTimeout = config.http.headersTimeoutMs;
  server.keepAliveTimeout = config.http.keepAliveTimeoutMs;
  server.maxHeadersCount = config.http.maxHeadersCount;
  const scheme = tlsState.enabled ? 'https' : 'http';

  // ریدایرکت اختیاری HTTP → HTTPS (وقتی اپراتور NETWATCH_HTTP_PORT را تنظیم کند)
  let redirectServer = null;

  async function start() {
    await mountFrontend({ app, server, root: ROOT, dev: config.dev });

    server.listen(config.port, config.host, () => {
      const addr = server.address();
      console.log(`\n  NetWatch  ▸  ${scheme}://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${addr.port}`);
      console.log(`  حالت: ${config.dev ? 'توسعه (Vite + HMR)' : 'تولیدی'}   |   پایگاه‌داده: ${DB_PATH}`);
      console.log(`  موتور مانیتورینگ: ${getSettings().engine_mode}`);
      if (tlsState.enabled) {
        console.log(`  HTTPS فعال است   |   گواهی: ${tlsState.files.certPath}`);
        if (!tlsState.files.caPath) {
          console.log('  توجه: فایل ca.crt پیدا نشد؛ کلاینت‌ها ممکن است خطای اعتماد گواهی بگیرند.');
        }
      }
      console.log('');
      logEvent('info', 'server_listen', {
        host: config.host,
        port: addr.port,
        dev: config.dev,
        tls: tlsState.enabled,
        dbPath: DB_PATH,
        engineMode: getSettings().engine_mode,
      });
    });

    // HTTP → HTTPS: کاربران با تایپ آدرس بدون https هم به نسخهٔ امن می‌رسند
    const redirectPort = config.tls.httpPort;
    if (tlsState.enabled && redirectPort) {
      redirectServer = http.createServer((req, res) => {
        const host = String(req.headers.host || '').split(':')[0] || config.host;
        const target = `${scheme}://${host}${Number(config.port) === 443 ? '' : `:${config.port}`}${req.url || '/'}`;
        res.writeHead(308, { Location: target, 'Cache-Control': 'no-store' });
        res.end();
      });
      redirectServer.listen(redirectPort, config.host, () => {
        console.log(`  ریدایرکت HTTP → HTTPS روی پورت ${redirectPort} فعال است.\n`);
        logEvent('info', 'http_redirect_listen', { host: config.host, port: redirectPort, targetPort: config.port });
      });
      redirectServer.on('error', (err) => {
        console.error(`  خطای ریدایرکت HTTP (پورت ${redirectPort}): ${err.message}\n`);
      });
    }

    // نمونه‌گیری منابع برای صفحهٔ Application Health (حافظهٔ ثابت: ۱ ساعت تاریخچه)
    startSampling(5000);
    startSessionSweeper();
    // Retention Engine مستقل: نگهداری داده، Dry-Run، قفل تک‌نمونه و گزارش.
    // پاک‌سازی حسابرسی هم از همین مسیر انجام می‌شود (نه دو زمان‌بند موازی).
    startRetentionScheduler({ isLeader: () => engine.getStatus().leader || !config.engine.enabled });
    // پشتیبان‌گیری خودکار + Checkpoint دوره‌ای WAL (فقط نمونهٔ رهبر موتور)
    startBackupScheduler({ isLeader: () => engine.getStatus().leader || !config.engine.enabled });
    // سرورها را همهٔ نمونه‌ها می‌توانند Poll کنند؛ last_poll_at در DB از
    // Poll دوباره در همان بازه جلوگیری می‌کند. Agent مستقل از این زمان‌بند است.
    startServerPoller();
    if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
      console.log(`  توجه: این سرویس روی ${config.host} منتشر شده است؛`);
      console.log('        ورود الزامی است و مجوزها بر اساس نقش (Administrator/Operator/Viewer) اعمال می‌شوند.');
      console.log('        برای امنیت بیشتر، TLS و فایروال/پروکسی معکوس را فعال کنید.\n');
    }

    logEvent('info', 'config_loaded', configSummary(config));
    for (const warning of config.warnings) log('warn', warning);

    if (config.engine.enabled) {
      await engine.start();
      if (!engine.getStatus().leader) {
        console.log(
          '  توجه: موتور دیگری (مثلاً engine-cli) قفل رهبری را دارد؛ این نمونه Ping نمی‌زند و در حالت آماده‌به‌کار است.\n'
        );
      }
    } else {
      console.log('  موتور مانیتورینگ غیرفعال است (NETWATCH_ENGINE=0).');
    }
  }

  return {
    server,
    start,
    getRedirectServer: () => redirectServer,
  };
}
