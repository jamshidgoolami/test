# فصل ۷ — HTTP API، Middleware و Job

> **خلاصه:** این فصل نشان می‌دهد یک API امن در NetWatch چگونه ساخته می‌شود:
> Router، اعتبارسنجی، مجوز، پاسخ خطا، Audit، صف Probe و کارهای سنگین.
> خروجی فصل یک Endpoint قابل تست با قرارداد روشن است.
>
> **نرم‌افزارها:** Express 5، Multer (آپلود)، `probe-queue.js`،
> `jobs.js` و Worker، `node:test`.

---

## ۱. ساختار یک Router

```js
import express from 'express';
import { requirePermission, routePermission } from '../permissions.js';
import { db } from '../db.js';

const router = express.Router();

router.use(routePermission({ read: 'inventory:read', write: 'inventory:write' }));

router.get('/layers', (_req, res) => {
  const items = db.prepare('SELECT * FROM map_layers ORDER BY id').all();
  res.json({ items });
});

router.delete('/layers/:id', requirePermission('inventory:write'), (req, res) => {
  // ...
});

export default router;
```

`routePermission` بر اساس متد تصمیم می‌گیرد؛ عملیات حساس‌تر مجوز دقیق‌تری
می‌گیرند.

---

## ۲. قرارداد پاسخ

| وضعیت | معنی | نمونه |
| --- | --- | --- |
| 200 | موفق | `{ items: [...] }` |
| 201 | ساخته شد | `{ id, name }` |
| 202 | Job پذیرفته شد | `{ jobId, statusUrl }` |
| 400 | ورودی نامعتبر | `{ error: '...' }` |
| 401 | بدون نشست | `{ error: '...' }` |
| 403 | بدون مجوز | `{ error: '...' }` |
| 404 | پیدا نشد | `{ error: '...' }` |
| 409 | تعارض | `{ error: '...', layers: [...] }` |
| 413 | حجم زیاد | `{ error: '...' }` |
| 415 | Content-Type | `{ error: '...' }` |
| 429 | سقف نرخ | `Retry-After` |
| 500 | خطای داخلی | پیام عمومی، جزئیات در لاگ |
| 503 | ظرفیت/سرویس | `Retry-After` |

پاسخ موفق نباید فیلد حساس (رمز، توکن، مسیر فایل) داشته باشد. APIها
`Cache-Control: no-store` می‌گیرند.

---

## ۳. مجوز در Router

```js
import { requirePermission } from '../permissions.js';

router.get(
  '/:id/credentials',
  requirePermission('devices:write', 'credentials:reveal'),
  (req, res) => {
    // فقط با هر دو مجوز
  }
);
```

`requirePermission(...permissions)` یعنی **همهٔ** آن‌ها لازم‌اند. برای «یکی
از چند» باید منطق صریح بنویسید.

---

## ۴. صف Probe

Probeهای API (دستی، زنده و گروهی) از `probe-queue.js` عبور می‌کنند:

| تنظیم | پیش‌فرض | معنی |
| --- | --- | --- |
| `NETWATCH_PROBE_CONCURRENCY` | 4 | سقف هم‌زمانی |
| `NETWATCH_PROBE_QUEUE_MAX` | 64 | ظرفیت انتظار |
| `NETWATCH_PROBE_TIMEOUT_MS` | 45000 | مهلت سخت |

مزایا:

- مجموع عملیات هم‌زمان کران‌دار است.
- درخواست تکراری با کلید یکسان به همان Promise وصل می‌شود.
- با Abort، سوکت/فرآیند رها نمی‌شود.
- خاموشی تمیز انجام می‌شود.

نمونهٔ الگوی Bulk:

```js
router.post('/devices/bulk', async (req, res) => {
  const { ids, action } = req.body;
  if (!Array.isArray(ids) || ids.length > 500) {
    return res.status(413).json({ error: 'حداکثر ۵۰۰ تجهیز در هر درخواست.' });
  }
  if (action !== 'ping') {
    return res.status(400).json({ error: 'عملیات پشتیبانی نمی‌شود.' });
  }
  const job = probeQueue.submit(...);
  res.status(202).json({
    jobId: job.id,
    statusUrl: `/api/devices/bulk/probe/${job.id}`,
  });
});
```

---

## ۵. Job و Worker

کارهای سنگین (Import/Export بزرگ، MBTiles، گزارش) در `jobs.js` اجرا
می‌شوند:

- صف با سقف هم‌زمانی.
- Worker جدا برای پردازش فایل.
- Timeout و Abort.
- آمار `queued/running/rejected`.
- خاموشی تمیز.

قاعده: کار طولانی را در Handler اصلی `await` نکنید؛ Job بسازید و وضعیت
قابل پیگیری برگردانید.

---

## ۶. آپلود فایل

```js
import multer from 'multer';
// محدودیت حجم، نوع و مسیر موقت در upload.js
```

قواعد:

- فایل در `data/tmp` با مجوز محدود نوشته شود.
- نوع از محتوا (magic bytes) تشخیص داده شود.
- پسوند و MIME اعلامی مرورگر کافی نیست.
- فایل نهایی با نام تولیدی و `0600` ذخیره شود.
- فایل موقت پس از خطا پاک شود.

---

## ۷. خطا و Audit

```js
router.post('/widgets', requirePermission('inventory:write'), (req, res, next) => {
  try {
    const widget = createWidget(req.body);
    req.audit?.({ action: 'widget.create', targetId: widget.id });
    res.status(201).json(widget);
  } catch (e) {
    next(e);
  }
});
```

- `auditMutations` در سطح اپلیکیشن بسیاری از تغییرات را ثبت می‌کند.
- برای عملیات خاص، Audit دقیق‌تر اضافه کنید.
- خطا را به هندلر مرکزی بدهید تا شکل پاسخ یکسان بماند.

---

## ۸. آزمون Endpoint

حداقل موارد:

1. بدون نشست → 401
2. نقش کم‌مجوز → 403
3. ورودی نامعتبر → 400
4. مسیر موفق → 200/201
5. منبع ناموجود → 404
6. تعارض → 409
7. Audit در صورت حساس بودن

```js
const res = await api(server.base, 'POST', '/api/devices/bulk', {
  ids: [1, 2],
  action: 'ping',
});
assert.equal(res.status, 202);
assert.ok(res.data.jobId);
```

---

## ۹. تمرین

1. یک Endpoint ساده برای فهرست یک منبع بسازید.
2. مجوز خواندن/نوشتن آن را تعیین کنید.
3. برای آن تست 401/403/200 بنویسید.
4. یک Job فرضی طراحی کنید و `statusUrl` آن را توضیح دهید.

---

## ۱۰. چک‌لیست پایان فصل

- [ ] ساختار Router و مجوز را می‌دانم.
- [ ] Status Code درست را انتخاب می‌کنم.
- [ ] Probe/Job سنگین را در صف می‌برم.
- [ ] آپلود را از محتوا اعتبارسنجی می‌کنم.
- [ ] خطا را به هندلر مرکزی می‌دهم.
- [ ] برای Endpoint تست امنیتی می‌نویسم.

**فصل بعد:** [Auth، Session و RBAC](08-auth-session-rbac.md)
