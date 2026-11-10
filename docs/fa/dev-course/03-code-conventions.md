# فصل ۳ — قواعد کد، خطا و اعتبارسنجی

> **خلاصه:** این فصل قواعدی را توضیح می‌دهد که کد NetWatch را قابل نگه‌داری
> کرده است: ESM، نام‌گذاری، خطاهای دسته‌بندی‌شده، اعتبارسنجی ورودی و Audit.
> رعایت این قواعد از باگ‌های امنیتی و داده‌ای جلوگیری می‌کند.
>
> **نرم‌افزارها:** ESLint 10، Node.js ESM، TypeScript (Frontend)،
> `node:test`.

---

## ۱. ESM و مرز ماژول‌ها

پروژه `"type": "module"` دارد. پس:

```js
// درست
import fs from 'node:fs';
import { db } from './db.js';

// نادرست
const fs = require('node:fs');
```

قواعد:

- پسوند `.js`/`.mjs` را در import بنویسید.
- برای ماژول داخلی Node از پیشوند `node:` استفاده کنید.
- `process.env` فقط در `server/config.js` خوانده شود.
- `ALTER TABLE` فقط در `server/db.js`.
- نوشتن وضعیت تجهیز فقط در `server/engine.js`.

---

## ۲. نام‌گذاری و سبک

| مورد | قاعده | مثال |
| --- | --- | --- |
| فایل | lowercase یا kebab-case | `credential-crypto.js` |
| متغیر | camelCase | `deviceId`, `retryCount` |
| ثابت | UPPER_SNAKE_CASE | `MAX_LINKS`, `SCHEMA_VERSION` |
| تابع | فعل + مفعول | `normalizeExtraPermissions` |
| جدول/ستون | snake_case | `extra_permissions` |
| API JSON | camelCase | `extraPermissions` |
| نوع خطا | PascalCase | `DbError`, `ConfigError` |

پیام فارسی برای کاربر، نام کد انگلیسی. از نیم‌فاصله‌های تصادفی و عبارت‌های
مبهم پرهیز کنید.

---

## ۳. خطا: یک قرارداد، نه چند سبک

خطاهای پایگاه‌داده از `DbError` عبور می‌کنند:

```js
import { DbError, DB_ERROR_CODES } from './db-errors.js';

throw new DbError(
  DB_ERROR_CODES.CONSTRAINT,
  'گروهی با این نام وجود دارد.',
  { status: 409 }
);
```

دسته‌ها:

| کد | معنی | Status رایج |
| --- | --- | --- |
| `DB_BUSY` | قفل موقت | 503/500 |
| `DB_CONSTRAINT` | یکتایی/کلید خارجی | 409/400 |
| `DB_CORRUPT` | فایل خراب | 500 |
| `DB_BACKUP_INVALID` | پشتیبان ناقص | 400/409 |
| `DB_MIGRATION_FAILED` | شکست Migration | 500 |

قواعد:

1. خطای قابل‌نمایش کاربر را با `status` مناسب بدهید.
2. جزئیات SQL و مسیر فایل را در پاسخ API نگذارید؛ در لاگ ثبت کنید.
3. خطای داخلی را به خطای شبکه تبدیل نکنید.
4. در `catch` خالی، دلیل بی‌اثر بودن را کامنت کنید.

---

## ۴. اعتبارسنجی عمومی

`server/validation.js` قبل از رسیدن به Router اجرا می‌شود:

```js
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function validateJsonBody(req, res, next) {
  const contentType = String(req.get('content-type') || '').toLowerCase();
  if (contentType.includes('multipart/form-data')) return next();
  if (!isPlainObject(req.body)) {
    return reject(res, 400, 'بدنهٔ درخواست باید یک شیء JSON باشد.');
  }
  if (hasDangerousKeys(req.body)) {
    return reject(res, 400, 'بدنهٔ درخواست شامل کلید غیرمجاز است.');
  }
  return next();
}
```

اعتبارسنجی دامنه‌ای (طول نام، IP، بازهٔ پورت، CIDR) در ماژول همان دامنه
انجام می‌شود. اعتبارسنجی کلاینت تجربهٔ کاربر را بهتر می‌کند، اما هرگز جای
اعتبارسنجی سرور را نمی‌گیرد.

---

## ۵. Transaction: همگام و کوتاه

`transaction()` عمداً تابع async نمی‌پذیرد؛ باز نگه‌داشتن قفل نوشتن در
`await` می‌تواند کل پایگاه‌داده را قفل کند.

```js
import { transaction } from './db.js';

const saved = transaction(
  () => {
    writeGraph(id, next, Date.now());
    ensureReciprocalLink(getRow(id), targetId, linkKind, { strict: true });
    return getRow(id);
  },
  { label: 'diagram.link.create' }
);
```

اگر داخل transaction خطا رخ دهد، کل تغییرات Rollback می‌شود. برای عملیات
تودرتو از SAVEPOINT استفاده می‌شود.

---

## ۶. Audit و Log

- Audit برای تغییرات حساس، ورود/خروج، Probe، Export و reveal.
- لاگ فنی JSON یک‌خطی با redaction.
- رمز، توکن، CSRF و کلید هرگز در Audit یا Log نوشته نمی‌شوند.
- شکست عملیات هم با `success=0` ثبت می‌شود.

نمونهٔ استفاده از `logEvent`:

```js
logEvent('info', 'auth_user_updated', {
  username: row.username,
  role,
  extraPermissions,
  by: req.user.username,
});
```

---

## ۷. TypeScript در Frontend

- تایپ‌های API در `web/src/lib/types.ts`.
- تغییر شکل پاسخ API باید هم‌زمان در تایپ و کلاینت منعکس شود.
- `npm run typecheck` بخشی از verify است.
- از `any` برای دور زدن خطا استفاده نکنید؛ نوع دقیق یا `unknown` + guard
  بنویسید.

```ts
export interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'operator' | 'viewer';
  permissions: string[];
  extraPermissions?: string[];
}
```

---

## ۸. ESLint و قواعد کیفیت

`eslint.config.mjs` قواعدی مثل `no-var`، `prefer-const`، `eqeqeq` و
`no-empty` (با استثنای catch عمدی) را اعمال می‌کند.

```bash
npm run lint
```

لینت را برای «سبز شدن» با disable سراسری دور نزنید. اگر یک استثنا لازم است،
دلیل آن را در همان خط یا در PR توضیح دهید.

---

## ۹. الگوی افزودن قابلیت

1. تابع دامنه را در ماژول مناسب بنویسید.
2. ورودی را در Router اعتبارسنجی کنید.
3. مجوز مناسب را اضافه کنید.
4. تغییر را در Audit ثبت کنید.
5. Migration لازم را در `db.js` بنویسید.
6. تایپ و API Client را به‌روز کنید.
7. تست Unit/Integration و در صورت نیاز E2E بنویسید.
8. مستندات و Changelog را به‌روز کنید.

---

## ۱۰. تمرین

1. یک `throw new DbError` در کد پیدا کنید و `status` آن را توضیح دهید.
2. یک مسیر API پیدا کنید که `validateJsonBody` را دور می‌زند (multipart) و
   دلیل آن را بنویسید.
3. یک تایپ در `types.ts` را با پاسخ واقعی API مقایسه کنید.
4. یک تست Unit ساده برای یک تابع خالص بنویسید.

---

## ۱۱. چک‌لیست پایان فصل

- [ ] ESM و پسوند import را می‌دانم.
- [ ] `DbError` و کدهای آن را می‌شناسم.
- [ ] تفاوت اعتبارسنجی عمومی و دامنه‌ای را می‌فهمم.
- [ ] می‌دانم transaction چرا async نیست.
- [ ] Audit و Log را از هم تفکیک می‌کنم.
- [ ] قواعد TypeScript و ESLint را رعایت می‌کنم.

**فصل بعد:** [SQLite، Migration و Transaction](04-sqlite-migrations-transactions.md)
