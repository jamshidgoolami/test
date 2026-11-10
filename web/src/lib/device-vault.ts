/**
 * NetWatch — قفل رمزگذاری‌شده روی دستگاه (On-device Encryption)
 * ----------------------------------------------------------------
 * گوگل پسورد منیجر کل خزانه را با کلیدی که روی خود دستگاه ساخته می‌شود قفل
 * می‌کند. این ماژول همان ایده را برای برنامهٔ وب پیاده می‌کند، بدون اینکه کلید
 * یا عبارت عبور جایی ذخیره شود:
 *
 *   • کاربر یک «عبارت عبور دستگاه» انتخاب می‌کند.
 *   • با PBKDF2‑SHA256 (۳۱۰٬۰۰۰ تکرار) و نمک تصادفی ۱۶ بایتی، ۳۲ بایت کلید
 *     مشتق می‌شود و فقط هشِ آن (verifier) همراه نمک در IndexedDB می‌ماند.
 *   • خود عبارت عبور و خود کلید هرگز ذخیره، ارسال یا لاگ نمی‌شوند.
 *   • تا قفل باز نشود، نمایش/کپی/ویرایش رمزها در رابط کاربری ممکن نیست.
 *
 * این قفل، لایهٔ محلی است؛ رمزها در پایگاه‌داده هم با AES‑256‑GCM رمزنگاری
 * شده‌اند و این قفل جای آن رمزنگاری را نمی‌گیرد.
 */

const DB_NAME = 'nw-device-vault';
const STORE = 'meta';
const RECORD_KEY = 'lock';
const PBKDF2_ITERATIONS = 310000;

export interface DeviceLockRecord {
  salt: string;
  verifier: string;
  iterations: number;
  createdAt: number;
}

/** Web Crypto فقط در بستر امن (HTTPS یا localhost) در دسترس است. */
export function isDeviceLockSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof indexedDB !== 'undefined' &&
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined'
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('دسترسی به حافظهٔ مرورگر ممکن نشد.'));
  });
}

async function readRecord(): Promise<DeviceLockRecord | null> {
  const db = await openDb();
  try {
    return await new Promise<DeviceLockRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(RECORD_KEY);
      request.onsuccess = () => resolve((request.result as DeviceLockRecord | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('خواندن قفل دستگاه ممکن نشد.'));
    });
  } finally {
    db.close();
  }
}

async function writeRecord(record: DeviceLockRecord | null): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      if (record) store.put(record, RECORD_KEY);
      else store.delete(RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('ذخیرهٔ قفل دستگاه ممکن نشد.'));
      tx.onabort = () => reject(tx.error ?? new Error('ذخیرهٔ قفل دستگاه ممکن نشد.'));
    });
  } finally {
    db.close();
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** مقایسهٔ زمان‌ثابت برای جلوگیری از افشای الگوی تطبیق */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

async function deriveVerifier(passphrase: string, salt: Uint8Array, iterations: number): Promise<string> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    material,
    256
  );
  const digest = await crypto.subtle.digest('SHA-256', bits);
  return toBase64(new Uint8Array(digest));
}

/** رکورد قفل این مرورگر؛ null یعنی رمزنگاری روی دستگاه فعال نیست. */
export async function getDeviceLock(): Promise<DeviceLockRecord | null> {
  if (!isDeviceLockSupported()) return null;
  return readRecord();
}

/** فعال‌سازی قفل دستگاه با عبارت عبور جدید (حداقل ۸ نویسه). */
export async function enableDeviceLock(passphrase: string): Promise<DeviceLockRecord> {
  if (!isDeviceLockSupported()) {
    throw new Error('رمزنگاری روی دستگاه در این مرورگر پشتیبانی نمی‌شود (به اتصال امن HTTPS نیاز دارد).');
  }
  if (String(passphrase).length < 8) {
    throw new Error('عبارت عبور دستگاه باید حداقل ۸ نویسه باشد.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const verifier = await deriveVerifier(passphrase, salt, PBKDF2_ITERATIONS);
  const record: DeviceLockRecord = {
    salt: toBase64(salt),
    verifier,
    iterations: PBKDF2_ITERATIONS,
    createdAt: Date.now(),
  };
  await writeRecord(record);
  return record;
}

/** بررسی عبارت عبور دستگاه؛ اگر قفلی نباشد true برمی‌گردد. */
export async function verifyDeviceLock(passphrase: string): Promise<boolean> {
  const record = await getDeviceLock();
  if (!record) return true;
  const verifier = await deriveVerifier(passphrase, fromBase64(record.salt), record.iterations);
  return safeEqual(verifier, record.verifier);
}

/** برداشتن قفل از این مرورگر (دادهٔ سرور دست‌نخورده می‌ماند). */
export async function disableDeviceLock(): Promise<void> {
  if (!isDeviceLockSupported()) return;
  await writeRecord(null);
}
