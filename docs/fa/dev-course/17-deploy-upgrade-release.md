# فصل ۱۷ — استقرار، ارتقا و انتشار

> **خلاصه:** این فصل مسیر تبدیل کد به یک نصب پایدار را توضیح می‌دهد:
> Build، پیکربندی تولید، TLS، Reverse Proxy، نصب آفلاین، ارتقا، Backup
> زمان‌بندی‌شده و نسخه‌گذاری.
>
> **نرم‌افزارها:** Node.js، npm، Vite، Nginx (نمونه)، OpenSSL،
> `release:prepare` و `release:artifact`، Git.

---

## ۱. Build تولیدی

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm run test:unit
npm run test:web
npm run test:integration
npm run test:e2e
```

خروجی Frontend در `web/dist` است. سرور تولیدی همان را سرو می‌کند؛ SPA
مسیرهای ناشناخته را به `index.html` برمی‌گرداند.

> `npm run verify` همین زنجیره را بدون UI اجرا می‌کند. برای انتشار، خروجی
> هر فرمان را با exit code بررسی کنید؛ میانگین‌گیری از لاگ کافی نیست.

---

## ۲. پیکربندی تولید

حداقل:

```bash
HOST=127.0.0.1
PORT=8787
NETWATCH_DATA_DIR=/var/lib/netwatch
NETWATCH_BACKUP_DIR=/var/lib/netwatch/backups
NETWATCH_ENGINE=1
```

قواعد:

- `HOST=127.0.0.1` اگر پشت Proxy هستید.
- `NETWATCH_TRUST_PROXY=loopback` فقط با Proxy واقعی.
- `NETWATCH_SEED_DEMO=0` در نصب تولیدی.
- مسیر داده را روی دیسک پایدار و بکاپ‌پذیر بگذارید.
- رمز/کلید را در `.env` محافظت‌شده یا Secret Store نگه دارید.

---

## ۳. TLS

### گزینهٔ ۱: TLS مستقیم

```bash
npm run tls:setup
NETWATCH_TLS_DIR=data/tls npm start
```

### گزینهٔ ۲: Reverse Proxy

- Nginx روی 443.
- NetWatch روی loopback.
- `proxy_buffering off` برای SSE.
- هدرهای `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`.
- `NETWATCH_TRUST_PROXY=loopback`.

نمونهٔ آماده: `deploy/nginx.conf.example`.

---

## ۴. اجرای سرویس

- از systemd/سرویس مدیریت‌شده استفاده کنید.
- `Restart=on-failure`.
- `SIGTERM` را برای shutdown تمیز بفرستید.
- محدودیت فایل/حافظه را متناسب تنظیم کنید.
- لاگ را به فایل/ژورنال بدهید و چرخش داشته باشید.
- سلامت را از `/api/health` پایش کنید.

---

## ۵. نصب آفلاین

```bash
npm run offline:prepare
```

بستهٔ آفلاین شامل وابستگی‌ها/فایل‌های لازم است. روی سرور بدون اینترنت:

1. بسته را منتقل کنید.
2. بررسی checksum.
3. نصب وابستگی‌ها از بستهٔ محلی.
4. `npm run build` یا خروجی prebuilt.
5. راه‌اندازی با `DATA_DIR` مشخص.

جزئیات: `docs/offline-install-update.md`.

---

## ۶. ارتقا

```bash
# قبل از ارتقا
npm run db:backup

# کد جدید
npm ci
npm run build
npm start
```

- Migration خودکار در Startup اجرا می‌شود.
- پیش از Migration، فایل `pre-migration-*` ساخته می‌شود.
- اگر Migration شکست بخورد، برنامه متوقف می‌شود.
- سازگاری Backup قدیمی را با Verify بررسی کنید.
- بعد از ارتقا، `/api/system/health` و `db:doctor` را اجرا کنید.

جزئیات: `docs/upgrade.md` و `docs/fa/15-upgrade-release.md`.

---

## ۷. Backup زمان‌بندی‌شده

- Scheduler داخلی یا Cron.
- پشتیبان کامل شامل DB/MBTiles/attachments/key.
- Verify دوره‌ای.
- نگه‌داری چند نسخه.
- تست Restore روی محیط جدا.
- کلید را جدا از پشتیبان نگه دارید.

```bash
npm run db:backup
npm run db:restore -- <dir>
```

---

## ۸. نسخه‌گذاری

| فایل | چه چیزی |
| --- | --- |
| `package.json` | نسخهٔ نرم‌افزار |
| `package-lock.json` | نسخهٔ top-level |
| `server/db-constants.js` | `SCHEMA_VERSION` |
| `docs/changelog.md` | تغییرات |
| `docs/fa/17-changelog.md` | تغییرات فارسی |
| `docs/verification-report.md` | نتایج واقعی تست |

قواعد:

- نسخهٔ Patch برای اصلاح سازگار.
- نسخهٔ Minor برای قابلیت جدید سازگار.
- Major برای تغییر ناسازگار.
- هر Migration، Changelog و Verification را هم‌زمان به‌روز کنید.

```bash
npm run release:prepare
npm run release:artifact
```

این اسکریپت‌ها را قبل از اجرا بخوانید و خروجی را بررسی کنید.

---

## ۹. چک‌لیست انتشار

- [ ] تست‌ها و Build پاس شده‌اند.
- [ ] نسخه و Schema هماهنگ‌اند.
- [ ] Backup قبل از ارتقا گرفته شده است.
- [ ] Migration روی کپی داده تست شده است.
- [ ] TLS/Proxy/SSE بررسی شده‌اند.
- [ ] Restore روی محیط خالی تست شده است.
- [ ] Changelog و Verification به‌روزند.
- [ ] Commit/Tag/Push با تأیید انجام شده است.

---

## ۱۰. تمرین

1. یک Build تولیدی بگیرید و با `npm start` اجرا کنید.
2. یک درخواست SSE از پشت Proxy بگیرید.
3. یک Backup بسازید و روی DATA_DIR خالی Restore کنید.
4. نسخه را در سه فایل اصلی هماهنگ کنید.

---

## ۱۱. چک‌لیست پایان فصل

- [ ] Build و پیکربندی تولید را می‌دانم.
- [ ] TLS و Proxy را می‌شناسم.
- [ ] نصب آفلاین را می‌فهمم.
- [ ] Migration و Backup قبل از ارتقا را رعایت می‌کنم.
- [ ] نسخه/ Schema/ Changelog را هماهنگ می‌کنم.
- [ ] Checklist انتشار را اجرا می‌کنم.

**فصل بعد:** [پروژهٔ پایانی بخش پایه و دستور پخت قابلیت](18-capstone-extension-recipes.md)
