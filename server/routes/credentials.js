/**
 * NetWatch — API مخزن اعتبارنامهٔ تجهیزات
 * ----------------------------------------------------------------
 * مجوزها تفکیک شده‌اند:
 *   • credentials:read    فهرست/جزئیات (بدون رمز)
 *   • credentials:write   ساخت، ویرایش، حذف، تولید رمز، انتقال از تجهیزات
 *   • credentials:reveal  خواندن خود رمز (لاگ می‌شود، کش نمی‌شود، سقف نرخ دارد)
 *
 * هیچ پاسخی رمز را در فهرست یا جزئیات برنمی‌گرداند؛ تنها مسیر صریح reveal این
 * کار را می‌کند و پاسخش `no-store` است. عملیات تغییردهنده به‌صورت خودکار در
 * Audit Log ثبت می‌شوند و خواندن reveal هم با اکشن `credential.reveal`.
 */
import express from 'express';
import { routePermission, requirePermission, isAdmin } from '../permissions.js';
import { createRateLimiter } from '../rate-limit.js';
import { assessSecret } from '../credential-strength.js';
import { generateSecret, GENERATOR_LIMITS, normalizeGeneratorOptions } from '../password-generator.js';
import {
  CREDENTIAL_KINDS,
  createCredential,
  credentialSummary,
  deleteCredential,
  getCredential,
  importDeviceCredentials,
  listCredentials,
  markRotated,
  recheckStrengths,
  revealCredential,
  updateCredential,
} from '../credentials.js';

const router = express.Router();

router.use(routePermission({ read: 'credentials:read', write: 'credentials:write' }));

// نمایش رمز پرمخاطره‌ترین عمل این ماژول است؛ سقف نرخ جداگانه دارد تا حتی یک
// حساب مجاز هم نتواند مخزن را پشت‌سرهم خالی کند.
const revealLimiter = createRateLimiter({
  name: 'نمایش رمز',
  windowMs: 60000,
  max: 40,
  accountKey: (req) => req.user?.id ?? null,
});

const PAGE_MAX = 100;

function fail(res, error, fallback = 'خطا در انجام عملیات اعتبارنامه.') {
  res.status(Number(error?.status) || 400).json({ error: String(error?.message || fallback) });
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
    fail(res, e, 'خواندن فهرست اعتبارنامه‌ها ممکن نشد.');
  }
});

router.get('/summary', (_req, res) => {
  try {
    res.json(credentialSummary());
  } catch (e) {
    fail(res, e, 'خلاصهٔ مخزن اعتبارنامه خوانده نشد.');
  }
});

router.get('/kinds', (_req, res) => {
  res.json({ items: CREDENTIAL_KINDS, generator: GENERATOR_LIMITS });
});

router.get('/:id', (req, res) => {
  try {
    const credential = getCredential(req.params.id);
    if (!credential) return res.status(404).json({ error: 'اعتبارنامه یافت نشد' });
    res.json(credential);
  } catch (e) {
    fail(res, e, 'خواندن اعتبارنامه ممکن نشد.');
  }
});

/** خواندن خود رمز. هر بار در Audit Log ثبت و سقف نرخ اعمال می‌شود. */
router.get('/:id/reveal', requirePermission('credentials:reveal'), revealLimiter, (req, res) => {
  try {
    const revealed = revealCredential(req.params.id);
    if (!revealed) return res.status(404).json({ error: 'اعتبارنامه یافت نشد' });
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
    const generated = generateSecret(options);
    res.json({
      ...generated,
      options,
      assessment: assessSecret(generated.value),
    });
  } catch (e) {
    fail(res, e, 'تولید رمز ممکن نشد.');
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

/** انتقال یک‌بارهٔ اعتبارنامهٔ فعلی تجهیزات؛ تکرار آن دادهٔ تکراری نمی‌سازد. */
router.post('/import-devices', (req, res) => {
  try {
    res.json(importDeviceCredentials(req.user?.username ?? ''));
  } catch (e) {
    fail(res, e, 'انتقال اعتبارنامهٔ تجهیزات ممکن نشد.');
  }
});

/* ------------------------------ نوشتن ------------------------------ */

router.post('/', (req, res) => {
  try {
    const created = createCredential(req.body || {}, req.user?.username ?? '');
    res.status(201).json(created);
  } catch (e) {
    fail(res, e, 'ثبت اعتبارنامه ممکن نشد.');
  }
});

router.patch('/:id', (req, res) => {
  try {
    const updated = updateCredential(req.params.id, req.body || {}, req.user?.username ?? '');
    if (!updated) return res.status(404).json({ error: 'اعتبارنامه یافت نشد' });
    res.json(updated);
  } catch (e) {
    fail(res, e, 'ویرایش اعتبارنامه ممکن نشد.');
  }
});

router.post('/:id/rotated', (req, res) => {
  try {
    const updated = markRotated(req.params.id, { rotateEveryDays: req.body?.rotateEveryDays });
    if (!updated) return res.status(404).json({ error: 'اعتبارنامه یافت نشد' });
    res.json(updated);
  } catch (e) {
    fail(res, e, 'ثبت چرخش رمز ممکن نشد.');
  }
});

router.delete('/:id', (req, res) => {
  try {
    if (!deleteCredential(req.params.id)) return res.status(404).json({ error: 'اعتبارنامه یافت نشد' });
    res.status(204).end();
  } catch (e) {
    fail(res, e, 'حذف اعتبارنامه ممکن نشد.');
  }
});

export default router;
