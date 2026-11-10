# فصل ۱۵ — سخت‌سازی امنیتی

> **خلاصه:** این فصل مدل تهدید NetWatch و کنترل‌های واقعی آن را توضیح
> می‌دهد: SQL Injection، XSS، CSRF، Path Traversal، آپلود فایل، Secret،
> RBAC و امنیت Backup. هدف این است که قابلیت جدید، سطح حملهٔ تازه نسازد.
>
> **نرم‌افزارها:** Express، Helmet-like headerها، Argon2، AES-256-GCM،
> Multer، `server/file-guard.js`، `server/net-policy.js`.

---

## ۱. مدل تهدید کوتاه

| تهدید | مسیر | کنترل |
| --- | --- | --- |
| کاربر غیرمجاز | API | Session + RBAC |
| CSRF | مرورگر قربانی | SameSite + CSRF Token + Origin |
| SQL Injection | فیلتر/Sort | Prepared Statement + allowlist |
| XSS | دادهٔ کاربر | Escape + CSP + عدم `innerHTML` |
| Path Traversal | فایل/پیوست | basename + مسیر مجاز |
| فایل مخرب | آپلود | magic bytes + حجم + نوع |
| افشای رمز | API/UI/Log | reveal مجوز جدا + no-store + redaction |
| Backup دزدیده‌شده | فایل | کلید جدا + مجوز 0600 |
| Probe به شبکهٔ حساس | CIDR | allowlist |

---

## ۲. SQL Injection

```js
// درست
db.prepare('SELECT * FROM devices WHERE id = ?').get(id);

// نادرست
db.prepare(`SELECT * FROM devices WHERE id = ${id}`);
```

برای Sort/ستون:

```js
const column = DEVICE_SORTS[req.query.sort] || 'd.name';
```

بازبینی خودکار `db-query-plan.test.mjs` هر درج داینامیک در SQL را بررسی
می‌کند؛ استثناها باید از مجموعهٔ بستهٔ داخلی بیایند.

---

## ۳. XSS

- React به‌طور پیش‌فرض متن را Escape می‌کند.
- از `dangerouslySetInnerHTML` استفاده نکنید.
- CSP در تولید اعمال می‌شود.
- JSON escape می‌شود.
- نام فایل/پیام خطا را قبل از نمایش پاک کنید.
- لینک خارجی با `rel="noopener noreferrer"`.

---

## ۴. CSRF

- کوکی `nw_session` با `SameSite=Strict`.
- کوکی `nw_csrf` قابل خواندن JS.
- هدر `X-CSRF-Token` در همهٔ متدهای تغییردهنده.
- `sameOriginOnly` برای Origin.
- `validateJsonBody` برای Content-Type.

```js
app.use('/api', requireAuth, csrfGuard);
```

---

## ۵. Path Traversal و فایل

```js
const name = path.basename(String(storedName || ''));
if (!name || name !== String(storedName)) return null;
const full = path.join(ATTACHMENTS_DIR, name);
if (path.dirname(full) !== ATTACHMENTS_DIR) return null;
```

قواعد:

- نام تولیدی، نه نام کاربر.
- پوشهٔ `0700`، فایل `0600`.
- نوع از magic bytes.
- فایل موقت در `data/tmp`.
- پاک‌سازی فایل یتیم در Startup.

---

## ۶. آپلود امن

`server/attachments.js`:

```js
if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, ...])) return ALLOWED_TYPES.png;
if (startsWith(buffer, [0xff, 0xd8, 0xff])) return ALLOWED_TYPES.jpeg;
if (buffer.toString('ascii', 0, 5) === '%PDF-') return ALLOWED_TYPES.pdf;
```

- ZIP/EXE/ELF صریحاً رد می‌شوند.
- متن ساده با محدودیت اندازه.
- MIME اعلامی مرورگر کافی نیست.

---

## ۷. Secretها

- `NETWATCH_CREDENTIAL_KEY` را در chat/لاگ/کد نگذارید.
- فایل کلید `0600`.
- در Backup، فایل جدا با checksum.
- در Audit فقط نام کلید، نه مقدار.
- در `.env` واقعی commit نکنید.
- برای چرخش کلید، برنامهٔ مهاجرت داشته باشید؛ صرفاً فایل را عوض نکنید.

---

## ۸. RBAC و اصل حداقل دسترسی

- Operator پیش‌فرض reveal ندارد.
- فقط `credentials:reveal` قابل تفویض است.
- `users:manage` و `settings:write` قابل تفویض نیستند.
- هر Endpoint جدید مجوز صریح داشته باشد.
- مجوز خواندن ≠ مجوز نوشتن.

---

## ۹. امنیت Backup

- checksum همهٔ اجزا.
- Restore ناقص متوقف شود.
- کلید جدا از داده نگه داشته شود.
- نسخهٔ پشتیبان در محل امن.
- پشتیبان رمزنگاری‌شده در نسخهٔ فعلی وجود ندارد؛ رمزنگاری کل دیسک
  میزبان توصیه می‌شود.

---

## ۱۰. امنیت شبکه

- `NETWATCH_PROBE_ALLOWED_CIDRS` را محدود کنید.
- Link-Local/Metadata پیش‌فرض مسدود.
- `NETWATCH_ADMIN_ALLOWED_CIDRS` برای API مدیریتی.
- `NETWATCH_TRUST_PROXY` فقط با proxy واقعی.
- TLS و HSTS در تولید.

---

## ۱۱. تست امنیتی

```bash
env -u PORT node --experimental-strip-types --test server/tests/integration/security.test.mjs server/tests/integration/phase3-security.test.mjs
env -u PORT node --experimental-strip-types --test server/tests/integration/rbac-matrix.test.mjs
```

موارد:

- تزریق در فیلتر/Sort.
- CSRF و Origin.
- آپلود فایل اجرایی.
- Path Traversal.
- Operator و reveal.
- Backup ناقص.

---

## ۱۲. تمرین

1. یک Query ناامن را پیدا و امن کنید.
2. یک Endpoint با مجوز اشتباه را اصلاح کنید.
3. یک فایل ZIP را به مسیر آپلود بفرستید و انتظار رد را تست کنید.
4. یک Backup بدون کلید بسازید و رفتار Verify را ببینید.

---

## ۱۳. چک‌لیست پایان فصل

- [ ] SQL را فقط با پارامتر می‌سازم.
- [ ] XSS/CSP را رعایت می‌کنم.
- [ ] CSRF و Origin را می‌فهمم.
- [ ] فایل را با magic bytes و مسیر امن مدیریت می‌کنم.
- [ ] Secret را در Log/Audit نمی‌گذارم.
- [ ] RBAC و Backup را امن نگه می‌دارم.
- [ ] برای تغییر امنیتی تست می‌نویسم.

**فصل بعد:** [عملکرد و Observability](16-performance-observability.md)
