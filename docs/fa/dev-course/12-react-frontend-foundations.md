# فصل ۱۲ — پایه‌های React و TypeScript

> **خلاصه:** رابط کاربری یک SPA با React 19 و TypeScript است. این فصل
> ساختار، Providerها، Router، API Client، Auth، مدیریت وضعیت، فرم و خطا را
> توضیح می‌دهد. هدف این است که بتوانید یک صفحهٔ تازه را درست و امن اضافه
> کنید.
>
> **نرم‌افزارها:** React 19، TypeScript 7، Vite 8، React Router 7،
> Tailwind 4، `lucide-react`.

---

## ۱. نقطهٔ ورود

`web/src/main.tsx` Providerها را به ترتیب می‌چیند:

```tsx
<ThemeProvider>
  <BrowserRouter>
    <ToastProvider>
      <AuthProvider>
        <AuthGate>
          <AppProvider>
            <LiveProvider>
              <LivePingProvider>
                <ErrorBoundary>
                  <App />
                </ErrorBoundary>
```

ترتیب مهم است:

- `Auth` قبل از `App` است تا مجوزها معلوم باشند.
- `AuthGate` تا پایان بررسی نشست، صفحهٔ ورود یا Loading نشان می‌دهد.
- `ErrorBoundary` خطای رندر را مهار می‌کند.

---

## ۲. مسیرها و Lazy Loading

```tsx
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Devices = lazy(() => import('./pages/Devices'));
const DeviceDetail = lazy(() => import('./pages/DeviceDetail'));

<Routes>
  <Route path="/dashboard" element={<Dashboard />} />
  <Route path="/devices" element={<Devices />} />
  <Route path="/devices/:id" element={<DeviceDetail />} />
</Routes>
```

- هر صفحه بستهٔ جدا دارد.
- `Suspense` صفحهٔ Loading نشان می‌دهد.
- مسیر ناشناخته به Dashboard ریدایرکت می‌شود.

---

## ۳. API Client

`web/src/lib/api.ts` تنها نقطهٔ تماس با سرور است:

```ts
const BASE = '/api';

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limit);
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    signal: controller.signal,
  });
  if (!res.ok) {
    throw new ApiError(message, res.status, { code: 'HTTP' });
  }
  return data as T;
}
```

ویژگی‌ها:

- Timeout پیش‌فرض ۳۰ ثانیه؛ آپلود ۱۲۰ ثانیه و گزارش/Backup سنگین ۱۸۰ ثانیه.
- `AbortSignal` برای تغییر فیلتر/Unmount.
- `ApiError` یکسان برای HTTP/Timeout/Network.
- CSRF از کوکی `nw_csrf`.
- 401 رویداد `nw:unauthorized` می‌فرستد.

```ts
export const api = {
  me: () => request<{ user: AuthUser }>('/auth/me'),
  devices: (params = {}, signal?: AbortSignal) =>
    request<Paged<Device>>(`/devices${qs(params)}`, { signal }),
};
```

---

## ۴. Auth و مجوز

`web/src/lib/auth.tsx`:

```tsx
const can = useCallback(
  (permission: string) => !!user?.permissions?.includes(permission),
  [user]
);
```

- `user.permissions` از `/auth/me` می‌آید.
- UI برای تجربهٔ کاربر دکمه را پنهان می‌کند.
- **سرور همیشه مرجع است**؛ پنهان‌کردن دکمه جای 403 را نمی‌گیرد.

نمونهٔ واقعی `DeviceDetail.tsx`:

```tsx
const canReveal = can('credentials:reveal');

if (!device || !canReveal || passwordBusy) return;
const creds = await api.deviceCredentials(device.id);
setRevealedPassword(creds.password);
```

---

## ۵. State

| ماژول | مسئولیت |
| --- | --- |
| `lib/auth.tsx` | کاربر، مجوز، ورود/خروج |
| `lib/store.tsx` | Settings، Meta، Status، SSE |
| `lib/params.ts` | فیلترها در Query String |
| `lib/async-gate.ts` | جلوگیری از پاسخ کهنه |
| `lib/format.ts` | قالب‌بندی فارسی/تاریخ |

قاعده: دادهٔ «مالک سرور» را در چند کامپوننت تکرار نکنید. از Store مشترک
بخوانید تا یک رویداد SSE همه را هم‌زمان به‌روز کند.

---

## ۶. فرم و خطا

الگوی پیشنهادی:

1. State محلی برای فیلدها.
2. اعتبارسنجی سمت کلاینت برای UX.
3. ارسال به API.
4. نمایش خطای `ApiError` با پیام سرور.
5. دکمه در حین ارسال غیرفعال.
6. پس از موفقیت، Toast و Refresh.

```tsx
try {
  await api.updateDevice(id, values);
  push('تجهیز ذخیره شد', 'success');
  await refresh();
} catch (e) {
  push(e instanceof ApiError ? e.message : 'ذخیره ناموفق بود', 'error');
}
```

---

## ۷. افزودن صفحهٔ تازه

1. فایل در `web/src/pages/`.
2. مسیر در `App.tsx`.
3. تایپ و API در `types.ts` و `api.ts`.
4. آیتم منو در `Layout.tsx`.
5. کنترل مجوز.
6. `npm run typecheck && npm run test:web`.
7. در صورت نیاز E2E.

---

## ۸. RTL و دسترس‌پذیری

- `index.html` با `lang="fa" dir="rtl"`.
- فونت Vazirmatn محلی.
- رنگ تنها نشانهٔ وضعیت نیست؛ آیکن/متن هم لازم است.
- دکمه‌ها `aria-label` مناسب داشته باشند.
- جدول بزرگ با `VirtualList`.
- Focus و Keyboard قابل استفاده باشد.

---

## ۹. تمرین

1. یک صفحهٔ ساده بسازید و route آن را اضافه کنید.
2. یک API جدید را در `types.ts` و `api.ts` تایپ کنید.
3. دکمه‌ای بسازید که فقط با مجوز خاص دیده شود.
4. خطای Timeout را در UI نمایش دهید.

---

## ۱۰. چک‌لیست پایان فصل

- [ ] ترتیب Providerها را می‌دانم.
- [ ] Lazy Loading و Suspense را می‌فهمم.
- [ ] API Client و ApiError را می‌شناسم.
- [ ] `can()` را برای UI و سرور را برای امنیت استفاده می‌کنم.
- [ ] State مشترک را در Store نگه می‌دارم.
- [ ] صفحهٔ تازه را با تست و تایپ اضافه می‌کنم.

**فصل بعد:** [UI، نقشه، دیاگرام و نمودار](13-ui-maps-diagrams-charts.md)
