/**
 * NetWatch — مدیریت Signalها و خطاهای سطح فرآیند
 * ----------------------------------------------------------------
 * همهٔ مسیرهای توقف به یک shutdown idempotent می‌رسند؛ Signal تکراری،
 * uncaughtException و unhandledRejection باعث اجرای دوبارهٔ سرویس‌ها
 * نمی‌شوند. خطای Server نیز پیش از خروج، منابع را آزاد می‌کند.
 */
import { log } from './db.js';
import { logEvent } from './logger.mjs';

/**
 * @param {object} options
 * @param {(code?: number) => Promise<void>} options.shutdown
 * @param {import('node:http').Server} options.server
 * @param {number} options.port
 */
export function installProcessHandlers({ shutdown, server, port }) {
  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));

  // پایداری: یک خطای مهارنشده نباید سرور را بی‌صدا از کار بیندازد — ثبت می‌شود و
  // فرآیند با خاموش‌سازی مرتب (نوشتن WAL و بستن پایگاه‌داده) پایان می‌یابد.
  process.on('uncaughtException', (err) => {
    log('error', `خطای مهارنشده: ${err?.stack || err?.message || err}`);
    logEvent('error', 'uncaught_exception', { message: err?.message, stack: err?.stack });
    console.error('\n  خطای مهارنشده:', err?.message || err);
    void shutdown(1);
  });
  process.on('unhandledRejection', (reason) => {
    log('error', `وعدهٔ ردشدهٔ مهارنشده: ${reason?.stack || reason?.message || reason}`);
    logEvent('error', 'unhandled_rejection', { message: reason?.message ?? String(reason), stack: reason?.stack });
    console.error('\n  وعدهٔ ردشدهٔ مهارنشده:', reason?.message || reason);
    void shutdown(1);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  پورت ${port} در حال استفاده است. پورت دیگری را با PORT=… تنظیم کنید.`);
    } else {
      console.error('\n  خطای سرور HTTP:', err.message);
    }
    void shutdown(1);
  });
}
