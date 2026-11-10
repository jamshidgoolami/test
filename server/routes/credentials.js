/**
 * NetWatch — API خزانهٔ رمز عبور
 * ----------------------------------------------------------------
 * مجوزها تفکیک شده‌اند:
 *   • credentials:read    فهرست/جزئیات، بررسی امنیت (بدون خود رمز)
 *   • credentials:write   ساخت، ویرایش، حذف، تولید رمز، ورود از فایل
 *   • credentials:reveal  خواندن خود رمز و خروجی گرفتن (لاگ می‌شود، کش نمی‌شود)
 *
 * هیچ پاسخی رمز را در فهرست یا جزئیات برنمی‌گرداند؛ تنها مسیر صریح reveal و
 * خروجی Excel این کار را می‌کنند و پاسخشان `no-store` است. عملیات تغییردهنده
 * به‌صورت خودکار در Audit Log ثبت می‌شوند؛ خواندن reveal و خروجی هم اکشن
 * اختصاصی خودشان را دارند.
 */
import express from 'express';
import { routePermission, requirePermission, isAdmin } from '../permissions.js';
import { createRateLimiter } from '../rate-limit.js';
import { assessSecret } from '../credential-strength.js';
import { generateSecret, GENERATOR_LIMITS, normalizeGeneratorOptions } from '../password-generator.js';
import { spreadsheetUpload } from '../upload.js';
import { buildCredentialWorkbook, normalizeCredentialKey, parseBuffer, workbookToBuffer } from '../impexp.js';
import {
  CREDENTIAL_KINDS,
  checkupCredentials,
  createCredential,
  credentialExportRows,
  credentialSummary,
  deleteCredential,
  existingSecrets,
  getCredential,
  importCredentials,
  importDeviceCredentials,
  listCredentials,
  markRotated,
  recheckStrengths,
  revealCredential,
  updateCredential,
} from '../credentials.js';

const router = express.Router();

router.use(routePermission({ read: 'credentials:read', write: 'credentials:write' }));

// نمایش رمز و خروجی گرفتن پرمخاطره‌ترین عملیات این ماژول‌اند؛ سقف نرخ جداگانه
// دارند تا حتی یک حساب مجاز هم نتواند خزانه را پشت‌سرهم خالی کند.
const revealLimiter = createRateLimiter({
  name: 'نمایش رمز',
  windowMs: 60000,
  max: 40,
  accountKey: (req) => req.user?.id ?? null,
});

const exportLimiter = createRateLimiter({
  name: 'خروجی رمزها',
  windowMs: 60000,
  max: 6,
  accountKey: (req) => req.user?.id ?? null,
});

const PAGE_MAX = 100;

function fail(res, error, fallback = 'خطا در انجام عملیات رمز عبور.') {
  res.status(Number(error?.status) || 400).json({ error: String(error?.message || fallback) });
}

function downloadStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

/* ------------------------------ خواندن ------------------------------ */

router.get('/', (req, res) => {
  try {
    res.json(
      listCredentials({
        search: req.query.search,
        deviceId: req.query.deviceId ? Number(req.query.deviceId) : null,
        kind: req.query.kind,
        weak: req.query.weak,
        due: req.query.due,
        sort: req.query.sort,
        page: req.query.page,
        pageSize: Math.min(PAGE_MAX, Number(req.query.pageSize) || 20),
      })
    );
  } catch (e) {
    fail(res, e, 'خواندن فهرست رمزها ممکن نشد.');
  }
});

router.get('/summary', (_req, res) => {
  try {
    res.json(credentialSummary());
  } catch (e) {
    fail(res, e, 'خلاصهٔ خزانه خوانده نشد.');
  }
});

router.get('/kinds', (_req, res) => {
  res.json({ items: CREDENTIAL_KINDS, generator: GENERATOR_LIMITS });
});

/** بررسی امنیت: ضعیف، تکراری و افشاشده — بدون بازگرداندن رمزها */
router.get('/checkup', (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(checkupCredentials());
  } catch (e) {
    fail(res, e, 'بررسی امنیت رمزها ممکن نشد.');
  }
});

/**
 * خروجی Excel/CSV از خزانه.
 * چون فایل شامل رمزهای خام است، مجوز صریح reveal می‌خواهد، سقف نرخ دارد و
 * پاسخ هیچ‌جا کش نمی‌شود. عملیات در Audit Log با `credential.export` ثبت می‌شود.
 */
router.get('/export', requirePermission('credentials:reveal'), exportLimiter, (req, res) => {
  try {
    const format = String(req.query.format || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
    const workbook = buildCredentialWorkbook(credentialExportRows());
    const buffer = workbookToBuffer(workbook, format);
    res.setHeader(
      'Content-Type',
      format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="netwatch-passwords-${downloadStamp()}.${format}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(buffer));
  } catch (e) {
    fail(res, e, 'ساخت فایل خروجی ممکن نشد.');
  }
});

router.get('/:id', (req, res) => {
  try {
    const credential = getCredential(req.params.id);
    if (!credential) return res.status(404).json({ error: 'رمز عبور یافت نشد' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(credential);
  } catch (e) {
    fail(res, e, 'خواندن رمز عبور ممکن نشد.');
  }
});

/** خواندن خود رمز. هر بار در Audit Log ثبت و سقف نرخ اعمال می‌شود. */
router.get('/:id/reveal', requirePermission('credentials:reveal'), revealLimiter, (req, res) => {
  try {
    const revealed = revealCredential(req.params.id);
    if (!revealed) return res.status(404).json({ error: 'رمز عبور یافت نشد' });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.json(revealed);
  } catch {
    res.status(500).json({
      error: 'رمزگشایی ممکن نشد؛ کلید رمزنگاری را بررسی کنید.',
      code: 'DECRYPT_FAILED',
    });
  }
});

/* ------------------------- تولید و ابزارها ------------------------- */

router.post('/generate', (req, res) => {
  try {
    const options = normalizeGeneratorOptions(req.body || {});
    // «منحصربه‌فرد» بودن پیش‌فرض است: رمز تازه با رمزهای موجود مقایسه می‌شود.
    const ensureUnique = req.body?.unique !== false;
    const used = ensureUnique ? existingSecrets() : null;
    let generated = generateSecret(options);
    let unique = true;
    if (used) {
      let attempts = 0;
      while (used.has(generated.value) && attempts < 12) {
        generated = generateSecret(options);
        attempts += 1;
      }
      unique = !used.has(generated.value);
    }
    res.json({
      ...generated,
      options,
      unique,
      assessment: assessSecret(generated.value),
    });
  } catch (e) {
    fail(res, e, 'تولید رمز ممکن نشد.');
  }
});

/** ورود گروهی از فایل Excel/CSV؛ هر ردیف مستقل ثبت می‌شود. */
router.post('/import', spreadsheetUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایلی دریافت نشد.' });
  try {
    const parsed = parseBuffer(req.file.buffer, req.file.originalname, normalizeCredentialKey);
    if (!parsed.rows.length) {
      return res.status(400).json({ error: 'فایل هیچ ردیف قابل‌خواندنی ندارد.' });
    }
    const result = importCredentials(parsed.rows, req.user?.username ?? '');
    res.json({ fileName: req.file.originalname, ...result });
  } catch (e) {
    res.status(Number(e?.status) || 400).json({ error: String(e?.message || 'خواندن فایل ممکن نشد.') });
  }
});

router.post('/recheck', (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'این عملیات فقط برای مدیر سیستم مجاز است.' });
  try {
    res.json(recheckStrengths());
  } catch (e) {
    fail(res, e, 'بازمحاسبهٔ قدرت رمزها ممکن نشد.');
  }
});

/** انتقال یک‌بارهٔ رمز فعلی تجهیزات؛ تکرار آن دادهٔ تکراری نمی‌سازد. */
router.post('/import-devices', (req, res) => {
  try {
    res.json(importDeviceCredentials(req.user?.username ?? ''));
  } catch (e) {
    fail(res, e, 'انتقال رمز تجهیزات ممکن نشد.');
  }
});

/* ------------------------------ نوشتن ------------------------------ */

router.post('/', (req, res) => {
  try {
    const created = createCredential(req.body || {}, req.user?.username ?? '');
    res.status(201).json(created);
  } catch (e) {
    fail(res, e, 'ثبت رمز عبور ممکن نشد.');
  }
});

router.patch('/:id', (req, res) => {
  try {
    const updated = updateCredential(req.params.id, req.body || {}, req.user?.username ?? '');
    if (!updated) return res.status(404).json({ error: 'رمز عبور یافت نشد' });
    res.json(updated);
  } catch (e) {
    fail(res, e, 'ویرایش رمز عبور ممکن نشد.');
  }
});

router.post('/:id/rotated', (req, res) => {
  try {
    const updated = markRotated(req.params.id, { rotateEveryDays: req.body?.rotateEveryDays });
    if (!updated) return res.status(404).json({ error: 'رمز عبور یافت نشد' });
    res.json(updated);
  } catch (e) {
    fail(res, e, 'ثبت چرخش رمز ممکن نشد.');
  }
});

router.delete('/:id', (req, res) => {
  try {
    if (!deleteCredential(req.params.id)) return res.status(404).json({ error: 'رمز عبور یافت نشد' });
    res.status(204).end();
  } catch (e) {
    fail(res, e, 'حذف رمز عبور ممکن نشد.');
  }
});

export default router;
