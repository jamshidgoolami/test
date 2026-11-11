/**
 * NetWatch — ثبت لاگ موتور در جدول engine_log.
 */
import { logEvent, sanitizeLogText } from './logger.mjs';

export function createLog({ db }) {
function log(level, message, ts = Date.now()) {
  // پیام ممکن است نام تجهیز/فایل کاربر را داشته باشد؛ نویسه‌های کنترلی پیش از
  // ذخیره و لاگ حذف می‌شوند تا Log Injection رخ ندهد.
  const safeMessage = sanitizeLogText(String(message ?? ''), 2000);
  db.prepare('INSERT INTO engine_log(ts, level, message) VALUES (?, ?, ?)').run(ts, level, safeMessage);
  message = safeMessage;
  // خطاها و هشدارها علاوه بر جدول، به‌صورت ساختاریافته روی خروجی سرور هم می‌روند
  // تا سرویس‌های پایش بیرونی بتوانند بدون خواندن پایگاه‌داده آن‌ها را ببینند.
  if (level === 'error' || level === 'warn') logEvent(level, 'db_log', { message, ts });
}


  return log;
}
