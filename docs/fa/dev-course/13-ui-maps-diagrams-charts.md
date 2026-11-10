# فصل ۱۳ — UI، نقشه، دیاگرام و نمودار

> **خلاصه:** این فصل لایهٔ نمایش را از پایه توضیح می‌دهد: طراحی RTL با
> Tailwind، جدول و فیلتر، نمودارهای Recharts، نقشهٔ Leaflet/MapLibre، بوم
> دیاگرام XYFlow و خروجی تصویری. تمرکز روی الگوهایی است که در NetWatch
> واقعاً استفاده شده‌اند.
>
> **نرم‌افزارها:** Tailwind 4، Recharts 3، Leaflet 1.9، MapLibre 6،
> XYFlow 12، Lucide، `html-to-image`، `bidi-js`.

---

## ۱. Tailwind و طراحی RTL

- `web/src/index.css` متغیرهای رنگ و کلاس‌های مشترک را دارد.
- جهت صفحه `rtl` است؛ از `ms-*`/`me-*` و منطق Logical استفاده کنید.
- کلاس‌های تکراری را در `components/ui.tsx` جمع کنید.
- رنگ وضعیت باید با آیکن و متن همراه باشد.

```tsx
<span className="inline-flex items-center gap-1 text-success">
  <CheckIcon aria-hidden />
  وصل
</span>
```

---

## ۲. جدول، فیلتر و VirtualList

- فیلترها در URL نگه داشته می‌شوند (`lib/params.ts`) تا Share/Refresh کار
  کند.
- صفحه‌بندی سمت سرور است؛ Table نباید همهٔ ردیف‌ها را بگیرد.
- برای فهرست بلند از `VirtualList` استفاده کنید.
- Empty State و Error State جدا از Loading طراحی شوند.

```tsx
const { page, pageSize } = parseParams(searchParams);
const data = await api.devices({ page, pageSize, status });
```

---

## ۳. نمودار با Recharts

کاربردها:

- روند Uptime و RTT.
- توزیع وضعیت.
- قطعی‌ها و هم‌زمانی.
- گزارش بازه‌ای.

قواعد:

- دادهٔ خالی → Empty State.
- محور زمان با منطقهٔ زمانی تنظیمات.
- رنگ‌ها از پالت مشترک.
- نمودار سنگین فقط در صفحهٔ خودش Lazy Load شود.
- عدد محاسبه‌شده در Frontend را با API هم‌خوان نگه دارید.

---

## ۴. نقشهٔ Leaflet

- `MapPage` از Leaflet برای نمایش Marker و لایه استفاده می‌کند.
- Markerها از `map_markers` و تجهیزات می‌آیند.
- برای تعداد زیاد Marker، خوشه‌سازی/محدودیت Zoom لازم است.
- کلیک روی Marker به جزئیات تجهیز می‌رود.
- دادهٔ جغرافیایی اختیاری است؛ تجهیز بدون مختصات نباید خطا بدهد.

---

## ۵. MapLibre و MBTiles

- لایهٔ برداری با MapLibre و style محلی.
- کاشی از فایل `.mbtiles` خوانده می‌شود؛ اینترنت لازم نیست.
- تبدیل TMS به XYZ در `server/mbtiles.js` انجام می‌شود.
- نوع کاشی (PNG/JPEG/WebP/PBF) از metadata یا magic bytes تشخیص داده
  می‌شود.
- فایل ناموجود/لایهٔ ناسازگار باید در UI پیام روشن بدهد، نه کاشی شکسته.

```ts
// style و source از لایهٔ انتخاب‌شده ساخته می‌شود
map.addSource('offline', {
  type: 'vector',
  tiles: [`/api/mbtiles/${layer.fileName}/{z}/{x}/{y}.pbf`],
});
```

> مسیر واقعی کاشی را از API همان نسخه بگیرید؛ قرارداد را در `06-api.md`
> بررسی کنید.

---

## ۶. دیاگرام با XYFlow

مدل داده:

- `nodes`: تجهیز، متن، تصویر، پیوند به دیاگرام دیگر.
- `edges`: یال بین nodeها.
- `revision`: برای جلوگیری از ذخیرهٔ کهنه.

ویژگی‌ها:

- جابه‌جایی/ویرایش گره.
- پیوند دوطرفه به دیاگرام دیگر.
- پیوست تصویر.
- خروجی PNG با `html-to-image`.
- ذخیرهٔ محتوا با `PUT /api/diagrams/:id/content`.

قاعدهٔ مهم: پیوند دیاگرام باید در سرور دوطرفه و تراکنشی باشد؛ UI نباید
تنها یک طرف را ذخیره کند.

---

## ۷. مجوز در UI

```tsx
const canReveal = can('credentials:reveal');
```

- دکمهٔ حساس فقط با مجوز دیده شود.
- پیام راهنما برای کاربر بدون مجوز.
- سرور همچنان 403 می‌دهد؛ UI جایگزین کنترل نیست.
- تغییر مجوز در Settings باید پس از Refresh در `/auth/me` دیده شود.

---

## ۸. خطا، Loading و Freshness

- `ErrorBoundary` برای خطای رندر.
- `PageLoader` برای Lazy Load.
- `Freshness` برای دادهٔ کهنه.
- `LivePing` برای وضعیت SSE.
- Retry برای خطای شبکه/Timeout.
- 403 → پیام مجوز؛ 401 → Login.

---

## ۹. دسترس‌پذیری و موبایل

- دکمه‌ها اندازهٔ لمس کافی.
- `aria-live` برای Toast و هشدار.
- کنتراست رنگ.
- بدون Scroll افقی در موبایل.
- تست `ui.spec.ts` شامل موبایل و RTL است.

---

## ۱۰. تمرین

1. یک ویجت کوچک به Dashboard اضافه کنید.
2. یک فیلتر تازه را در URL ذخیره کنید.
3. یک Marker بدون مختصات را در نقشه تست کنید.
4. یک دیاگرام با پیوند دوطرفه بسازید و Revision را بررسی کنید.
5. خروجی PNG دیاگرام را بگیرید.

---

## ۱۱. چک‌لیست پایان فصل

- [ ] RTL و Tailwind را می‌فهمم.
- [ ] فیلتر/صفحه‌بندی را در URL نگه می‌دارم.
- [ ] نمودار سنگین را Lazy Load می‌کنم.
- [ ] Leaflet/MapLibre و محدودیت داده را می‌شناسم.
- [ ] دیاگرام و پیوند دوطرفه را می‌فهمم.
- [ ] مجوز UI را با مجوز سرور هماهنگ می‌کنم.

**فصل بعد:** [استراتژی تست](14-testing-strategy.md)
