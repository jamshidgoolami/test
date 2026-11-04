import type { WidgetDef } from '../components/widgets';

/** بخش‌های صفحه جزئیات تجهیز که قابل جابه‌جایی/حذف/تغییر اندازه هستند */
export const DETAIL_WIDGETS: WidgetDef[] = [
  { id: 'general', title: 'اطلاعات عمومی', defaultSize: 'sm', defaultHeight: 'md', description: 'مشخصات پایه تجهیز' },
  { id: 'monitoring', title: 'اطلاعات مانیتورینگ', defaultSize: 'lg', defaultHeight: 'lg', description: 'متریک‌های پایش و آستانه‌ها' },
  { id: 'charts', title: 'نمودارهای تاریخی', defaultSize: 'full', defaultHeight: 'xl', description: 'تأخیر، افت بسته، وضعیت و دسترس‌پذیری' },
  { id: 'daily', title: 'روند دسترس‌پذیری روزانه', defaultSize: 'full', defaultHeight: 'md', description: '۱۴ روز گذشته' },
  { id: 'outages', title: 'تاریخچه اختلالات و قطعی‌ها', defaultSize: 'full', defaultHeight: 'lg' },
  { id: 'maintenance', title: 'سوابق تعمیرات و نگهداری', defaultSize: 'full', defaultHeight: 'md', description: 'فقط سوابق ثبت‌شده توسط کاربر' },
];

/**
 * ویجت‌های داشبورد
 *
 * همهٔ ویجت‌ها یک ارتفاع پیش‌فرض یکسان دارند تا شبکهٔ داشبورد یکدست بماند؛
 * ارتفاع هر ویجت را می‌توان جداگانه از حالت «چیدمان» تغییر داد.
 */
export const DASHBOARD_WIDGETS: WidgetDef[] = [
  { id: 'kpis', title: 'شاخص‌های کلیدی (KPI)', defaultSize: 'full', defaultHeight: 'md', description: 'کارت‌های آماری بالای صفحه' },
  { id: 'network-health', title: 'سلامت شبکه', defaultSize: 'md', defaultHeight: 'md', description: 'وضعیت تجهیزات، قطعی‌ها و کیفیت اتصال' },
  { id: 'app-health', title: 'سلامت برنامه', defaultSize: 'md', defaultHeight: 'md', description: 'سرور، پایگاه‌داده، موتور و زیرساخت اجرا' },
  { id: 'health', title: 'شاخص سلامت شبکه', defaultSize: 'md', defaultHeight: 'md' },
  { id: 'distribution', title: 'وضعیت لحظه‌ای تجهیزات', defaultSize: 'md', defaultHeight: 'md' },
  { id: 'degraded', title: 'تجهیزات دارای افت کیفیت', defaultSize: 'md', defaultHeight: 'md' },
  { id: 'offline-trend', title: 'تغییرات تجهیزات قطع‌شده', defaultSize: 'lg', defaultHeight: 'md' },
  { id: 'outages-per-day', title: 'تعداد قطعی‌ها به تفکیک روز', defaultSize: 'sm', defaultHeight: 'md' },
  { id: 'health-trend', title: 'روند شاخص سلامت و دسترس‌پذیری', defaultSize: 'md', defaultHeight: 'md' },
  { id: 'group-status', title: 'وضعیت گروه‌های تجهیزات', defaultSize: 'md', defaultHeight: 'md' },
  { id: 'top-latency', title: 'بیشترین تأخیر', defaultSize: 'md', defaultHeight: 'md', description: 'با جست‌وجوی سریع بین تجهیزات' },
  { id: 'top-downtime', title: 'بیشترین قطعی', defaultSize: 'md', defaultHeight: 'md', description: 'مجموع مدت قطعی ۷ روز گذشته' },
  { id: 'top-loss', title: 'بیشترین افت بسته', defaultSize: 'sm', defaultHeight: 'md', description: 'تجهیزات با کیفیت ارتباط ضعیف' },
  { id: 'open-outages', title: 'قطعی‌های باز', defaultSize: 'md', defaultHeight: 'md', description: 'تجهیزات خارج از دسترس در همین لحظه' },
  { id: 'type-distribution', title: 'نوع تجهیز', defaultSize: 'sm', defaultHeight: 'md', description: 'تعداد و وضعیت اتصال به تفکیک نوع' },
  { id: 'group-breakdown', title: 'گروه تجهیزات', defaultSize: 'sm', defaultHeight: 'md', description: 'تعداد و وضعیت اتصال در هر گروه' },
  { id: 'vendor-breakdown', title: 'سازنده', defaultSize: 'sm', defaultHeight: 'md', description: 'تعداد و وضعیت اتصال به تفکیک سازنده' },
  { id: 'model-breakdown', title: 'مدل', defaultSize: 'sm', defaultHeight: 'md', description: 'تعداد و وضعیت اتصال به تفکیک مدل' },
  { id: 'tag-breakdown', title: 'تگ‌ها', defaultSize: 'sm', defaultHeight: 'md', description: 'تعداد و وضعیت اتصال تجهیزات هر تگ' },
  { id: 'recent-alerts', title: 'آخرین هشدارها', defaultSize: 'lg', defaultHeight: 'md', description: 'با فیلتر شدت هشدار' },
  { id: 'avg-rtt', title: 'میانگین تأخیر شبکه', defaultSize: 'sm', defaultHeight: 'md' },
  { id: 'quick-links', title: 'نکات کاربردی', defaultSize: 'full', defaultHeight: 'md' },
];
