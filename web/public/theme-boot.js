/*
 * اعمال تم پیش از رسم صفحه.
 *
 * این فایل بیرون از بستهٔ React و پیش از استایل‌ها اجرا می‌شود تا اگر کاربر تم
 * تاریک را انتخاب کرده باشد، لحظهٔ بارگذاری صفحه سفید/روشن دیده نشود. منطق آن
 * عیناً همان `web/src/lib/theme.tsx` است؛ اسکریپت درون‌خطی به‌دلیل CSP
 * (`script-src 'self'`) مجاز نیست، بنابراین یک فایل مستقل است.
 */
(function () {
  try {
    var saved = localStorage.getItem('nw.theme');
    var dark =
      saved === 'dark' ||
      ((!saved || saved === 'system') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.style.colorScheme = dark ? 'dark' : 'light';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#090d14' : '#f6f8fb');
  } catch (error) {
    /* دسترسی به حافظهٔ مرورگر ممکن نیست؛ تم پیش‌فرض سیستم اعمال می‌شود */
  }
})();
