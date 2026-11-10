# فصل ۱۸ — پروژهٔ پایانی بخش پایه و دستور پخت قابلیت

> **خلاصه:** این فصل یک قابلیت کامل را از Migration تا UI و تست طراحی
> می‌کند و چند «دستور پخت» برای کارهای رایج می‌دهد. هدف این است که پس از
> دوره بتوانید بدون کپی‌کردن کورکورانه، یک تغییر سازگار اضافه کنید.
>
> **نرم‌افزارها:** همهٔ اجزای قبلی؛ این فصل آن‌ها را به هم وصل می‌کند.

---

## ۱. پروژهٔ پایانی: «پایان گارانتی تجهیز»

این قابلیت نمونه است و در نسخهٔ فعلی پروژه وجود ندارد. آن را در یک شعبهٔ
تمرینی پیاده کنید، نه روی دادهٔ تولید.

### هدف

- ثبت تاریخ پایان گارانتی برای هر تجهیز.
- نمایش در صفحهٔ جزئیات.
- فیلتر «گارانتی نزدیک به پایان».
- تست و مستندات.

### گام ۱ — Migration

در `server/db.js`:

```js
export const SCHEMA_VERSION = 23;

function applyDeviceWarrantyMigration() {
  if (!hasColumn('devices', 'warranty_until')) {
    db.exec('ALTER TABLE devices ADD COLUMN warranty_until INTEGER');
  }
}

const MIGRATIONS = [
  // ...
  { version: 23, name: 'device-warranty', up: applyDeviceWarrantyMigration },
];
```

قواعد:

- مقدار epoch میلی‌ثانیه یا `NULL`.
- گام idempotent.
- آزمون ارتقا از 22 و نصب تازه.
- Changelog/Database docs.

### گام ۲ — Store/API

- `serializeDevice` فیلد `warrantyUntil`.
- ورودی Create/Update را validate کنید (عدد یا null).
- فیلتر `warranty=expiring` را در `buildDeviceWhere` اضافه کنید.
- Query باید پارامتر باشد.

```js
if (f.warranty === 'expiring') {
  where.push('d.warranty_until IS NOT NULL AND d.warranty_until <= ?');
  params.push(Date.now() + 30 * 86400000);
}
```

### گام ۳ — Frontend

- `types.ts`: `warrantyUntil?: number | null`.
- `DeviceForm`: ورودی تاریخ.
- `DeviceDetail`: نمایش و هشدار.
- `Devices`: فیلتر.
- `format.ts`: نمایش تاریخ (میلادی/شمسی).

### گام ۴ — تست

| تست | انتظار |
| --- | --- |
| Migration از 22 | ستون ساخته شود |
| Create با تاریخ | ذخیره و برگشت |
| تاریخ نامعتبر | 400 |
| فیلتر expiring | فقط موارد نزدیک |
| Viewer | فقط خواندن |
| UI | نمایش درست |

```bash
env -u PORT node --test server/tests/unit/db-migration.test.mjs
env -u PORT node --experimental-strip-types --test server/tests/integration/api.test.mjs
env -u PORT npm run typecheck
env -u PORT npm run test:web
```

### گام ۵ — مستندات

- `docs/database.md` و `docs/fa/05-database.md`.
- `docs/changelog.md` و `docs/fa/17-changelog.md`.
- `docs/fa/06-api.md`.
- `docs/verification-report.md` با نتایج واقعی.

---

## ۲. دستور پخت: افزودن Endpoint

1. Router مناسب.
2. `requirePermission` دقیق.
3. ورودی را validate کنید.
4. منطق در Store/Domain.
5. Audit اگر حساس است.
6. تست 401/403/200/400.
7. مستند API.

---

## ۳. دستور پخت: افزودن صفحه

1. فایل در `web/src/pages`.
2. Route در `App.tsx`.
3. API/Type.
4. منو در `Layout.tsx`.
5. مجوز و Empty/Loading/Error.
6. `typecheck` و `test:web`.
7. E2E در صورت نیاز.

---

## ۴. دستور پخت: افزودن لایهٔ نقشه

1. فایل `.mbtiles` را در `data/mbtiles` بگذارید.
2. از UI لایه بسازید.
3. API وجود فایل را بررسی کند.
4. نوع/زوم/style درست.
5. حذف فایل فعال مسدود باشد.
6. تست MBTiles.

---

## ۵. دستور پخت: افزودن مجوز

1. مجوز را به `ALL_PERMISSIONS` اضافه کنید.
2. نقش مناسب را مشخص کنید.
3. آیا قابل تفویض است؟ فقط در `DELEGABLE_PERMISSIONS` اگر واقعاً لازم است.
4. Router را guard کنید.
5. UI را با `can()` هماهنگ کنید.
6. RBAC Matrix و Credentials test را به‌روز کنید.
7. مستندات RBAC.

> اصل حداقل دسترسی: اگر شک دارید، مجوز را به Operator ندهید.

---

## ۶. دستور پخت: تغییر Backup

1. جزء جدید را در manifest تعریف کنید.
2. checksum و size.
3. verify.
4. stage/restore.
5. سازگاری با پشتیبان قدیمی.
6. تست Backup ناقص و Restore خالی.
7. مستندات.

---

## ۷. Code Review Checklist

### داده

- [ ] Migration idempotent و نسخه بالا رفته.
- [ ] Query پارامترized.
- [ ] ایندکس لازم.
- [ ] تراکنش/ Rollback.
- [ ] دادهٔ یتیم.

### امنیت

- [ ] مجوز دقیق.
- [ ] CSRF/Origin.
- [ ] ورودی validate.
- [ ] Secret در Log نیست.
- [ ] فایل امن.

### Frontend

- [ ] Type به‌روز.
- [ ] Loading/Error/Empty.
- [ ] RTL/موبایل.
- [ ] مجوز UI.
- [ ] Lazy Load.

### کیفیت

- [ ] Unit/Integration.
- [ ] Regression.
- [ ] Lint/Typecheck/Build.
- [ ] مستندات/Changelog.
- [ ] هیچ تست ناموفقی نادیده گرفته نشده.

---

## ۸. تمرین نهایی

1. قابلیت گارانتی را در شعبهٔ تمرینی پیاده کنید.
2. حداقل ۵ تست بنویسید.
3. یک Backup/Restore با دادهٔ جدید بگیرید.
4. یک Code Review روی تغییرات خود انجام دهید.
5. گزارش کوتاه بنویسید: چه تغییر کرد، چه تستی اجرا شد، چه محدودیتی ماند.

---

## ۹. چک‌لیست پایان پروژه

- [ ] Migration با نسخهٔ جدید و idempotent است.
- [ ] API ورودی را validate و مجوز را بررسی می‌کند.
- [ ] Type و UI به‌روز شده‌اند.
- [ ] حالت Loading/Error/Empty و RTL بررسی شده است.
- [ ] Unit/Integration/Typecheck پاس شده‌اند.
- [ ] Backup/Restore با Schema جدید تست شده است.
- [ ] مستندات، API و Changelog به‌روز شده‌اند.
- [ ] محدودیت‌ها و تست‌های اجرانشده صادقانه گزارش شده‌اند.

---

## ۱۰. جمع‌بندی بخش پایه

NetWatch از چند اصل ساده ساخته شده است:

1. **یک منبع حقیقت** برای Config، Schema و Permission.
2. **تراکنش** برای هر تغییر چندمرحله‌ای.
3. **اعتبارسنجی در مرز** و منطق در دامنه.
4. **امنیت در سرور**، نه فقط UI.
5. **تست واقعی** برای رفتار واقعی.
6. **مستندسازی هم‌زمان با تغییر**.

اگر این اصول را رعایت کنید، می‌توانید قابلیت تازه اضافه کنید بدون اینکه
داده، امنیت یا پایداری نسخهٔ فعلی را بشکنید.

---

## ۱۱. مسیر بعدی

اکنون پایه‌های موتور، داده، امنیت و انتشار را دارید. بخش بعدی دوره به
ماژول‌های محصول می‌پردازد:

- [فصل ۱۹ — چرخهٔ تجهیز و ورود گروهی](19-devices-inventory-import-export.md)
- [فصل ۲۰ — هشدارها، تعمیرات و حادثه](20-alerts-maintenance-incidents.md)
- [فصل ۲۱ — گزارش‌ها و داشبورد](21-reports-dashboard-analytics.md)
- [فصل ۲۲ — نقشه و دیاگرام](22-maps-markers-diagrams.md)
- [فصل ۲۳ — خزانهٔ اعتبارنامه و حسابرسی](23-credentials-audit.md)
- [فصل ۲۴ — مدیریت، سلامت و عملیات](24-admin-operations-health.md)

منابع مرجع:

- [راهنمای سریع توسعه](../16-development.md)
- [معماری](../02-architecture.md)
- [پایگاه‌داده](../05-database.md)
- [API](../06-api.md)
- [امنیت](../08-security.md)
- [آزمون‌ها](../14-testing.md)
- [گزارش راستی‌آزمایی](../../verification-report.md)

---

**فصل بعد:** [چرخهٔ تجهیز، دارایی و ورود گروهی](19-devices-inventory-import-export.md)
