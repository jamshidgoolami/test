/** @type {import('tailwindcss').Config} */
export default {
  content: { relative: true, files: ['./index.html', './src/**/*.{ts,tsx}'] },
  theme: {
    extend: {
      fontFamily: {
        sans: ['Vazirmatn', 'system-ui', 'Segoe UI', 'Tahoma', 'sans-serif'],
      },
      /*
       * همهٔ رنگ‌ها از متغیرهای CSS خوانده می‌شوند تا تم روشن/تاریک تنها با
       * تعویض همان متغیرها روی <html> عوض شود؛ کلاس‌های موجود در صفحه‌ها
       * (bg-white، text-ink-700، border-ink-200 و …) دست‌نخورده می‌مانند.
       * کانال‌های رنگی با فاصله ذخیره می‌شوند تا مودیفایر شفافیت کار کند.
       */
      colors: {
        brand: {
          50: 'rgb(var(--nw-brand-50) / <alpha-value>)',
          100: 'rgb(var(--nw-brand-100) / <alpha-value>)',
          200: 'rgb(var(--nw-brand-200) / <alpha-value>)',
          300: 'rgb(var(--nw-brand-300) / <alpha-value>)',
          400: 'rgb(var(--nw-brand-400) / <alpha-value>)',
          500: 'rgb(var(--nw-brand-500) / <alpha-value>)',
          600: 'rgb(var(--nw-brand-600) / <alpha-value>)',
          700: 'rgb(var(--nw-brand-700) / <alpha-value>)',
          800: 'rgb(var(--nw-brand-800) / <alpha-value>)',
          900: 'rgb(var(--nw-brand-900) / <alpha-value>)',
          950: 'rgb(var(--nw-brand-950) / <alpha-value>)',
        },
        sun: {
          50: 'rgb(var(--nw-sun-50) / <alpha-value>)',
          100: 'rgb(var(--nw-sun-100) / <alpha-value>)',
          200: 'rgb(var(--nw-sun-200) / <alpha-value>)',
          300: 'rgb(var(--nw-sun-300) / <alpha-value>)',
          400: 'rgb(var(--nw-sun-400) / <alpha-value>)',
          500: 'rgb(var(--nw-sun-500) / <alpha-value>)',
          600: 'rgb(var(--nw-sun-600) / <alpha-value>)',
          700: 'rgb(var(--nw-sun-700) / <alpha-value>)',
          800: 'rgb(var(--nw-sun-800) / <alpha-value>)',
        },
        ink: {
          50: 'rgb(var(--nw-ink-50) / <alpha-value>)',
          100: 'rgb(var(--nw-ink-100) / <alpha-value>)',
          200: 'rgb(var(--nw-ink-200) / <alpha-value>)',
          300: 'rgb(var(--nw-ink-300) / <alpha-value>)',
          400: 'rgb(var(--nw-ink-400) / <alpha-value>)',
          500: 'rgb(var(--nw-ink-500) / <alpha-value>)',
          600: 'rgb(var(--nw-ink-600) / <alpha-value>)',
          700: 'rgb(var(--nw-ink-700) / <alpha-value>)',
          800: 'rgb(var(--nw-ink-800) / <alpha-value>)',
          900: 'rgb(var(--nw-ink-900) / <alpha-value>)',
        },
        /* فقط پله‌های روشن رنگ‌های وضعیت بازتعریف می‌شوند (پس‌زمینه/حاشیهٔ
           کم‌رنگ)؛ پله‌های ۴۰۰ به بالا همان رنگ‌های پیش‌فرض Tailwind می‌مانند
           تا نشانگرها و دکمه‌های توپر در هر دو تم یکسان دیده شوند. */
        red: {
          50: 'rgb(var(--nw-red-50) / <alpha-value>)',
          100: 'rgb(var(--nw-red-100) / <alpha-value>)',
          200: 'rgb(var(--nw-red-200) / <alpha-value>)',
          300: 'rgb(var(--nw-red-300) / <alpha-value>)',
        },
        emerald: {
          50: 'rgb(var(--nw-emerald-50) / <alpha-value>)',
          100: 'rgb(var(--nw-emerald-100) / <alpha-value>)',
          200: 'rgb(var(--nw-emerald-200) / <alpha-value>)',
          300: 'rgb(var(--nw-emerald-300) / <alpha-value>)',
        },
        sky: {
          200: 'rgb(var(--nw-sky-200) / <alpha-value>)',
        },
        violet: {
          50: 'rgb(var(--nw-violet-50) / <alpha-value>)',
          200: 'rgb(var(--nw-violet-200) / <alpha-value>)',
          600: 'rgb(var(--nw-violet-600) / <alpha-value>)',
          700: 'rgb(var(--nw-violet-700) / <alpha-value>)',
        },
        /* رنگ‌های معنایی: در تم تاریک روشن‌تر می‌شوند تا روی سطح تیره خوانا بمانند */
        surface: 'rgb(var(--nw-surface) / <alpha-value>)',
        scrim: 'rgb(var(--nw-scrim) / <alpha-value>)',
        accent: 'rgb(var(--nw-accent) / <alpha-value>)',
        danger: 'rgb(var(--nw-danger) / <alpha-value>)',
        success: 'rgb(var(--nw-success) / <alpha-value>)',
        warning: 'rgb(var(--nw-warning) / <alpha-value>)',
        info: 'rgb(var(--nw-info) / <alpha-value>)',
      },
      borderRadius: {
        card: '20px',
        soft: '14px',
        pill: '999px',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,23,42,0.04), 0 10px 24px -18px rgba(15,23,42,0.25)',
        card: '0 1px 3px rgba(15,23,42,0.05), 0 18px 40px -28px rgba(15,23,42,0.30)',
        pop: '0 24px 60px -30px rgba(15,23,42,0.35), 0 2px 8px rgba(15,23,42,0.06)',
        glow: '0 0 0 1px rgba(37,99,235,0.08), 0 16px 34px -20px rgba(37,99,235,0.55)',
      },
      backgroundImage: {
        'grid-soft':
          'linear-gradient(to right, rgba(148,163,184,0.10) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.10) 1px, transparent 1px)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.85)', opacity: '0.75' },
          '70%': { transform: 'scale(1.6)', opacity: '0' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        shimmer: {
          '100%': { transform: 'translateX(-100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 0.25s ease-out both',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.4,0,0.6,1) infinite',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};
