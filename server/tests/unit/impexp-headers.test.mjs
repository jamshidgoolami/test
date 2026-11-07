/**
 * سرستون‌های Excel — تگ‌ها و فیلدهای تازه باید از فایل خودِ برنامه خوانده شوند.
 *
 * پیش‌تر کلیدهای COLUMN_MAP نرمال نمی‌شدند و سرستون «تگ‌ها» (که نیم‌فاصله دارد)
 * به کلید ناشناختهٔ `تگ_ها` تبدیل می‌شد؛ نتیجه این بود که ورود گروهی، تگ‌های
 * نوشته‌شده در فایل را نادیده می‌گرفت. این آزمون همان رفت‌وبرگشت را می‌سنجد.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_HEADERS, buildWorkbook, workbookToBuffer, parseBuffer, templateRows, validateRows } from '../../impexp.js';

test('قالب خروجی خود برنامه با همان تگ‌ها و فیلدهای تازه دوباره قابل ورود است', () => {
  const buffer = workbookToBuffer(buildWorkbook(templateRows(), EXPORT_HEADERS), 'xlsx');
  const parsed = parseBuffer(buffer, 'devices.xlsx');
  const { valid, errors } = validateRows(parsed.rows, []);

  assert.equal(errors.length, 0);
  assert.equal(valid.length, 1);
  const row = valid[0];
  assert.deepEqual(row.tags, ['حیاتی', 'نقطه لبه'], 'تگ‌های ستون «تگ‌ها» باید خوانده شوند');
  assert.equal(row.mac_address, '00:1A:2B:3C:4D:5E');
  assert.equal(row.asset_tag, 'AST-10045');
  assert.equal(row.ping_interval, null, 'ستون «بازه بررسی (ثانیه)» باید شناخته شود');
  assert.equal(row.timeout_ms, null);
  assert.equal(row.monitoring_enabled, 1);
});

test('سرستون‌های رایج فارسی/انگلیسی با نیم‌فاصله، فاصله و یکا یکسان شناخته می‌شوند', () => {
  const csv =
    'نام تجهیز,آدرس IP,تگ ها,پلاک اموال,MAC Address,بازه بررسی (ثانیه),مانیتورینگ فعال\r\n' +
    'سوییچ ۱,10.1.1.1,"حیاتی، لبه",AST-1,aa:bb:cc:dd:ee:01,30,بله\r\n';
  const parsed = parseBuffer(Buffer.from(csv, 'utf8'), 'devices.csv');
  const { valid } = validateRows(parsed.rows, []);
  const row = valid[0];
  assert.deepEqual(row.tags, ['حیاتی', 'لبه']);
  assert.equal(row.asset_tag, 'AST-1');
  assert.equal(row.mac_address, 'AA:BB:CC:DD:EE:01');
  assert.equal(row.ping_interval, 30);
  assert.equal(row.monitoring_enabled, 1);
});

test('آدرس MAC نامعتبر ردیف را با پیام مشخص رد می‌کند', () => {
  const csv = 'name,ip,mac\r\nسوییچ,10.1.1.2,xyz\r\n';
  const parsed = parseBuffer(Buffer.from(csv, 'utf8'), 'devices.csv');
  const { valid, errors } = validateRows(parsed.rows, []);
  assert.equal(valid.length, 0);
  assert.match(errors[0].issues.join(' '), /MAC/);
});
