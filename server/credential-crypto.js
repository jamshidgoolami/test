/**
 * NetWatch — رمزنگاری اعتبارنامهٔ تجهیزات
 * ----------------------------------------------------------------
 * نام کاربری و رمز عبور تجهیزات برای نمایش/کپی به مدیر لازم‌اند؛ بنابراین
 * هش‌کردن یک‌طرفه پاسخ نمی‌دهد. این ماژول با AES-256-GCM آن‌ها را رمز می‌کند
 * تا فایل پایگاه‌داده به‌تنهایی برای خواندن اعتبارنامه‌ها کافی نباشد.
 *
 *   • کلید از `NETWATCH_CREDENTIAL_KEY` (hex 64 نویسه یا base64 ۳۲ بایت) خوانده
 *     می‌شود؛ اگر تنظیم نشده باشد، یک‌بار در `<DATA_DIR>/device-credentials.key`
 *     با مجوز 0600 ساخته می‌شود.
 *   • کلید هرگز در پایگاه‌داده یا لاگ نوشته نمی‌شود.
 *   • هر مقدار nonce تصادفی ۱۲ بایتی و auth tag جدا دارد؛ تغییر بایت‌ها هنگام
 *     رمزگشایی خطا می‌دهد و نتیجهٔ خراب برنمی‌گرداند.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = 'v1';
const KEY_FILE = path.join(config.dataDir, 'device-credentials.key');
let cachedKey = null;

function parseKey(raw, source) {
  const value = String(raw || '').trim();
  let key;
  if (/^[0-9a-f]{64}$/i.test(value)) key = Buffer.from(value, 'hex');
  else key = Buffer.from(value, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`${source} باید ۳۲ بایت کلید باشد (۶۴ نویسهٔ hex یا base64).`);
  }
  return key;
}

function readKeyFile() {
  try {
    return parseKey(fs.readFileSync(KEY_FILE, 'utf8'), 'فایل کلید اعتبارنامه');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
  const generated = crypto.randomBytes(KEY_BYTES);
  let fd;
  try {
    // wx از بازنویسی کلید توسط فرآیند دیگری جلوگیری می‌کند. اگر همان لحظه
    // فرآیند دیگری فایل را ساخته باشد، همان کلید موجود خوانده می‌شود.
    fd = fs.openSync(KEY_FILE, 'wx', 0o600);
    fs.writeSync(fd, `${generated.toString('base64')}\n`);
    fs.fsyncSync(fd);
    return generated;
  } catch (e) {
    if (e.code === 'EEXIST') {
      return parseKey(fs.readFileSync(KEY_FILE, 'utf8'), 'فایل کلید اعتبارنامه');
    }
    throw e;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** @returns {Buffer} کلید ۳۲ بایتی؛ بار اول از env یا فایل خوانده/ساخته می‌شود. */
export function credentialKey() {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.NETWATCH_CREDENTIAL_KEY;
  cachedKey = fromEnv && String(fromEnv).trim() ? parseKey(fromEnv, 'NETWATCH_CREDENTIAL_KEY') : readKeyFile();
  return cachedKey;
}

/** رمزنگاری یک مقدار متنی؛ رشتهٔ خالی به‌صورت خالی می‌ماند. */
export function encryptSecret(value) {
  if (value === null || value === undefined || value === '') return '';
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/** رمزگشایی مقدار ذخیره‌شده؛ قالب/کلید نامعتبر خطا می‌دهد. */
export function decryptSecret(payload) {
  const raw = String(payload || '');
  if (!raw) return '';
  const parts = raw.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error('قالب اعتبارنامهٔ رمزنگاری‌شده نامعتبر است.');
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('اعتبارنامهٔ رمزنگاری‌شده آسیب دیده است.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', credentialKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * برای فهرست‌ها: خطای رمزگشایی یک ردیف نباید کل صفحه را خراب کند. مقدار خالی
 * برگردانده می‌شود و رمز عبور همچنان از مسیر صریح credentials خوانده می‌شود.
 */
export function tryDecryptSecret(payload) {
  try {
    return decryptSecret(payload);
  } catch {
    return '';
  }
}
