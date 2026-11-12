/**
 * NetWatch — نقطهٔ ورود سرور
 * ----------------------------------------------------------------
 * مسئولیت این فایل فقط شروع Bootstrap و گزارش خطای پیش از راه‌اندازی
 * Runtime است. جزئیات Application، Lifecycle، Shutdown و Signalها در
 * ماژول‌های مستقل قرار دارند.
 *
 * یک فرآیند واحد:
 *   • API  →  /api/*
 *   • رویدادهای زنده (SSE) → /api/events
 *   • رابط کاربری (Vite در حالت توسعه، فایل‌های ساخته‌شده در اجرای معمولی)
 *   • موتور مانیتورینگ (قابل خاموش‌کردن با NETWATCH_ENGINE=0)
 */
import { bootstrap } from './bootstrap.js';

bootstrap().catch((e) => {
  console.error('راه‌اندازی ناموفق:', e);
  process.exit(1);
});
