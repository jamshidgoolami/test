/**
 * NetWatch — کمک‌کننده‌های ورودی/دسترسی تجهیزات
 * ----------------------------------------------------------------
 * منطق همگام‌سازی خزانهٔ رمز و نگاشت خطای فایل ورودی از Route جدا شده است.
 */
import { syncDeviceCredential } from '../credentials.js';

/**
 * نام کاربری/رمزی که در تب «دسترسی تجهیز» ذخیره می‌شود در «خزانهٔ رمز عبور»
 * هم نگه داشته می‌شود. خطای این همگام‌سازی نباید ذخیرهٔ تجهیز را شکست بدهد.
 */
export function syncVaultCredential(deviceId, body, actor) {
  if (!body || typeof body !== 'object') return;
  const hasUsername = Object.prototype.hasOwnProperty.call(body, 'access_username');
  const hasPassword = typeof body.access_password === 'string' && body.access_password !== '';
  const cleared =
    body.clear_access_password === true || body.clear_access_password === 1 || body.clear_access_password === '1';
  if (!hasUsername && !hasPassword && !cleared) return;
  try {
    syncDeviceCredential(
      deviceId,
      {
        username: hasUsername ? body.access_username : undefined,
        password: hasPassword ? body.access_password : undefined,
        cleared,
      },
      String(actor ?? '')
    );
  } catch (error) {
    console.error('همگام‌سازی رمز تجهیز با خزانهٔ رمز عبور ناموفق بود:', error);
  }
}

/**
 * خطای پردازش فایل ورودی خطای کاربر است، نه خطای داخلی سرور.
 * فقط کدهای زیرساختی (صف پر/مهلت/حجم) حفظ می‌شوند و بقیه ۴۰۰ هستند.
 */
export function importErrorStatus(error) {
  const status = Number(error?.status);
  return [413, 415, 429, 503, 504, 507].includes(status) ? status : 400;
}
