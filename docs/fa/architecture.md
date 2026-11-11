# معماری NetWatch

این سند مرزهای ماژول‌ها و قواعد وابستگی را مشخص می‌کند. هدف این است که تغییر یک
قابلیت، کمترین سطح از کد را لمس کند و وابستگی حلقه‌ای ایجاد نشود.

## فرانت‌اند

```text
web/src/
  pages/          هماهنگی مسیر و ترکیب featureها؛ بدون منطق دامنه‌ای سنگین
  features/       هر دامنه: components، hooks، model، lib
    map/          لایه‌های Leaflet، نشانه‌ها، اندازه‌گیری، پاپ‌آپ و پنل‌ها
    devices/      کارت/جدول/گروه‌ها و مدل ستون‌های جدول
    settings/     تب‌های مستقل تنظیمات
    diagrams/     بوم، بازرس، درخت و نمای کلی (layout/card/edge)
  components/     UI مشترک و بدون آگاهی از دامنه
  lib/            API، store، قالب‌بندی، انواع سراسری و ابزارهای خالص
```

قواعد:

- `pages` فقط داده را از hook/store می‌گیرد و کامپوننت‌ها را کنار هم می‌گذارد.
- `features` می‌تواند از `components` و `lib` استفاده کند؛ عکس آن مجاز نیست.
- بین featureها فقط از API عمومی همان feature (فایل index یا مدل) استفاده شود.
- منطق خالص و قابل تست (چیدمان، هندسه، محاسبات) در `lib` یا `model` بماند.
- نوع‌های مخصوص یک feature در همان feature تعریف شوند؛ `lib/types.ts` فقط
  قراردادهای مشترک API را نگه می‌دارد.

## بک‌اند

```text
server/
  index.js          چرخهٔ عمر، middleware امنیتی، HTTPS و خاموشی
  routes/           قرارداد HTTP و اعتبارسنجی ورودی
  routes/index.js   ثبت متمرکز و ترتیب Routerها
  services/         منطق دامنه‌ای مستقل از Express
  store.js          دسترسی تجهیزات و پرس‌وجوهای مشترک
  db.js             اتصال، Migration و ابزارهای پایگاه‌داده
  engine.js         حلقهٔ پایش و وضعیت موتور
```

قواعد:

- Route نباید SQL یا الگوریتم دامنه‌ای داشته باشد؛ آن را به service/store بسپارد.
- Service نباید به `req`/`res` وابسته باشد تا مستقل تست شود.
- Validation در مرز HTTP انجام می‌شود و خطاهای قابل‌انتظار با `status` مشخص
  برمی‌گردند.
- وابستگی یک‌طرفه است: `routes → services → store/db`. ماژول‌های پایه از route
  import نمی‌کنند.
- Migration و قرارداد API بدون ضرورت تغییر نمی‌کنند.

## نام‌گذاری

- فایل‌های React: `PascalCase.tsx`؛ hookها: `useThing.ts`؛ ماژول‌های خالص:
  `kebab-case.ts`؛ تست‌ها: `*.test.ts` یا `*.test.mjs`.
- متغیر/تابع: `camelCase`؛ ثابت‌ها: `UPPER_SNAKE_CASE`؛ نوع/کامپوننت:
  `PascalCase`.
- هر فایل یک مسئولیت اصلی داشته باشد؛ استخراج فقط وقتی انجام شود که مرز
  مسئولیت واقعی وجود دارد، نه برای ساختن لایهٔ اضافی.

## کیفیت

- `npm run lint` برای JavaScript و `npm run typecheck` با `strict`،
  `noUnusedLocals` و `noUnusedParameters`.
- `npm run format` / `npm run format:check` با Prettier.
- `npm run test:unit`، `test:web`، `test:integration` و `test:e2e` پیش از
  انتشار.
