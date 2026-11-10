# فصل ۸ — Auth، Session و RBAC

> **خلاصه:** این فصل امنیت دسترسی NetWatch را از پایه توضیح می‌دهد: هش رمز،
> نشست، کوکی، CSRF، نقش‌ها، مجوزهای دقیق و مجوز اختصاصی
> `credentials:reveal`. در پایان می‌توانید یک API حساس را درست محافظت کنید.
>
> **نرم‌افزارها:** `@node-rs/argon2`، Express Cookie/CSRF،
> `server/permissions.js`، SQLite و `node:test`.

---

## ۱. سه لایهٔ امنیت

```text
Authentication  → شما کی هستید؟ (Session)
Authorization   → چه کاری مجاز است؟ (RBAC)
Origin/CSRF     → درخواست از کجا آمده؟ (Same-Origin + CSRF)
```

هیچ‌کدام جای دیگری را نمی‌گیرد.

---

## ۲. رمز عبور

- هش با Argon2id (`m=19456,t=2,p=1`).
- نمک تصادفی و مقایسهٔ امن.
- حداقل طول ۱۲ (قابل تنظیم) و حداکثر ۱۰۲۴.
- رد رمز رایج/تکراری/دنبالهٔ ساده/برابر نام کاربری.
- رمز خام هرگز در لاگ، Audit یا پاسخ API نمی‌آید.

```js
import { hashPassword, verifyPassword } from './auth.js';
```

سیاست رمز در `server/password-policy.js` است. اگر سیاست را تغییر دادید،
آزمون‌های `password-policy.test.mjs` و مستندات را به‌روز کنید.

---

## ۳. Session

| ویژگی | مقدار |
| --- | --- |
| کوکی | `nw_session` (HttpOnly، SameSite=Strict) |
| CSRF | `nw_csrf` (قابل خواندن JS) |
| ذخیره | فقط هش توکن در جدول `sessions` |
| عمر مطلق | ۱۲ ساعت (قابل تنظیم) |
| Idle | ۶۰ دقیقه (قابل تنظیم) |
| Rotation | در هر Login، نشست قبلی حذف می‌شود |
| Revocation | Logout/تغییر رمز/غیرفعال‌سازی |

`attachUser` در هر درخواست، کوکی را به رکورد نشست و کاربر تبدیل می‌کند.
نقش و مجوزها از DB خوانده می‌شوند؛ بنابراین تغییر نقش بلافاصله اثر می‌کند.

---

## ۴. CSRF و Same-Origin

- برای متدهای تغییردهنده، هدر `X-CSRF-Token` با کوکی `nw_csrf` مقایسه
  می‌شود.
- `sameOriginOnly` درخواست مرورگری با `Origin` ناشناس را رد می‌کند.
- درخواست‌های غیرمرورگری که `Origin` ندارند (curl/اسکریپت) مسدود نمی‌شوند؛
  اما همچنان Session/CSRF لازم دارند.

```js
app.use('/api', attachUser);
app.use('/api', auditMutations);
app.use('/api', requireAuth, csrfGuard);
```

---

## ۵. نقش‌ها

| نقش | خلاصه |
| --- | --- |
| `admin` | همهٔ مجوزها |
| `operator` | عملیات روزمره؛ بدون نمایش رمز پیش‌فرض |
| `viewer` | فقط خواندن |

ماتریس خلاصه:

| مجوز | admin | operator | viewer |
| --- | :-: | :-: | :-: |
| `devices:read` | ✅ | ✅ | ✅ |
| `devices:write` | ✅ | ✅ | ❌ |
| `credentials:read` | ✅ | ✅ | ❌ |
| `credentials:write` | ✅ | ✅ | ❌ |
| `credentials:reveal` | ✅ | ❌ (فقط با مجوز اختصاصی) | ❌ |
| `probe:run` | ✅ | ✅ | ❌ |
| `settings:write` | ✅ | ❌ | ❌ |
| `users:manage` | ✅ | ❌ | ❌ |
| `audit:read` | ✅ | ❌ | ❌ |

`requirePermission` همهٔ مجوزهای داده‌شده را می‌خواهد:

```js
router.get(
  '/:id/credentials',
  requirePermission('devices:write', 'credentials:reveal'),
  handler
);
```

---

## ۶. مجوز اختصاصی

`credentials:reveal` از Operator حذف شده است. مدیر می‌تواند آن را به یک
کاربر مشخص بدهد:

```json
PUT /api/auth/users/7
{
  "extraPermissions": ["credentials:reveal"]
}
```

قواعد:

- فقط `DELEGABLE_PERMISSIONS` قابل اعطاست.
- مقدار ناشناخته یا تلاش برای اعطای `users:manage` با 400 رد می‌شود.
- مجوز در `users.extra_permissions` (JSON) ذخیره می‌شود.
- `/auth/me` فهرست مجوزهای مؤثر را برمی‌گرداند.
- UI فقط دکمه را پنهان می‌کند؛ سرور مرجع نهایی است.

```js
export const DELEGABLE_PERMISSIONS = Object.freeze(['credentials:reveal']);

export function permissionsForUser(user) {
  const role = normalizeRole(user?.role);
  if (!role) return [];
  const extra = normalizeExtraPermissions(
    user?.extraPermissions ?? user?.extra_permissions
  );
  return [...new Set([...BY_ROLE[role], ...extra])];
}
```

---

## ۷. Credentials Vault

- `credentials:read` → فهرست/جزئیات بدون رمز.
- `credentials:write` → ساخت/ویرایش/حذف.
- `credentials:reveal` → نمایش/Export رمز.

مسیرهای حساس:

```text
GET /api/credentials/:id/reveal
GET /api/credentials/export
GET /api/devices/:id/credentials
```

پاسخ‌ها `Cache-Control: no-store` دارند، Audit می‌شوند و سقف نرخ
اختصاصی دارند. فهرست و جزئیات هرگز رمز را برنمی‌گردانند.

---

## ۸. رمزنگاری اعتبارنامه

- الگوریتم: AES-256-GCM.
- کلید از `NETWATCH_CREDENTIAL_KEY` یا فایل
  `<DATA_DIR>/device-credentials.key` با مجوز `0600`.
- کلید در Backup به فایل جداگانه منتقل می‌شود.
- اگر کلید در دسترس نباشد، رمزگشایی شکست می‌خورد؛ این رفتار عمدی است.

---

## ۹. آزمون RBAC

```bash
env -u PORT npm run test:integration
```

آزمون‌های کلیدی:

- `credentials-api.test.mjs`: Operator بدون reveal؛ grant/revoke.
- `rbac-matrix.test.mjs`: همهٔ مسیرها و نقش‌ها.
- `phase3-security.test.mjs`: Lockout، Fixation، CSRF.
- `api-contract.test.mjs`: شکل پاسخ.

حداقل تست یک Endpoint حساس:

```js
assert.equal((await api(base, 'GET', '/api/credentials/1/reveal')).status, 403);
await login(base, 'operator', '...');
assert.equal((await api(base, 'GET', '/api/credentials/1/reveal')).status, 403);
```

---

## ۱۰. تمرین

1. یک Endpoint فرضی بسازید که فقط `admin` بتواند صدا بزند.
2. برای آن مجوز اختصاصی طراحی نکنید؛ توضیح دهید چرا.
3. یک تست 401/403/200 برای مسیر credentials بنویسید.
4. تفاوت `credentials:read` و `credentials:reveal` را در UI نشان دهید.

---

## ۱۱. چک‌لیست پایان فصل

- [ ] Argon2 و سیاست رمز را می‌دانم.
- [ ] Session Rotation و Revocation را می‌فهمم.
- [ ] CSRF و Same-Origin را از RBAC جدا می‌کنم.
- [ ] ماتریس نقش‌ها را می‌شناسم.
- [ ] مجوز اختصاصی فقط از مسیر مجاز اعطا می‌شود.
- [ ] مسیرهای reveal/export را با تست محافظت می‌کنم.

**فصل بعد:** [موتور پایش](09-monitoring-engine.md)
