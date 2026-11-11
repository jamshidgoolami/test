import { Layers, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Card } from '../../../components/ui';
import { GroupRow } from './GroupRow';

export function GroupSidebar({
  open,
  onToggle,
  groups,
  selected,
  onSelect,
}: {
  open: boolean;
  onToggle: () => void;
  groups: { id: number; name: string; color: string; total: number; online: number; offline: number }[];
  selected: string;
  onSelect: (name: string) => void;
}) {
  const totals = groups.reduce(
    (acc, g) => ({ total: acc.total + g.total, online: acc.online + g.online, offline: acc.offline + g.offline }),
    { total: 0, online: 0, offline: 0 }
  );
  return (
    <Card id="device-groups" className={open ? '' : '!w-fit !p-1.5'}>
      <div className={`flex items-center gap-2 ${open ? '' : 'justify-center'}`}>
        {open ? (
          <>
            <Layers size={16} className="text-brand-500" />
            <h3 className="text-[14px] font-semibold text-ink-800">گروه‌های تجهیزات</h3>
          </>
        ) : null}
        <button
          type="button"
          className={`btn-ghost btn-xs ${open ? 'ms-auto' : ''}`}
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="device-group-list"
          title={open ? 'بستن گروه‌ها' : 'بازکردن گروه‌ها'}
          aria-label={open ? 'بستن گروه‌ها' : 'بازکردن گروه‌ها'}
        >
          {open ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>
      </div>
      <div id="device-group-list" hidden={!open} className="mt-3 space-y-1.5">
        <GroupRow
          name="همه گروه‌ها"
          color="#2563eb"
          total={totals.total}
          online={totals.online}
          offline={totals.offline}
          active={!selected}
          onClick={() => onSelect('')}
        />
        {groups.map((g) => (
          <GroupRow
            key={g.id}
            name={g.name}
            color={g.color}
            total={g.total}
            online={g.online}
            offline={g.offline}
            active={selected === g.name}
            onClick={() => onSelect(selected === g.name ? '' : g.name)}
          />
        ))}
        {groups.length === 0 ? <p className="py-4 text-center text-[11px] text-ink-400">گروهی تعریف نشده است</p> : null}
      </div>
    </Card>
  );
}
