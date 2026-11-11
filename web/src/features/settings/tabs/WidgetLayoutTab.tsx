import { LayoutGrid, RotateCcw } from 'lucide-react';

import { useToast } from '../../../lib/store';

import { Card, CardHeader } from '../../../components/ui';

import { WidgetVisibilityRow, useWidgetLayout } from '../../../components/widgets';
import { DETAIL_WIDGETS, DASHBOARD_WIDGETS } from '../../../lib/widgetdefs';

export function WidgetLayoutTab() {
  const detail = useWidgetLayout('device_detail_widgets', DETAIL_WIDGETS);
  const dash = useWidgetLayout('dashboard_widgets', DASHBOARD_WIDGETS);
  const { push } = useToast();

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="چیدمان صفحه جزئیات تجهیزات"
          subtitle="ترتیب، عرض، ارتفاع و نمایش/مخفی بودن بخش‌های مختلف صفحه جزئیات تجهیز را تعیین کنید"
          icon={<LayoutGrid size={18} />}
          action={
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => {
                detail.reset();
                push('چیدمان پیش‌فرض بازنشانی شد', 'success');
              }}
            >
              <RotateCcw size={13} />
              بازنشانی
            </button>
          }
        />
        <div className="mt-4 space-y-2">
          {detail.layout.map((item, idx) => {
            const def = DETAIL_WIDGETS.find((d) => d.id === item.id);
            if (!def) return null;
            return (
              <WidgetVisibilityRow
                key={item.id}
                def={def}
                item={item}
                onVisible={(v) => detail.setVisible(item.id, v)}
                onSize={(s) => detail.setSize(item.id, s)}
                onHeight={(h) => detail.setHeight(item.id, h)}
                onUp={() => idx > 0 && detail.move(item.id, detail.layout[idx - 1].id)}
                onDown={() => idx < detail.layout.length - 1 && detail.move(item.id, detail.layout[idx + 1].id)}
                onMove={(sourceId) => detail.move(sourceId, item.id)}
              />
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="چیدمان داشبورد"
          subtitle="ترتیب، عرض، ارتفاع دقیق و نمایش/مخفی بودن ویجت‌های داشبورد را تعیین کنید"
          icon={<LayoutGrid size={18} />}
          action={
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => {
                dash.reset();
                push('چیدمان پیش‌فرض بازنشانی شد', 'success');
              }}
            >
              <RotateCcw size={13} />
              بازنشانی
            </button>
          }
        />
        <div className="mt-4 space-y-2">
          {dash.layout.map((item, idx) => {
            const def = DASHBOARD_WIDGETS.find((d) => d.id === item.id);
            if (!def) return null;
            return (
              <WidgetVisibilityRow
                key={item.id}
                def={def}
                item={item}
                onVisible={(v) => dash.setVisible(item.id, v)}
                onSize={(s) => dash.setSize(item.id, s)}
                onHeight={(h) => dash.setHeight(item.id, h)}
                onUp={() => idx > 0 && dash.move(item.id, dash.layout[idx - 1].id)}
                onDown={() => idx < dash.layout.length - 1 && dash.move(item.id, dash.layout[idx + 1].id)}
                onMove={(sourceId) => dash.move(sourceId, item.id)}
              />
            );
          })}
        </div>
      </Card>

      <p className="rounded-soft border border-ink-200 bg-surface/70 p-3 text-[11.5px] leading-relaxed text-ink-500">
        تغییرات بلافاصله ذخیره می‌شوند. برای تغییر اولویت نمایش، نام یا دستگیرهٔ کنار هر ویجت را بگیرید و بالا یا پایین
        بکشید. در صفحه داشبورد و جزئیات تجهیز می‌توانید با دکمهٔ «شخصی‌سازی» ویجت‌ها را روی خود صفحه هم جابه‌جا، تغییر
        عرض، حذف یا اضافه کنید؛ برای ارتفاع دلخواه، لبهٔ پایین ویجت را به بالا یا پایین بکشید.
      </p>
    </div>
  );
}
