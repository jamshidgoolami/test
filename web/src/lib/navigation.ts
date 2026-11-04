/**
 * ناوبری سراسری برنامه
 * ----------------------------------------------------------------
 * فهرست صفحه‌ها یک منبع واحد دارد تا منوی کناری، عنوان هدر و Command Palette
 * همه از یک نام و مسیر استفاده کنند. گروه‌بندی، بار شناختی منوی ۱۰ آیتمی را
 * کم می‌کند بدون اینکه صفحه‌ای حذف شود.
 */
export type NavGroupId = 'monitor' | 'operations' | 'insights' | 'admin';

export interface NavItem {
  to: string;
  label: string;
  description: string;
  group: NavGroupId;
  keywords?: string[];
}

export interface NavGroup {
  id: NavGroupId;
  label: string;
  items: NavItem[];
}

const RAW_NAV_GROUPS: { id: NavGroupId; label: string; items: Omit<NavItem, 'group'>[] }[] = [
  {
    id: 'monitor',
    label: 'پایش',
    items: [
      {
        to: '/dashboard',
        label: 'داشبورد',
        description: 'نمای کلی سلامت شبکه، شاخص‌ها و رخدادهای مهم',
        keywords: ['dashboard', 'خانه', 'overview'],
      },
      {
        to: '/devices',
        label: 'تجهیزات شبکه',
        description: 'فهرست تجهیزات، وضعیت، جست‌وجو و عملیات پایش',
        keywords: ['device', 'تجهیز', 'ip', 'سرور', 'سوئیچ'],
      },
      {
        to: '/map',
        label: 'نقشه شبکه',
        description: 'موقعیت جغرافیایی و وضعیت تجهیزات روی نقشه',
        keywords: ['map', 'نقشه', 'موقعیت'],
      },
      {
        to: '/diagrams',
        label: 'دیاگرام شبکه',
        description: 'توپولوژی، ارتباط تجهیزات و نقشهٔ شبکه',
        keywords: ['diagram', 'topology', 'توپولوژی'],
      },
    ],
  },
  {
    id: 'operations',
    label: 'عملیات',
    items: [
      {
        to: '/alerts',
        label: 'هشدارها',
        description: 'هشدارهای فعال، قطعی‌ها و قوانین هشدار',
        keywords: ['alert', 'هشدار', 'قطعی', 'incident'],
      },
      {
        to: '/maintenance',
        label: 'تعمیرات و نگهداری',
        description: 'سوابق خرابی، تعمیرات و بازه‌های نگهداری',
        keywords: ['maintenance', 'تعمیر', 'خرابی'],
      },
    ],
  },
  {
    id: 'insights',
    label: 'تحلیل و گزارش',
    items: [
      {
        to: '/reports',
        label: 'گزارش‌ها و تحلیل',
        description: 'گزارش دسترس‌پذیری، کیفیت ارتباط و آمار دارایی',
        keywords: ['report', 'گزارش', 'تحلیل', 'sla'],
      },
      {
        to: '/templates',
        label: 'قالب‌های تجهیز',
        description: 'تعریف تنظیمات مشترک و اعمال گروهی روی تجهیزات',
        keywords: ['template', 'قالب', 'الگو'],
      },
      {
        to: '/app-health',
        label: 'سلامت برنامه',
        description: 'وضعیت سرور، پایگاه‌داده، موتور و زیرساخت اجرا',
        keywords: ['health', 'سلامت', 'سرور', 'database'],
      },
    ],
  },
  {
    id: 'admin',
    label: 'مدیریت',
    items: [
      {
        to: '/settings',
        label: 'تنظیمات',
        description: 'تنظیمات عمومی، موتور، داده‌ها، کاربران و ظاهر برنامه',
        keywords: ['settings', 'تنظیمات', 'admin', 'مدیریت'],
      },
    ],
  },
];

export const NAV_GROUPS: NavGroup[] = RAW_NAV_GROUPS.map((group) => ({
  ...group,
  items: group.items.map((item) => ({ ...item, group: group.id })),
}));

export const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

/** میان‌برهای عملیاتی Command Palette؛ همه به مسیرهای موجود اشاره می‌کنند. */
export const NAV_ACTIONS: { label: string; to: string; keywords: string[] }[] = [
  { label: 'افزودن تجهیز جدید', to: '/devices?new=1', keywords: ['add', 'device', 'تجهیز', 'جدید'] },
  { label: 'مشاهدهٔ تجهیزات قطع‌شده', to: '/devices?status=offline', keywords: ['offline', 'قطع', 'down'] },
  { label: 'مشاهدهٔ هشدارهای فعال', to: '/alerts', keywords: ['alert', 'هشدار', 'فعال'] },
  { label: 'تنظیمات موتور پایش', to: '/settings?tab=engine', keywords: ['engine', 'موتور', 'پایش'] },
  { label: 'گزارش دسترس‌پذیری', to: '/reports', keywords: ['report', 'گزارش', 'دسترس‌پذیری'] },
];

export function navItemForPath(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
}

/** تطبیق سادهٔ متن فارسی/انگلیسی برای جست‌وجوی Command Palette. */
export function matchesQuery(text: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('fa');
  if (!needle) return true;
  return text.toLocaleLowerCase('fa').includes(needle);
}
