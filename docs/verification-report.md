# گزارش راستی‌آزمایی، اصلاحات و وضعیت باگ‌ها

این سند نتیجهٔ **اجرای واقعی** آزمون‌ها، فهرست تغییرات، وضعیت هر باگ ممیزی و
محدودیت‌های باقی‌مانده را ثبت می‌کند. هر عدد این‌جا از خروجی همان اجرا گرفته شده
است؛ موردی که اجرا نشده با برچسب «اجرا نشده» آمده و PASS فرض نشده است.

| مورد | مقدار |
| --- | --- |
| تاریخ اجرا | ۲۰۲۶-۱۱-۱۲ |
| شاخه | `main` (`7816599`) |
| Node.js | `v26.10.0` (پیش‌نیاز پروژه `>= 22.12.0`) |
| سیستم‌عامل | macOS (Darwin) |
| نسخهٔ نرم‌افزار | `1.4.1` |
| نسخهٔ ساختار داده | `SCHEMA_VERSION = 23` |

---

## ۱. نتیجهٔ واقعی فرمان‌ها

| فرمان | نتیجه | جزئیات |
| --- | --- | --- |
| `npm run lint` | ✅ PASS (exit 0) | کل مخزن، بدون خطا |
| `npm run typecheck` | ✅ PASS (exit 0) | `tsc -p web/tsconfig.json --noEmit` |
| `npm run build` | ✅ PASS | Vite، خروجی در `web/dist` |
| `npm run test:unit` | ✅ ۳۲۱ / ۳۲۱ | `fail 0` |
| `npm run test:web` | ✅ ۶۵ / ۶۵ | `fail 0` |
| `npm run test:integration` | ✅ ۱۵۹ / ۱۵۹ | `fail 0` |
| `npm run test:e2e` | ✅ PASS | smoke ۸۹ / ۸۹، e2e ۱۱ / ۱۱ |
| `npm run test:ui` | ✅ ۱۰ / ۱۰ | Playwright با Google Chrome نصب‌شدهٔ سیستم؛ مرورگر bundled نصب نبود |
| `npm run test:heavy` | ⏸ اجرا نشده | آزمون ۵۰٬۰۰۰ ردیفی/طولانی |
| `npm run qa:load` / `qa:soak72` | ⏸ اجرا نشده | نیازمند اجرای طولانی روی سرور اختصاصی |

جمع بررسی‌های موفق: **۶۵۵** (۳۲۱ Unit + ۶۵ Web + ۱۵۹ Integration + ۸۹
Smoke + ۱۱ E2E + ۱۰ UI).

> در محیط شل این دستگاه متغیر `PORT=0` تنظیم بود؛ اجرای آزمون‌ها با
> `env -u PORT ...` انجام شد. `PORT=0` برای سرور معتبر نیست و به‌صورت خطای
> پیکربندی رد می‌شود.

---

## ۲. آزمون‌های هدفمند اصلاحات

| آزمون | نتیجه | پوشش |
| --- | --- | --- |
| `server/tests/integration/credentials-api.test.mjs` | ✅ ۱۱ / ۱۱ | Operator بدون `credentials:reveal`؛ ۴۰۳ برای reveal/export/اعتبارنامهٔ تجهیز؛ رد اعطای مجوز دیگر؛ دسترسی پس از grant و ۴۰۳ پس از revoke |
| `server/tests/integration/rbac-matrix.test.mjs` | ✅ ۵ / ۵ | ماتریس نقش‌ها و مسیرهای اعتبارنامه |
| `server/tests/integration/endpoints.test.mjs` | ✅ ۹ / ۹ | حذف فایل MBTiles ناموجود → ۴۰۴ |
| `server/tests/integration/mbtiles-layers.test.mjs` | ✅ ۳ / ۳ | جلوگیری از حذف فایل فعال، نبود رکورد بدون فایل، staging حذف مشترک |
| `server/tests/integration/diagram-links.test.mjs` | ✅ ۳ / ۳ | پیوند دوطرفه، Revision، ظرفیت/Rollback، حذف و پاک‌سازی ارجاع |
| `server/tests/unit/diagram-prune.test.mjs` | ✅ ۱ / ۱ | پاک‌سازی یال‌ها و ارجاع‌های شکسته |
| `server/tests/unit/db-backup-restore.test.mjs` | ✅ ۹ / ۹ | Backup/Restore پیوست، کلید، checksum و Backup ناقص |
| `server/tests/integration/backup-complete.test.mjs` | ✅ ۲ / ۲ | Restore روی `DATA_DIR` خالی و توقف روی Backup ناقص |
| `server/tests/unit/db-query-plan.test.mjs` | ✅ ۵ / ۵ | کارایی پرس‌وجوها و بازبینی درج SQL |
| `server/tests/unit/engine-detection.test.mjs` + `engine-flap.test.mjs` | ✅ ۹ / ۹ | گذار وضعیت، آستانه‌ها، ضدتکرار و Flapping |

---

## ۳. تغییرات کلیدی

### ۳.۱ امنیت دسترسی‌ها

| فایل | تغییر |
| --- | --- |
| `server/permissions.js` | حذف پیش‌فرض `credentials:reveal` از Operator؛ افزودن `DELEGABLE_PERMISSIONS`، `normalizeExtraPermissions` و `permissionsForUser`؛ `hasPermission` مجوز اختصاصی را می‌بیند |
| `server/db-constants.js` | `SCHEMA_VERSION = 23`؛ بازصادرشده از `server/db.js`؛ Migration 22 (`user-extra-permissions`) و Migration 23 (`device-tags-reverse-index`) |
| `server/auth.js` | خواندن/نوشتن مجوز اختصاصی، اعتبارسنجی آن، اعطا/لغو با `PUT /auth/users/:id` و بازگرداندن مجوزهای مؤثر در `/auth/me` |
| `server/routes/credentials.js` | reveal/export فقط با `credentials:reveal` |
| `server/routes/devices.js` | `GET /api/devices/:id/credentials` علاوه بر `devices:write` مجوز `credentials:reveal` می‌خواهد |
| `web/src/lib/types.ts`, `web/src/lib/api.ts` | افزودن `extraPermissions` به تایپ کاربر و ساخت کاربر |
| `web/src/pages/DeviceDetail.tsx` | پنهان‌کردن نمایش/کپی رمز بدون مجوز و نمایش راهنما |
| `web/src/pages/Settings.tsx` | اعطا/لغو «اجازهٔ نمایش رمز» توسط Administrator |

تنها مجوز قابل تفویض `credentials:reveal` است؛ از این مسیر هیچ مجوز مدیریتی
دیگری باز نمی‌شود. Operator پیش‌فرض به رمز واقعی دسترسی ندارد.

### ۳.۲ Backup و Restore

| فایل | تغییر |
| --- | --- |
| `server/backup.js` | پشتیبان‌گیری `data/attachments/`؛ کپی مستقل کلید در `secrets/device-credentials.key` با مجوز `0600`؛ checksum و verify؛ stage/restore پیوست‌ها و کلید؛ `tableCounts` شامل credentials/attachments؛ خطای مشخص برای Backup ناقص |
| `server/credential-crypto.js` | مسیر `CREDENTIAL_KEY_FILE`، `credentialKeySource()` و `resetCredentialKeyCache()` |
| `server/scripts/db-backup.mjs` | خلاصهٔ attachments و منبع کلید در خروجی CLI |

Restore ابتدا دیتابیس و فایل‌های MBTiles و پیوست‌ها را stage/verify می‌کند و
کلید رمزنگاری را آخر از همه نصب می‌کند. Backupهای قدیمی بدون بخش‌های جدید
همچنان معتبرند. اگر Backup ناقص باشد، Restore پیش از تغییر `DATA_DIR` متوقف
می‌شود.

### ۳.۳ فایل‌های MBTiles

| فایل | تغییر |
| --- | --- |
| `server/routes/inventory.js` | `layersUsingFile`/`mbtilesFileExists`؛ اعتبارسنجی create/update؛ حذف لایه و فایل در تراکنش؛ `DELETE /mbtiles/files/:name` با ۴۰۹ برای فایل در استفاده و ۴۰۴ برای ناموجود |

حذف فایل در حال استفاده مسدود می‌شود. حذف لایهٔ دارای فایل مشترک با نام موقت
`.deleting-<uuid>` مرحله‌بندی می‌شود، رکورد در تراکنش حذف می‌شود و در خطا نام
فایل برمی‌گردد. رکورد لایهٔ بدون فایل ساخته یا به‌روزرسانی نمی‌شود.

### ۳.۴ ارتباط دیاگرام‌ها

| فایل | تغییر |
| --- | --- |
| `server/routes/diagrams.js` | `assertLinkCapacity`، `ensureReciprocalLink(..., {strict:true})`، تراکنش create/update/delete/content، `cleanDiagramGraph` و `cleanupDiagramReferences` |

ایجاد/حذف پیوند دوطرفه در یک تراکنش انجام می‌شود، ظرفیت و اعتبار هر دو
دیاگرام پیش از ذخیره بررسی می‌شود، در خطا هر دو طرف Rollback می‌شوند و Revision
هر دو به‌روزرسانی می‌شود. ارتباط یک‌طرفه یا ناسازگار باقی نمی‌ماند.

### ۳.۵ حذف دیاگرام و دادهٔ یتیم

| فایل | تغییر |
| --- | --- |
| `server/routes/diagrams.js` | حذف دیاگرام با stage/commit پیوست‌ها؛ پاک‌سازی ارجاع‌های `type:'diagram'` در بوم‌های دیگر؛ حذف یال‌های معلق؛ افزایش Revision بوم‌های متأثر؛ `pruneBrokenDiagramLinks()` |
| `server/index.js` | اجرای `pruneBrokenDiagramLinks()` در Startup با try/catch و لاگ |

حذف اطلاعات و اصلاح ارتباطات در یک تراکنش است؛ ارجاع خارجی به دیاگرام حذف‌شده
باقی نمی‌ماند و بوم‌های وابسته Revision تازه می‌گیرند.

### ۳.۶ پایداری و بازبینی SQL

| فایل | تغییر |
| --- | --- |
| `server/engine.js` | جلوگیری از Rollback بررسی هنگام برخورد یکتای `(device_id, started_at)` با انتخاب زمان شروع یکتا و retry محدود |
| `server/routes/dashboard.js` | حذف درج متن SQL پویا از `labelSql`/`groupMemberships`؛ استفاده از پارامتر `CASE` و زیرپرس‌وجوی ثابت |

این دو مورد در اجرای کامل Unit به‌عنوان شکست واقعی دیده شدند و بدون تضعیف
assertionها اصلاح شدند.

### ۳.۷ مستندات و نسخه

- `package.json` و `package-lock.json` → `1.4.1`.
- هماهنگ‌سازی `SCHEMA_VERSION = 23` و Migration ۲۳ در `docs/database.md`، `docs/fa/05-database.md`،
  `docs/fa/01-introduction.md`، `docs/fa/15-upgrade-release.md` و READMEها.
- مستندسازی سقف‌های ۵۰۰۰/۵۰۰/۴۰۰۰، پاسخ `413`، ایندکس معکوس تگ و پاک‌سازی
  مسیرهای مطلق در پاسخ‌های سلامت/پشتیبان/Verify/Restore.
- به‌روزرسانی `docs/security.md`، `docs/fa/08-security.md`،
  `docs/session-rbac-policy.md`، `docs/backup-restore.md`،
  `docs/fa/11-backup-restore.md`، `docs/fa/06-api.md`، `docs/changelog.md` و
  `docs/fa/17-changelog.md`.

---

## ۴. اصلاح آزمون‌های محیطی/ناپایدار

در جریان اجرای کامل، سه شکست مربوط به خود آزمون‌ها (نه منطق محصول) پیدا و
اصلاح شد:

1. `sse-load.test.mjs` فقط `/proc/<pid>/status` لینوکس را می‌خواند. اندازه‌گیری
   RSS با `ps` برای macOS نیز اضافه شد؛ آستانه‌ها تغییر نکردند.
2. `probe-bulk.test.mjs` در حالت `simulate` وضعیت دقیق `online` را انتظار داشت،
   در حالی که تأخیر/قطعی شبیه‌سازی تصادفی است. اکنون ثبت نمونه و هم‌خوانی
   وضعیت نمونه با تجهیز بررسی می‌شود؛ این همان هدف آزمون صف است.
3. `dashboard.js` و `engine.js` شکست‌های واقعی Unit را نشان دادند و اصلاح شدند
   (بخش ۳.۶).

---

## ۵. محدودیت‌ها و ریسک‌های باقی‌مانده

1. **Soak ۷۲ ساعته اجرا نشده** — هارنس آماده است؛ حکم نهایی نشت حافظه/سوکت
   پس از اجرای واقعی روی سرور هدف صادر می‌شود.
2. **مرورگر bundled در Playwright نصب نشد** — دانلود Chromium کامل نشد؛ UI E2E
   با Google Chrome نصب‌شدهٔ سیستم اجرا و ۱۰/۱۰ پاس شد. مرورگرهای Firefox/Safari
   آزمون خودکار ندارند.
4. **ICMP** به مجوز و ابزار سیستم وابسته است؛ `auto` در نبود ICMP به TCP سقوط
   می‌کند و باید در هر محیط استقرار بازبینی شود.
5. **مقیاس افقی** با SQLite ممکن نیست (BUG-13)؛ برای چند نمونه به پایگاه‌دادهٔ
   شبکه‌ای و محدودیت توزیع‌شده نیاز است.
6. **رمزنگاری سکون دیتابیس** وجود ندارد؛ کلید اعتبارنامه‌ها جدا نگهداری می‌شود،
   اما امنیت فایل‌های Backup به کنترل دسترسی میزبان/مسیر وابسته است. نسخهٔ
   پشتیبان باید در محل امن و جدا از کلید نگهداری شود.
7. **بدون اعلان بیرونی** (ایمیل/SMS/Webhook)؛ اعلان درون برنامه است.
8. **ظرفیت و اشغال لینک** پس از حذف SNMP تنها به‌صورت پهنای باند اسمی ثبت
   می‌شود؛ هیچ عدد مصرفی حدس زده نمی‌شود.
9. **Benchmark عملکرد جدید اجرا نشد**؛ اعداد `performance-report.md` مربوط به
   فاز ۵ و محیط Linux قبلی‌اند. تغییرات این نسخه عمدتاً امنیت/یکپارچگی داده است
   و ادعای بهبود عملکرد جدید نمی‌شود.

---

## ۶. بازتولید نتایج

```bash
npm ci
env -u PORT npm run lint
env -u PORT npm run typecheck
env -u PORT npm run build
env -u PORT npm run test:unit
env -u PORT npm run test:web
env -u PORT npm run test:integration
env -u PORT npm run test:e2e
```

`npm run verify` همین زنجیره را پشت‌سرهم می‌آورد. در محیط این اجرا `PORT=0`
تنظیم بود؛ آن را برای آزمون‌ها حذف کنید تا سرور از پورت معتبر استفاده کند.
