# فصل ۱ — راه‌اندازی و ابزارها

> **خلاصه:** در این فصل پروژه را روی سیستم خود اجرا می‌کنید، پورت‌ها و
> `DATA_DIR` را می‌شناسید، اولین حساب مدیر را می‌سازید و می‌فهمید هر اسکریپت
> `package.json` چه کاری می‌کند. این فصل پیش‌نیاز همهٔ فصل‌های بعد است.
>
> **نرم‌افزارها:** Node.js، npm، Vite، Express، SQLite داخلی Node، Git و
> ابزار سیستمی `ping`. برای تست UI بعداً Playwright لازم می‌شود.

---

## ۱. پیش‌نیازهای واقعی پروژه

| مورد | حداقل | چرا |
| --- | --- | --- |
| Node.js | `>= 22.12` | پروژه از `node:sqlite` و تست‌های داخلی استفاده می‌کند |
| npm | همراه Node | نصب وابستگی‌ها با lockfile |
| Git | نسخهٔ جدید | دریافت کد و نسخه‌بندی |
| دسترسی ICMP | اختیاری | حالت `icmp`؛ بدون آن `auto` به TCP سقوط می‌کند |
| مرورگر | Chrome/Firefox | استفاده از SPA و تست UI |
| فضای دیسک | حداقل چند صد مگابایت | `node_modules`، داده و پشتیبان |
| OpenSSL | اختیاری | ساخت گواهی TLS محلی |

Node را بررسی کنید:

```bash
node -v
npm -v
```

نسخهٔ پروژه وابسته به `engines` است. اگر Node قدیمی‌تر باشد، ممکن است
`node:sqlite` یا گزینه‌های تست در دسترس نباشند.

---

## ۲. نصب و اولین اجرا

از ریشهٔ مخزن:

```bash
npm ci
npm run dev
```

`npm ci` نسخه‌های `package-lock.json` را نصب می‌کند و برای CI و محیط تولید
مناسب‌تر از `npm install` است.

`npm run dev` معادل این دستور است:

```bash
node server/index.js --dev
```

در حالت `--dev`:

- پورت پیش‌فرض **3000** است؛
- CSP سخت‌گیرانهٔ تولید اعمال نمی‌شود؛
- Vite/HMR برای رابط کاربری فعال است.

سپس آدرس `http://127.0.0.1:3000` را باز کنید. در نصب تازه، فرم
**راه‌اندازی اولیه** نمایش داده می‌شود؛ نام کاربری و رمز مدیر را خودتان
تعیین می‌کنید.

> هیچ رمز پیش‌فرض یا فایل رمز خودکار وجود ندارد. رمز باید سیاست طول و
> ترکیب را پاس کند.

---

## ۳. اسکریپت‌هایی که باید بشناسید

| دستور | کار واقعی |
| --- | --- |
| `npm run dev` | سرور با `--dev` |
| `npm start` | سرور تولیدی |
| `npm run dev:web` | Vite فقط برای Frontend |
| `npm run build` | ساخت `web/dist` |
| `npm run preview` | اجرای سرور تولیدی |
| `npm run engine` | اجرای موتور مستقل (`engine-cli`) |
| `npm run typecheck` | بررسی TypeScript |
| `npm run lint` | ESLint |
| `npm run test:unit` | تست Unit با `node:test` |
| `npm run test:web` | تست منطق Frontend |
| `npm run test:integration` | تست API/سرور واقعی |
| `npm run test:e2e` | Smoke + E2E |
| `npm run test:ui` | Playwright |
| `npm run db:backup` | پشتیبان CLI |
| `npm run db:restore` | بازیابی CLI |
| `npm run db:doctor` | سلامت پایگاه‌داده |
| `npm run tls:setup` | ساخت CA/گواهی محلی |

فایل `package.json` منبع حقیقت است؛ اگر اسکریپتی را تغییر دادید، این جدول و
مستندات مرتبط را هم به‌روز کنید.

---

## ۴. پیکربندی: یک منبع، نه چند منبع

همهٔ متغیرهای محیطی حساس از `server/config.js` خوانده و اعتبارسنجی می‌شوند.
هیچ ماژول دیگری نباید مستقیم `process.env` را برای تنظیمات اصلی بخواند.

نمونهٔ واقعی از `server/config.js`:

```js
const port = intSetting(env, 'PORT', isDev ? 3000 : 8787, {
  min: 1,
  max: 65535,
  errors,
});
const host = String(env.HOST || '127.0.0.1').trim();
if (!net.isIP(host) && !isHostname(host)) {
  errors.push(`HOST باید IP یا نام میزبان معتبر باشد...`);
}
const dataDir = resolvePath(
  env.NETWATCH_DATA_DIR,
  path.join(ROOT, 'data')
);
```

نکته‌های مهم:

- `PORT=0` معتبر **نیست**؛ مقدار باید بین ۱ و ۶۵۵۳۵ باشد.
- پیش‌فرض `HOST` برابر `127.0.0.1` است؛ سرویس به‌طور پیش‌فرض روی همهٔ
  اینترفیس‌ها باز نمی‌شود.
- مسیرهای نسبی نسبت به ریشهٔ پروژه resolve می‌شوند.
- تنظیم ناقص TLS (فقط cert یا فقط key) خطای حیاتی است.

### متغیرهای پرکاربرد

| متغیر | پیش‌فرض | کاربرد |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | آدرس listen |
| `PORT` | `8787` (تولید) | پورت سرور |
| `NETWATCH_DATA_DIR` | `./data` | داده، DB، پیوست، MBTiles |
| `NETWATCH_DB` | `<DATA_DIR>/netwatch.db` | مسیر فایل DB |
| `NETWATCH_BACKUP_DIR` | `<DATA_DIR>/backups` | پشتیبان |
| `NETWATCH_ENGINE` | `1` | روشن/خاموش‌کردن موتور |
| `NETWATCH_ENGINE_MODE` | `auto` | `auto/icmp/tcp/simulate` |
| `NETWATCH_SEED_DEMO` | روشن | دادهٔ نمایشی در نصب تازه |
| `NETWATCH_TLS_DIR` | — | پوشهٔ گواهی TLS |
| `NETWATCH_TRUST_PROXY` | — | فقط پشت پروکسی معتبر |

---

## ۵. ساختار `DATA_DIR`

```text
data/
├── netwatch.db          ← SQLite + WAL
├── netwatch.db-wal
├── netwatch.db-shm
├── mbtiles/             ← فایل‌های .mbtiles
├── attachments/         ← پیوست تجهیز و دیاگرام
├── backups/             ← مجموعه‌های پشتیبان
├── tmp/                 ← آپلود موقت
├── device-credentials.key
└── tls/                 ← در صورت استفاده
```

- `netwatch.db` را در حین اجرا کپی نکنید؛ برای نسخهٔ سازگار از
  `npm run db:backup` استفاده کنید.
- پوشهٔ `data/` را از دسترس وب‌سرور جدا نگه دارید.
- فایل کلید اعتبارنامه را در جای امن و جدا از نسخهٔ پشتیبان نگه دارید.

---

## ۶. اولین درخواست سالم

پس از بالا آمدن سرور:

```bash
curl http://127.0.0.1:8787/api/health
```

پاسخ عمومی چیزی شبیه این است:

```json
{ "ok": true, "status": "ok", "ts": 1760000000000 }
```

این مسیر هیچ نسخه، مسیر فایل یا جزئیات موتور را افشا نمی‌کند. برای سلامت
تفصیلی، پس از ورود:

```bash
curl -b cookies.txt http://127.0.0.1:8787/api/system/health
```

---

## ۷. اجرای مستقل موتور

برای جداسازی API از پایش:

```bash
NETWATCH_ENGINE=0 npm start
npm run engine
```

هر دو فرآیند باید به **همان** `NETWATCH_DATA_DIR` اشاره کنند. فقط یکی در هر
لحظه رهبر است؛ دیگری Standby می‌ماند. جزئیات در فصل ۹.

---

## ۸. خطاهای رایج

| نشانه | علت احتمالی | راه‌حل |
| --- | --- | --- |
| `PORT باید عدد صحیحی بین 1 و 65535 باشد` | `PORT=0` یا مقدار متنی | `env -u PORT` یا مقدار معتبر |
| `EADDRINUSE` | پورت اشغال است | پورت دیگر یا توقف فرآیند قبلی |
| `ConfigError` برای TLS | فقط یکی از cert/key تنظیم شده | هر دو یا `NETWATCH_TLS_DIR` |
| ICMP کار نمی‌کند | مجوز raw socket/`ping` نیست | `auto` به TCP سقوط می‌کند یا `engine_mode=tcp` |
| UI باز نمی‌شود | Build/سرور اشتباه | `npm run build` و `npm start` |
| `test:ui` مرورگر ندارد | Chromium Playwright نصب نیست | `npx playwright install chromium` |

---

## ۹. تمرین

1. پروژه را با `npm ci` و `npm run dev` اجرا کنید.
2. حساب مدیر بسازید و وارد شوید.
3. یک تجهیز با IP معتبر اضافه کنید.
4. در `DATA_DIR` فایل‌های ساخته‌شده را ببینید.
5. `/api/health` و `/api/system/health` را با و بدون نشست مقایسه کنید.
6. یک بار `npm run test:unit` را با `env -u PORT` اجرا کنید.

---

## ۱۰. چک‌لیست پایان فصل

- [ ] Node و npm را می‌شناسم.
- [ ] `npm ci` و `npm run dev` را اجرا کرده‌ام.
- [ ] تفاوت پورت توسعه و تولید را می‌دانم.
- [ ] `DATA_DIR` و فایل‌های آن را دیده‌ام.
- [ ] اولین حساب مدیر را ساخته‌ام.
- [ ] می‌دانم چرا `PORT=0` مجاز نیست.
- [ ] مسیرهای health عمومی و تفصیلی را می‌شناسم.

**فصل بعد:** [معماری و چرخهٔ درخواست](02-architecture-and-request-lifecycle.md)
