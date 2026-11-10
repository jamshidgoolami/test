# فصل ۶ — Store، Validation، Audit و Retention

> **خلاصه:** این فصل لایهٔ دامنه را توضیح می‌دهد: چگونه Queryها و
> سریال‌سازی در Store جمع می‌شوند، اعتبارسنجی کجا انجام می‌شود، تغییرات
> حساس چگونه Audit می‌شوند و Retention چگونه دادهٔ قدیمی را بدون شکستن
> گزارش‌ها حذف می‌کند.
>
> **نرم‌افزارها:** `server/store.js`، `server/audit.js`،
> `server/retention.js`، SQLite.

---

## ۱. چرا Store؟

اگر هر Router مستقیم SQL بنویسد:

- قواعد فیلتر تکرار می‌شوند؛
- شکل پاسخ بین صفحه‌ها فرق می‌کند؛
- تست دامنه سخت می‌شود؛
- خطر SQL Injection بالا می‌رود.

Store یک مرز روشن می‌سازد:

```text
HTTP Request
  → Router (اعتبارسنجی ورودی)
  → Store/Domain (Query، قاعده، تراکنش)
  → SQLite
```

---

## ۲. الگوی Parse → Build → Query

```js
export function parseListQuery(q = {}) {
  return {
    page: Math.max(1, parseInt(q.page || '1', 10) || 1),
    pageSize: Math.min(500, Math.max(1, parseInt(q.pageSize || '24', 10) || 24)),
    search: (q.search || '').trim(),
    status: q.status ? String(q.status) : '',
    sort: DEVICE_SORTS[q.sort] ? q.sort : 'name',
    order: String(q.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC',
  };
}
```

- Parse: نوع و محدوده را نرمال می‌کند.
- Build: شرط و پارامترها را می‌سازد.
- Query: فقط با پارامتر اجرا می‌کند.

هیچ‌گاه `sort` خام را در SQL نگذارید:

```js
// نادرست
db.prepare(`SELECT * FROM devices ORDER BY ${req.query.sort}`);

// درست
const column = DEVICE_SORTS[req.query.sort] || 'd.name';
db.prepare(`SELECT * FROM devices ORDER BY ${column}`);
```

نام ستون از یک **فهرست بسته** آمده است؛ مقدار همیشه پارامتر است.

---

## ۳. سریال‌سازی

Store باید شکل API را پایدار نگه دارد:

```js
export function serializeDevice(row, tags = [], groupName = null, groups = []) {
  return {
    id: row.id,
    name: row.name,
    ip: row.ip,
    status: row.status,
    hasAccessPassword: Boolean(row.access_password_enc),
    // رمز هرگز این‌جا برنمی‌گردد
  };
}
```

قواعد:

- فیلد حساس را حذف کنید، نه اینکه در کلاینت پنهان کنید.
- `snake_case` دیتابیس را به `camelCase` API تبدیل کنید.
- مقدار `null` و `undefined` را آگاهانه انتخاب کنید.
- تغییر نام فیلد، آزمون Contract را می‌شکند؛ این ویژگی است.

---

## ۴. اعتبارسنجی دامنه‌ای

```js
function cleanExtraPermissions(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw Object.assign(new Error('فهرست مجوزهای اختصاصی نامعتبر است.'), {
      status: 400,
    });
  }
  const allowed = new Set(DELEGABLE_PERMISSIONS);
  const invalid = value.map(String).find((item) => !allowed.has(item));
  if (invalid) {
    throw Object.assign(
      new Error(`مجوز «${invalid}» قابل‌اعطا نیست...`),
      { status: 400 }
    );
  }
  return normalizeExtraPermissions(value);
}
```

- نوع، طول، بازه و مقدار مجاز را بررسی کنید.
- پیام خطا برای کاربر قابل‌فهم باشد.
- ورودی خام را هرگز مستقیم در Query نگذارید.
- برای فایل، magic bytes و حجم را بررسی کنید (فصل ۱۵).

---

## ۵. Audit

`server/audit.js` تغییرات و خواندن‌های حساس را ثبت می‌کند:

- Login/Logout/Setup/User management
- Settings update
- Credential reveal/export/import
- Backup/Restore
- Probe و Export
- حذف داده

نمونهٔ ساده:

```js
logEvent('info', 'auth_user_updated', {
  username: row.username,
  role,
  extraPermissions,
  by: req.user.username,
});
```

قواعد:

- مقدار Secret را ثبت نکنید؛ فقط نام کلید.
- شکست را هم ثبت کنید.
- خطای Audit نباید پاسخ اصلی را خراب کند.
- جزئیات را محدود کنید تا جدول بی‌سقف رشد نکند.

---

## ۶. Retention

Retention دادهٔ قدیمی را طبق سیاست حذف می‌کند:

| داده | سیاست نمونه |
| --- | --- |
| `samples` | نگه‌داری N روز |
| `outages` | نگه‌داری N روز |
| `alerts` | نگه‌داری N روز |
| `audit_log` | نگه‌داری N روز |
| `engine_log` | نگه‌داری N روز |
| `daily_stats` | طولانی‌تر برای گزارش |

نکات:

- Dry-Run قبل از حذف واقعی.
- حذف Batchی تا قفل نوشتن طولانی نشود.
- اجرای هم‌زمان با قفل و وضعیت مشخص.
- حذف `samples` نباید خلاصهٔ روزانه را از بین ببرد.

```bash
npm run db:retention
```

---

## ۷. Import/Export

فایل‌های CSV/Excel از مسیر Job عبور می‌کنند:

- پیش‌نمایش قبل از ثبت.
- سقف حجم و تعداد ردیف.
- اعتبارسنجی هر ردیف.
- تراکنش نهایی.
- خروجی با PDF/Excel/CSV.

برای فایل سنگین، Worker استفاده می‌شود تا Event Loop قفل نشود.

---

## ۸. آزمون دامنه

- Unit: توابع خالص Parse/Serialize/Normalize.
- Integration: API واقعی با DATA_DIR موقت.
- Contract: شکل پاسخ با تایپ‌های Frontend.
- Regression: فیلتر، صفحه‌بندی، حذف و Audit.

```bash
env -u PORT npm run test:unit
env -u PORT npm run test:integration
```

---

## ۹. تمرین

1. یک فیلتر تازه برای تجهیزات طراحی کنید و آن را به `buildDeviceWhere`
   اضافه کنید؛ همهٔ مقادیر باید پارامتر باشند.
2. یک تابع `serialize` را با فیلد حساس فرضی بررسی کنید.
3. یک رویداد Audit برای تغییر تنظیمات پیشنهاد دهید.
4. سیاست Retention برای `samples` را با گزارش ۹۰ روزه مقایسه کنید.

---

## ۱۰. چک‌لیست پایان فصل

- [ ] مرز Router/Store/Domain را می‌دانم.
- [ ] فیلتر و Sort را امن می‌سازم.
- [ ] فیلد حساس را در سریال‌سازی حذف می‌کنم.
- [ ] Audit را برای عملیات حساس اضافه می‌کنم.
- [ ] Retention را با گزارش‌ها هماهنگ می‌کنم.
- [ ] برای دامنه تست Unit/Integration می‌نویسم.

**فصل بعد:** [HTTP API، Middleware و Job](07-http-api-middleware-jobs.md)
