import { X } from 'lucide-react';
import type { PanelTab } from '../editor/types';

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'tree', label: 'دیاگرام‌ها' },
  { id: 'devices', label: 'تجهیزات' },
  { id: 'inspector', label: 'مشخصات' },
];

interface DiagramPanelTabsProps {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  onClose: () => void;
}

/** نوار تب پنل؛ فقط جابه‌جایی بین تب‌ها و بستن پنل را مدیریت می‌کند. */
export function DiagramPanelTabs({ tab, onTabChange, onClose }: DiagramPanelTabsProps) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-ink-100 px-2 py-1.5">
      {TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`rounded-lg px-2 py-1 text-[11.5px] font-medium transition ${
            tab === item.id ? 'bg-brand-50 text-accent' : 'text-ink-500 hover:bg-ink-50'
          }`}
          onClick={() => onTabChange(item.id)}
          aria-pressed={tab === item.id}
        >
          {item.label}
        </button>
      ))}
      <button
        type="button"
        className="ms-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
        onClick={onClose}
        title="بستن پنل کناری"
        aria-label="بستن پنل کناری"
      >
        <X size={13} />
        بستن
      </button>
    </div>
  );
}
