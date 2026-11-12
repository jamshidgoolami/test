/**
 * NetWatch — خاموش‌سازی کنترل‌شده
 * ----------------------------------------------------------------
 * ترتیب آزادسازی منابع همان ترتیب قبلی index.js است:
 *   Engine → SSE/Jobs/Probe → Sweeperها/زمان‌بندها → Limiters →
 *   HTTP/Redirect → (Finish) Schedulerها → Checkpoint → DB.
 * این ماژول عمداً Server و Application را فقط از طریق وابستگی تزریق‌شده
 * می‌شناسد تا تست و چرخهٔ عمر به هم گره نخورند.
 */
import { config } from './config.js';
import { db, log } from './db.js';
import { engine } from './engine.js';
import { stopBackupScheduler, runCheckpoint } from './backup.js';
import { logEvent } from './logger.mjs';
import { shutdownJobs } from './jobs.js';
import { probeQueue } from './probe-queue.js';
import { stopSessionSweeper, closeAuthLimiters } from './auth.js';
import { stopRetentionScheduler, requestRetentionStop } from './retention.js';
import { stopAuditSweeper } from './audit.js';
import { stopSampling } from './metrics.js';

/**
 * @param {object} options
 * @param {import('node:http').Server} options.server
 * @param {{ closeRealtime: () => void, limiters: Array<{ close?: () => void }> }} options.appRuntime
 * @param {() => import('node:http').Server | null} options.getRedirectServer
 * @param {number} [options.graceMs]
 * @param {(code: number) => void} [options.exit]
 */
export function createShutdown({
  server,
  appRuntime,
  getRedirectServer,
  graceMs = config.shutdownTimeoutMs,
  exit = process.exit,
}) {
  let shuttingDown = false;
  let finished = false;
  let forceTimer = null;
  const SHUTDOWN_GRACE_MS = graceMs;

  /**
   * اگر مرحله‌ای در مهلت تمام نشود، مسیر اجباری همیشه خروج تمیز (WAL + بستن)
   * را انجام می‌دهد؛ هیچ تایمر/Worker بدون مالک باقی نمی‌ماند.
   */
  async function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n  در حال خاموش‌سازی…');
    logEvent('info', 'shutdown_start', { code });
    try {
      await engine.stop({ drainMs: config.shutdownTimeoutMs });
    } catch (e) {
      log('warn', `توقف موتور با خطا مواجه شد: ${e?.message || e}`);
    }
    // دسته‌بندی نمونه‌ها ممکن است یک تایمر فعال داشته باشد؛ پیش از بستن SSE و DB
    // باید آزاد شود وگرنه پس از خاموشی تلاش برای نوشتن روی پاسخ بسته می‌کند.
    try {
      appRuntime.closeRealtime();
    } catch {}
    // پس از پایان SSE، سوکت‌های idle بسته می‌شوند تا server.close منتظر
    // keep-alive نماند؛ اتصال‌های در جریان پس از مهلت اجباری بسته می‌شوند.
    try {
      server.closeIdleConnections?.();
    } catch {}
    try {
      shutdownJobs('shutdown');
    } catch {}
    try {
      probeQueue.shutdown();
    } catch {}
    try {
      stopSessionSweeper();
    } catch {}
    try {
      closeAuthLimiters();
    } catch {}
    try {
      stopRetentionScheduler();
    } catch {}
    try {
      requestRetentionStop();
    } catch {}
    try {
      stopAuditSweeper();
    } catch {}
    for (const limiter of appRuntime.limiters) {
      try {
        limiter.close?.();
      } catch {
        /* بی‌اثر */
      }
    }
    try {
      getRedirectServer()?.close();
    } catch {}
    server.close(() => finish(code));
    // اتصال‌های بی‌کار/گیرکرده پس از مهلت بسته می‌شوند تا خروج معطل نماند.
    forceTimer = setTimeout(
      () => {
        try {
          server.closeAllConnections?.();
        } catch {
          /* بی‌اثر */
        }
        finish(code);
      },
      Math.max(2500, Math.min(10000, SHUTDOWN_GRACE_MS))
    );
    if (forceTimer.unref) forceTimer.unref();
  }

  function finish(code) {
    if (finished) return;
    finished = true;
    if (forceTimer) clearTimeout(forceTimer);
    forceTimer = null;
    // پشتیبان‌گیری/Checkpoint متوقف و WAL پیش از بستن، به فایل اصلی منتقل می‌شود.
    // این کار «خاموشی تمیز» را تضمین می‌کند و دفعهٔ بعد بازگشایی سریع است.
    try {
      stopRetentionScheduler();
    } catch {}
    try {
      stopBackupScheduler();
    } catch {}
    try {
      stopSampling();
    } catch {}
    try {
      runCheckpoint('shutdown');
    } catch {}
    try {
      db.close();
    } catch {}
    logEvent('info', 'shutdown_done', { code });
    exit(code);
  }

  return {
    shutdown,
    isShuttingDown: () => shuttingDown,
    isFinished: () => finished,
  };
}
