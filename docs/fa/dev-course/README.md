# دورهٔ توسعهٔ NetWatch

> نسخهٔ مرجع: **1.4.1** · ساختار داده: **SCHEMA_VERSION = 25** · تاریخ به‌روزرسانی: ۲۰۲۶-۱۱-۱۳

این دورهٔ **۲۴ فصلی** برای توسعه‌دهنده‌ای نوشته شده است که می‌خواهد NetWatch
را از پایه بفهمد، اجرا کند، تغییر بدهد و قابلیت تازه اضافه کند. مسیر دوره از
نصب و مفاهیم پایه آغاز می‌شود و به موتور پایش، امنیت، Backup، تست و استقرار
می‌رسد؛ سپس همهٔ ماژول‌های محصول — تجهیزات، هشدارها، گزارش‌ها، نقشه، دیاگرام،
خزانهٔ رمز و مدیریت — را با جزئیات پیاده‌سازی پوشش می‌دهد.

هر فصل یک قرارداد ثابت دارد:

1. **خلاصه** — این فصل چه چیزی را حل می‌کند.
2. **ابزارها و کتابخانه‌ها** — چه نرم‌افزاری در این بخش استفاده شده است.
3. **مفاهیم از پایه** — پیش‌نیاز ذهنی.
4. **کد واقعی پروژه** — مسیر فایل و قطعه‌کد.
5. **تمرین** — کاری که باید خودتان انجام دهید.
6. **عیب‌یابی و چک‌لیست**.

---

## ۱. این دوره برای چه کسی است؟

| سطح | پیش‌نیاز | خروجی |
| --- | --- | --- |
| تازه‌کار | آشنایی مقدماتی با JavaScript و خط فرمان | اجرای پروژه، فهم ساختار و اولین تغییر |
| توسعه‌دهندهٔ میانی | آشنایی با HTTP، React و SQL | افزودن API، صفحه، Migration و تست |
| توسعه‌دهندهٔ ارشد | تجربهٔ Node.js و طراحی سیستم | تغییر موتور، امنیت، Backup و استقرار |

اگر JavaScript نمی‌دانید، قبل از فصل ۲ یک مرور سریع روی `let/const`، تابع،
`async/await`، ماژول ESM و شیء انجام دهید. دوره فرض می‌کند Git و خط فرمان را
می‌شناسید.

---

## ۲. نرم‌افزارها و کتابخانه‌های پروژه

| ابزار | نسخه/نوع | نقش در NetWatch | فصل‌های مرتبط |
| --- | --- | --- | --- |
| Node.js | `>= 22.12` | اجرای Backend، تست و ابزارها | ۱، ۲، ۱۴ |
| npm + `package-lock.json` | lockfile v3 | نصب تکرارپذیر وابستگی‌ها | ۱ |
| Express | ۵ | HTTP API و میدل‌ورها | ۷ |
| `node:sqlite` | داخلی Node | پایگاه‌دادهٔ فایل SQLite، WAL و Transaction | ۴، ۵ |
| ESM | `type: "module"` | ماژول‌های Backend | ۲، ۳ |
| `@node-rs/argon2` | ۲ | هش رمز عبور | ۸ |
| React | ۱۹ | رابط کاربری SPA | ۱۲ |
| React Router | ۷ | مسیرهای سمت کلاینت | ۱۲ |
| TypeScript | ۷ | تایپ‌های Frontend | ۱۲ |
| Vite | ۸ | Dev Server و Build | ۱، ۱۲ |
| Tailwind CSS | ۴ | استایل و طراحی RTL | ۱۳ |
| Recharts | ۳ | نمودارهای داشبورد و گزارش | ۱۳ |
| Leaflet | ۱.۹ | نقشهٔ تعاملی | ۱۳ |
| MapLibre GL | ۶ | لایه‌های برداری/MBTiles | ۱۳ |
| `@xyflow/react` | ۱۲ | بوم دیاگرام و پیوندها | ۱۳ |
| Lucide React | ۱.۵۹ | آیکن‌ها | ۱۳ |
| `xlsx` | ۰.۲۰ | Import/Export اکسل | ۷، ۱۳ |
| PDFKit | ۰.۱۷ | تولید PDF گزارش | ۷ |
| Multer | ۲ | آپلود فایل | ۷، ۱۱ |
| `bidi-js` | ۱.۱ | پردازش متن دوجهته | ۱۳ |
| `html-to-image` | ۱.۱۱ | خروجی تصویری دیاگرام | ۱۳ |
| Vazirmatn | فونت محلی | نمایش فارسی آفلاین | ۱۲، ۱۳ |
| `node:test` | داخلی Node | تست Unit/Integration | ۱۴ |
| Playwright | ۱.۵۵ | تست UI و E2E مرورگری | ۱۴ |
| ESLint | ۱۰ | قواعد کیفیت کد | ۳، ۱۴ |
| Git/GitHub | — | نسخه‌بندی و انتشار | ۱۷ |
| OpenSSL | ابزار سیستم | ساخت CA/گواهی در `tls:setup` | ۱۷ |
| `ping` سیستمی | ابزار سیستم | Probe ICMP | ۹ |

> نسخه‌های بالا از `package.json` همین مخزن گرفته شده‌اند. پیش از ارتقای هر
> کتابخانه، `npm run verify` و مستندات سازگاری را بررسی کنید.

---

## ۳. نقشهٔ فصل‌ها

### بخش الف — پایه‌ها

| فصل | عنوان | خلاصه |
| --- | --- | --- |
| ۱ | [راه‌اندازی و ابزارها](01-setup-and-tooling.md) | نصب، اجرا، پورت، `DATA_DIR` و اولین ورود |
| ۲ | [معماری و چرخهٔ درخواست](02-architecture-and-request-lifecycle.md) | Boot، میدل‌ور، Router، دامنه، DB و خاموشی |
| ۳ | [قواعد کد و خطا](03-code-conventions.md) | ESM، TypeScript، `DbError`، اعتبارسنجی و Audit |

### بخش ب — داده

| فصل | عنوان | خلاصه |
| --- | --- | --- |
| ۴ | [SQLite، Migration و Transaction](04-sqlite-migrations-transactions.md) | WAL، Schema 22، تراکنش و Prepared Statement |
| ۵ | [Schema، Query و Index](05-schema-queries-indexes.md) | جدول‌ها، روابط، ایندکس و Query Plan |
| ۶ | [Store، Validation و Audit](06-domain-store-validation.md) | لایهٔ دامنه، فیلترها، Audit و Retention |

### بخش ج — Backend

| فصل | عنوان | خلاصه |
| --- | --- | --- |
| ۷ | [HTTP API، Middleware و Job](07-http-api-middleware-jobs.md) | Express، قرارداد پاسخ، صف و کار سنگین |
| ۸ | [Auth، Session و RBAC](08-auth-session-rbac.md) | Argon2، کوکی، نقش‌ها، مجوز اختصاصی و Credentials |
| ۹ | [موتور پایش](09-monitoring-engine.md) | صف زمان‌بندی، Probe، وضعیت، Outage، Alert و Fencing |
| ۱۰ | [SSE و ارتباط زنده](10-sse-realtime.md) | Event bus، اشتراک کلاینت، Backpressure و Reconnect |
| ۱۱ | [Backup، Restore و فایل‌ها](11-backup-restore-files.md) | Manifest، Checksum، کلید، MBTiles و Restore خالی |

### بخش د — Frontend

| فصل | عنوان | خلاصه |
| --- | --- | --- |
| ۱۲ | [پایه‌های React و TypeScript](12-react-frontend-foundations.md) | Providerها، Router، API Client، Auth و State |
| ۱۳ | [UI، نقشه، دیاگرام و نمودار](13-ui-maps-diagrams-charts.md) | Tailwind، RTL، MapLibre، XYFlow و Recharts |

### بخش ه — کیفیت

| فصل | عنوان | خلاصه |
| --- | --- | --- |
| ۱۴ | [استراتژی تست](14-testing-strategy.md) | Unit، Web، Integration، E2E و Playwright |
| ۱۵ | [سخت‌سازی امنیتی](15-security-hardening.md) | CSRF، XSS، SQLi، فایل، Secret و RBAC |
| ۱۶ | [عملکرد و Observability](16-performance-observability.md) | Query Plan، WAL، SSE، Health، Log و Soak |

### بخش و — تحویل

| فصل | عنوان | خلاصه |
| --- | --- | --- |
| ۱۷ | [استقرار، ارتقا و انتشار](17-deploy-upgrade-release.md) | Build، TLS، Proxy، Offline، Backup و Versioning |
| ۱۸ | [پروژهٔ پایانی بخش پایه و دستور پخت قابلیت](18-capstone-extension-recipes.md) | افزودن یک قابلیت کامل از Migration تا تست |

### بخش ز — قابلیت‌های محصول و بهره‌برداری

| فصل | عنوان | خلاصه |
| --- | --- | --- |
| ۱۹ | [چرخهٔ تجهیز، دارایی و ورود گروهی](19-devices-inventory-import-export.md) | مدل تجهیز، اعتبارسنجی، فیلتر، Bulk، Import/Export و پیوست |
| ۲۰ | [هشدارها، تعمیرات و مدیریت حادثه](20-alerts-maintenance-incidents.md) | قانون هشدار، تأخیر، cooldown، سکوت، پنجرهٔ تعمیرات و MTTR |
| ۲۱ | [گزارش‌ها، داشبورد و تحلیل داده](21-reports-dashboard-analytics.md) | بازه، فرمول‌ها، کش، شاخص سلامت، ویجت و خروجی |
| ۲۲ | [نقشه، نشانه‌ها و دیاگرام شبکه](22-maps-markers-diagrams.md) | MBTiles، آپلود امن، لایه، نشانه، گراف و Revision |
| ۲۳ | [خزانهٔ اعتبارنامه و حسابرسی](23-credentials-audit.md) | AES-GCM، مجوز reveal، سنجش قدرت، Checkup و Audit |
| ۲۴ | [مدیریت، سلامت و عملیات پیشرفته](24-admin-operations-health.md) | تنظیمات، کاربران، Health، Backup/Restore، Retention و Runbook |

---

## ۴. مسیرهای پیشنهادی

### مسیر ۴ روزه — آشنایی و اولین تغییر

| روز | فصل‌ها | هدف |
| --- | --- | --- |
| ۱ | ۱، ۲ | اجرای پروژه و فهم معماری |
| ۲ | ۳، ۴، ۵ | فهم داده و Migration |
| ۳ | ۷، ۸ | ساخت یک API امن |
| ۴ | ۱۲، ۱۴ | افزودن صفحه و تست |

### مسیر ۲ هفته‌ای — توسعهٔ کامل

هفتهٔ اول: فصل‌های ۱ تا ۹. هفتهٔ دوم: ۱۰ تا ۱۸. هر فصل را با تمرین همان فصل
تمام کنید؛ خواندن بدون اجرا کافی نیست.

### مسیر ۳ هفته‌ای — پوشش کامل محصول

| هفته | فصل‌ها | خروجی |
| --- | --- | --- |
| ۱ | ۱ تا ۸ | پروژه اجرا، داده و API امن |
| ۲ | ۹ تا ۱۸ | موتور، SSE، فرانت، تست، Backup و انتشار |
| ۳ | ۱۹ تا ۲۴ | تجهیزات، هشدار، گزارش، نقشه، خزانه و عملیات |

### مسیر ۶ روزه — برای تیم محصول

| روز | فصل‌ها | هدف |
| --- | --- | --- |
| ۱ | ۱، ۲، ۱۲ | اجرا و معماری |
| ۲ | ۱۹ | چرخهٔ تجهیز و ورود گروهی |
| ۳ | ۹، ۲۰ | پایش، هشدار و تعمیرات |
| ۴ | ۲۱ | داشبورد و گزارش |
| ۵ | ۲۲، ۲۳ | نقشه/دیاگرام و خزانهٔ رمز |
| ۶ | ۲۴، ۱۴ | عملیات و تست |

> فصل‌های ۱۹ تا ۲۴ مستقل از هم خواندنی‌اند، اما برای درک کامل به فصل‌های
> داده و API (۵، ۷) تکیه می‌کنند.

---

## ۵. قواعد ثابت دوره

- **کد نمونه از مخزن واقعی است.** اگر نام فایل یا تابع تغییر کرد، فصل مربوط را
  به‌روز کنید.
- **هیچ رازی در مستندات نیست.** رمز، توکن، کلید و `.env` واقعی نمونه نمی‌آوریم.
- **پیام‌های فارسی، کد انگلیسی.** نام متغیرها و APIها انگلیسی می‌مانند.
- **تست قبل از اعلام پایان.** هر تغییر باید حداقل یک آزمون متناسب داشته باشد.
- **تغییر کوچک، تست کوچک.** برای یک اصلاح ساده کل Suite سنگین اجرا نکنید؛ اما
  برای Migration، امنیت و تراکنش، آزمون هدفمند الزامی است.

---

## ۶. دستورهای روزمره

```bash
npm ci                 # نصب تکرارپذیر
npm run dev            # سرور توسعه (پورت پیش‌فرض 3000 در --dev)
npm run dev:web        # Vite روی 3000
npm run build          # ساخت web/dist
npm run typecheck      # TypeScript
npm run lint           # ESLint
npm run test:unit
npm run test:web
npm run test:integration
npm run test:e2e
npm run test:ui        # Playwright
```

> در محیط این مخزن ممکن است `PORT=0` تنظیم شده باشد. برای آزمون‌ها از
> `env -u PORT npm run test:unit` استفاده کنید؛ `PORT=0` برای سرور معتبر نیست.
> تست UI به مرورگر Playwright نیاز دارد؛ اگر مرورگر bundled نصب نیست، با
> Chrome سیستم یا `npx playwright install chromium` اجرا کنید.

---

## ۷. منابع مرتبط

- [معماری](../02-architecture.md)
- [پایگاه‌داده](../05-database.md)
- [API](../06-api.md)
- [Frontend](../07-frontend.md)
- [امنیت](../08-security.md)
- [موتور](../09-engine.md)
- [آزمون‌ها](../14-testing.md)
- [راهنمای سریع توسعه](../16-development.md)
- [گزارش راستی‌آزمایی](../../verification-report.md)

---

## ۸. خلاصهٔ یک‌صفحه‌ای

NetWatch یک فرآیند Node.js است که API، SPA، SSE و موتور پایش را کنار هم دارد.
داده در یک فایل SQLite با WAL ذخیره می‌شود و رابط کاربری React از همان Origin
تغذیه می‌شود. امنیت با Session + CSRF + RBAC و سقف نرخ اعمال می‌شود. موتور با
`next_check_at` صف می‌سازد، Probe را با سقف هم‌زمانی اجرا می‌کند و نتیجه را در
یک تراکنش ثبت می‌کند. Backup شامل دیتابیس، MBTiles، پیوست‌ها و کلید است و
Restore با Verify و Stage انجام می‌شود. هر قابلیت جدید باید Migration، API،
تایپ، UI، تست و مستندات داشته باشد.
