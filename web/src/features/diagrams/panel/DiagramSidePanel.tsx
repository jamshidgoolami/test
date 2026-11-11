import type { ReactNode } from 'react';
import type { PanelTab } from '../editor/types';
import { DiagramPanelTabs } from './DiagramPanelTabs';

interface DiagramSidePanelProps {
  open: boolean;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  onClose: () => void;
  tree: ReactNode;
  devices: ReactNode;
  inspector: ReactNode;
}

/**
 * قاب پنل کناری و انتخاب محتوای تب.
 * محتوای هر تب همان کامپوننت تخصصی خودش را می‌گیرد تا منطق دامنه در قاب
 * پنل تکرار نشود: درخت دیاگرام، فهرست تجهیزات و بازرس انتخاب.
 */
export function DiagramSidePanel({ open, tab, onTabChange, onClose, tree, devices, inspector }: DiagramSidePanelProps) {
  return (
    <aside
      className={`shrink-0 overflow-hidden transition-[width] duration-300 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 ${
        open ? 'w-[300px] max-md:shadow-pop' : 'w-0'
      }`}
      aria-hidden={!open}
    >
      <div className="flex h-full w-[300px] flex-col overflow-hidden rounded-2xl border border-ink-200/70 bg-surface/90 shadow-soft">
        <DiagramPanelTabs tab={tab} onTabChange={onTabChange} onClose={onClose} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'tree' ? tree : tab === 'devices' ? devices : inspector}
        </div>
      </div>
    </aside>
  );
}
