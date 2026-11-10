# فصل ۱۶ — عملکرد، Observability و عیب‌یابی

> **خلاصه:** این فصل نشان می‌دهد NetWatch چگونه سریع می‌ماند و چگونه
> می‌فهمیم کجا کند شده است: Query Plan، WAL، Batch Write، SSE، Health،
> Metrics، Log و Harnessهای بار/Soak.
>
> **نرم‌افزارها:** SQLite، `server/metrics.js`، `db:doctor`،
> `qa-load-matrix.mjs`، `qa-soak.mjs`، endpointهای health.

---

## ۱. قاعدهٔ اول: اندازه‌گیری، نه حدس

هیچ بهینه‌سازی را بدون عدد انجام ندهید. حداقل:

- زمان Query قبل/بعد.
- مصرف CPU/RSS.
- تأخیر Event Loop.
- اندازهٔ WAL.
- p95/p99 API.
- خطای 5xx.

گزارش مرجع در `docs/performance-report.md` است؛ اعداد آن مربوط به محیط
Linux فاز ۵ است و نباید به‌عنوان Benchmark نسخهٔ 1.4.1 روی محیط دیگر
خوانده شود.

---

## ۲. Query Plan

```js
const plan = db
  .prepare(`EXPLAIN QUERY PLAN ${sql}`)
  .all(...params)
  .map((r) => String(r.detail));
```

علائم:

| علامت | معنی |
| --- | --- |
| `SCAN table` | پیمایش کامل؛ برای جدول بزرگ بد |
| `SEARCH ... USING INDEX` | استفاده از ایندکس |
| `COVERING INDEX` | خواندن از خود ایندکس |
| `USE TEMP B-TREE` | مرتب‌سازی/گروه‌بندی موقت |

`server/tests/unit/db-query-plan.test.mjs` Queryهای داغ را بررسی می‌کند.

---

## ۳. WAL و Checkpoint

- WAL نوشتن و خواندن را هم‌زمان‌پذیر می‌کند.
- WAL بزرگ = نوشتن سنگین یا Checkpoint ناموفق.
- Backup با `TRUNCATE` checkpoint شروع می‌شود.
- `walInfo()` در AppHealth دیده می‌شود.

```bash
npm run db:doctor
```

---

## ۴. Batch Write

موتور نتایج را گروهی COMMIT می‌کند:

- هر بررسی Savepoint مستقل دارد.
- چند بررسی در یک COMMIT/fsync.
- شکست یک بررسی بقیه را باطل نمی‌کند.
- تعداد Batch و فاصلهٔ Flush قابل تنظیم است.

هزینهٔ هر COMMIT/fsync بالاست؛ Batch بدون از دست دادن اتمیک‌بودن، گذردهی
را بالا می‌برد.

---

## ۵. SSE و حافظه

- هر کلاینت فقط تجهیزات مشاهده‌شده را می‌گیرد.
- Buffer سقف دارد.
- فریم غیرحیاتی در Backpressure حذف می‌شود.
- کلاینت خیلی کند قطع می‌شود.
- `stats` شامل `clients/peak/skippedFrames/droppedClients`.

```bash
curl -b cookies.txt http://127.0.0.1:8787/api/system/health
```

---

## ۶. Health و Metrics

| مسیر | مخاطب | محتوا |
| --- | --- | --- |
| `/api/health` | عمومی | زنده/مرده |
| `/api/system/health` | `system:health` | DB، WAL، Engine، SSE، Job |
| `/api/system/app-health` | `system:health` | CPU/RAM/ELD/Query/History |
| `/api/status` | Dashboard | وضعیت سبک |

هیچ‌کدام مسیر فایل یا Secret افشا نمی‌کنند.

---

## ۷. Log و Audit

- لاگ JSON یک‌خطی.
- `logEvent` برای رخداد ساختاریافته.
- Secret redaction.
- Audit برای تغییرات و خواندن حساس.
- Logهای خطادار/کند نباید بدنهٔ حساس را ثبت کنند.

---

## ۸. Harnessهای بار

```bash
npm run qa:load
npm run qa:soak
npm run qa:soak24
npm run qa:soak72
npm run db:scale
npm run test:heavy
```

| ابزار | کاربرد |
| --- | --- |
| `qa:load` | ماتریس ۱۰۰ تا ۲۰٬۰۰۰ تجهیز |
| `qa:soak` | اجرای طولانی و نشت حافظه |
| `db:scale` | Query داغ و نوشتن هم‌زمان |
| `test:heavy` | Import ۵۰k ردیف |

اجرای کوتاه، جای Soak ۷۲ ساعته را نمی‌گیرد.

---

## ۹. عیب‌یابی گام‌به‌گام

1. `/api/health` → آیا سرور زنده است؟
2. `/api/system/health` → DB/Engine/SSE چه می‌گویند؟
3. `db:doctor` → integrity و ایندکس.
4. لاگ سرور → خطای اول.
5. Query Plan → کدام Query کند است؟
6. WAL/RSS → نوشتن/حافظه.
7. `ss`/`lsof` → پورت و اتصال.
8. Config → proxy/TLS/rate limit.

---

## ۱۰. تمرین

1. یک Query داغ را با Query Plan بررسی کنید.
2. اندازهٔ WAL را قبل/بعد از Checkpoint ببینید.
3. ۱۰۰ اتصال SSE را تست کنید و `stats` را بخوانید.
4. یک Soak کوتاه اجرا و رشد RSS را ثبت کنید.
5. یک گزارش عملکرد کوچک با اعداد واقعی بنویسید.

---

## ۱۱. چک‌لیست پایان فصل

- [ ] قبل از بهینه‌سازی اندازه‌گیری می‌کنم.
- [ ] Query Plan را می‌خوانم.
- [ ] WAL و Checkpoint را می‌فهمم.
- [ ] Batch Write و اتمیک‌بودن را می‌شناسم.
- [ ] سقف‌های SSE را می‌دانم.
- [ ] Health/Metrics/Log را برای عیب‌یابی استفاده می‌کنم.
- [ ] محدودیت Soak را صادقانه گزارش می‌کنم.

**فصل بعد:** [استقرار، ارتقا و انتشار](17-deploy-upgrade-release.md)
