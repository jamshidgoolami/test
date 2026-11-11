import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, ChevronDown, ChevronLeft, Crosshair, Eye, EyeOff, Layers, MapPin, Plus } from 'lucide-react';
import { EmptyState, StatusPill } from '../../../components/ui';
import { VirtualList } from '../../../components/VirtualList';
import { faDigits } from '../../../lib/format';
import type { MapDevice, MapSite } from '../model/types';

/* ============================== فهرست تجهیزات ============================== */
/** یک ردیف فهرست: سرتیتر گروه، ایستگاه زیرمجموعهٔ گروه، یا یک تجهیز */
export type ListRow =
  | { kind: 'group'; key: string; group: string; name: string; count: number; positioned: number; hidden: boolean }
  | { kind: 'site'; key: string; site: MapSite; count: number; hidden: boolean }
  | { kind: 'device'; key: string; device: MapDevice; inSite: boolean };

export function DeviceList({
  devices,
  groups,
  sites,
  hiddenGroups,
  hiddenSiteIds,
  onToggleGroup,
  onToggleSite,
  onAddSite,
  selectedId,
  onFlyTo,
  onFlyToSite,
  onDragStart,
}: {
  devices: MapDevice[];
  groups: string[];
  sites: MapSite[];
  hiddenGroups: string[];
  hiddenSiteIds: number[];
  onToggleGroup: (group: string) => void;
  onToggleSite: (siteId: number) => void;
  onAddSite: () => void;
  selectedId: number | null;
  onFlyTo: (id: number) => void;
  onFlyToSite: (siteId: number) => void;
  onDragStart: (id: number) => void;
}) {
  // گروه‌ها/ایستگاه‌های جمع‌شده فقط در فهرست پنهان می‌شوند؛ نمایش روی نقشه با Eye کنترل می‌شود.
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [collapsedSites, setCollapsedSites] = useState<number[]>([]);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const rows = useMemo<ListRow[]>(() => {
    const buckets = new Map<string, { devices: MapDevice[]; sites: MapSite[] }>();
    const bucket = (g: string) => {
      let entry = buckets.get(g);
      if (!entry) {
        entry = { devices: [], sites: [] };
        buckets.set(g, entry);
      }
      return entry;
    };
    for (const d of devices) bucket(d.groupName || '__none__').devices.push(d);
    for (const s of sites) bucket(s.groupName || '__none__').sites.push(s);
    const names = [...buckets.keys()].sort((a, b) => {
      // «بدون گروه» همیشه آخر می‌آید
      if (a === '__none__') return 1;
      if (b === '__none__') return -1;
      return a.localeCompare(b, 'fa');
    });
    const out: ListRow[] = [];
    for (const g of names) {
      const entry = buckets.get(g)!;
      const siteList = [...entry.sites].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
      const deviceList = [...entry.devices].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
      const groupHidden = hiddenGroups.includes(g);
      out.push({
        kind: 'group',
        key: `g:${g}`,
        group: g,
        name: g === '__none__' ? 'بدون گروه' : g,
        count: deviceList.length + siteList.reduce((sum, s) => sum + s.devices.length, 0),
        positioned: deviceList.filter((d) => d.latitude != null && d.longitude != null).length,
        hidden: groupHidden,
      });
      if (groupHidden || collapsed.includes(g)) continue;
      // ایستگاه‌ها زیرمجموعهٔ گروه می‌آیند و تجهیزات عضو آن‌ها فقط داخل خود
      // ایستگاه فهرست می‌شوند؛ بدین‌ترتیب هر تجهیز یک ردیف دارد.
      for (const site of siteList) {
        const siteHidden = hiddenSiteIds.includes(site.id);
        out.push({ kind: 'site', key: `s:${site.id}`, site, count: site.devices.length, hidden: siteHidden });
        if (siteHidden || collapsedSites.includes(site.id)) continue;
        for (const d of site.devices) out.push({ kind: 'device', key: `d:${d.id}`, device: d, inSite: true });
      }
      for (const d of deviceList) out.push({ kind: 'device', key: `d:${d.id}`, device: d, inSite: false });
    }
    return out;
  }, [devices, sites, hiddenGroups, hiddenSiteIds, collapsed, collapsedSites]);

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col">
      {/* نوار فشردهٔ نمایش گروه‌ها + افزودن ایستگاه */}
      <div className="mb-2 mt-2.5 flex items-center gap-1.5">
        <div className="relative">
          <button
            type="button"
            className="btn-ghost btn-xs border border-ink-200 !px-2"
            onClick={() => setGroupsOpen((value) => !value)}
            aria-expanded={groupsOpen}
            title="نمایش یا مخفی کردن گروه‌ها روی نقشه"
          >
            <Layers size={11} />
            نمایش گروه‌ها
            {hiddenGroups.length ? (
              <span className="num text-[9.5px] text-ink-400">{faDigits(hiddenGroups.length)}</span>
            ) : null}
            <ChevronDown size={11} className={`transition ${groupsOpen ? 'rotate-180' : ''}`} />
          </button>
          {groupsOpen ? (
            <div className="absolute right-0 top-full z-30 mt-1 max-h-56 w-52 overflow-auto rounded-soft border border-ink-200 bg-surface p-2 shadow-pop">
              {groups.length === 0 ? <p className="text-[10.5px] text-ink-400">گروهی وجود ندارد</p> : null}
              <div className="flex flex-wrap gap-1">
                {groups.map((g) => {
                  const hidden = hiddenGroups.includes(g);
                  const label = g === '__none__' ? 'بدون گروه' : g;
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => onToggleGroup(g)}
                      className={`inline-flex items-center gap-1 rounded-pill border px-1.5 py-0.5 text-[10px] transition ${
                        hidden
                          ? 'border-ink-200 bg-ink-50 text-ink-400 line-through'
                          : 'border-brand-200 bg-brand-50 text-accent'
                      }`}
                      aria-pressed={!hidden}
                      title={hidden ? `نمایش ${label}` : `مخفی کردن ${label}`}
                    >
                      {hidden ? <EyeOff size={9} /> : <Eye size={9} />}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="btn-primary btn-xs"
          onClick={onAddSite}
          title="تعریف ایستگاه از تجهیزات یک گروه"
        >
          <Plus size={11} />
          افزودن ایستگاه
        </button>
      </div>
      {/* فهرست مجازی با ارتفاع متغیر: سرتیتر گروه‌ها هم داخل همان فهرست
          رندر می‌شوند تا با هزاران تجهیز، DOM سبک بماند. */}
      <VirtualList
        items={rows}
        itemHeight={56}
        heightOf={(r) => (r.kind === 'group' ? 34 : r.kind === 'site' ? 32 : 56)}
        keyOf={(r) => r.key}
        empty={
          <EmptyState
            title="تجهیزی یافت نشد"
            description="با فیلترهای فعلی تجهیزی نیست؛ فیلتر جست‌وجو/وضعیت/گروه را تغییر دهید یا تجهیز جدید بسازید."
            icon={<MapPin size={22} />}
          />
        }
        render={(row) =>
          row.kind === 'site' ? (
            <div className="flex h-[32px] items-center justify-between gap-1 border-b border-ink-100/70 pb-1 pt-1">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 pe-1 text-right"
                onClick={() =>
                  setCollapsedSites((prev) =>
                    prev.includes(row.site.id) ? prev.filter((id) => id !== row.site.id) : [...prev, row.site.id]
                  )
                }
                title={collapsedSites.includes(row.site.id) ? 'باز کردن ایستگاه' : 'جمع کردن ایستگاه'}
              >
                {collapsedSites.includes(row.site.id) ? (
                  <ChevronLeft size={12} className="shrink-0 text-ink-400" />
                ) : (
                  <ChevronDown size={12} className="shrink-0 text-ink-400" />
                )}
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded-[5px] bg-brand-50 text-accent">
                  <Building2 size={9} />
                </span>
                <span className="truncate text-[11px] font-medium text-ink-600">{row.site.name}</span>
                <span className="num shrink-0 rounded-pill bg-ink-100 px-1.5 text-[9.5px] text-ink-500">
                  {faDigits(row.count)}
                </span>
              </button>
              <button
                type="button"
                className="btn-ghost btn-xs shrink-0 !px-1"
                onClick={() => onFlyToSite(row.site.id)}
                title="نمایش ایستگاه روی نقشه"
              >
                <Crosshair size={11} />
              </button>
              <button
                type="button"
                className="btn-ghost btn-xs shrink-0 !px-1"
                onClick={() => onToggleSite(row.site.id)}
                title={row.hidden ? 'نمایش ایستگاه روی نقشه' : 'مخفی کردن ایستگاه روی نقشه'}
                aria-pressed={!row.hidden}
              >
                {row.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
            </div>
          ) : row.kind === 'group' ? (
            <div className="flex h-[34px] items-center justify-between gap-1 border-b border-ink-100 pb-1 pt-1.5">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 text-right"
                onClick={() =>
                  setCollapsed((prev) =>
                    prev.includes(row.group) ? prev.filter((g) => g !== row.group) : [...prev, row.group]
                  )
                }
                title={collapsed.includes(row.group) ? 'باز کردن گروه' : 'جمع کردن گروه'}
              >
                {collapsed.includes(row.group) ? (
                  <ChevronLeft size={13} className="shrink-0 text-ink-400" />
                ) : (
                  <ChevronDown size={13} className="shrink-0 text-ink-400" />
                )}
                <span className="truncate text-[11.5px] font-semibold text-ink-600">{row.name}</span>
                <span className="num shrink-0 rounded-pill bg-ink-100 px-1.5 text-[10px] text-ink-500">
                  {faDigits(row.count)}
                </span>
              </button>
              <button
                type="button"
                className="btn-ghost btn-xs shrink-0 !px-1"
                onClick={() => onToggleGroup(row.group)}
                title={row.hidden ? `نمایش ${row.name} روی نقشه` : `مخفی کردن ${row.name} روی نقشه`}
                aria-pressed={!row.hidden}
              >
                {row.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                <span className="num text-[9.5px] text-ink-400">
                  {faDigits(row.positioned)}/{faDigits(row.count)}
                </span>
              </button>
            </div>
          ) : (
            <div
              draggable
              style={{ marginInlineStart: row.inSite ? 12 : 0 }}
              onDragStart={(e) => {
                const d = row.device;
                e.dataTransfer.setData('text/nw-device', String(d.id));
                e.dataTransfer.setData('text/plain', String(d.id));
                e.dataTransfer.effectAllowed = 'move';
                onDragStart(d.id);
              }}
              className={`mb-1 flex h-[52px] cursor-grab items-center justify-between gap-2 rounded-soft border bg-surface/70 px-2.5 py-2 transition active:cursor-grabbing ${
                selectedId === row.device.id
                  ? 'border-brand-300 ring-1 ring-brand-200'
                  : 'border-ink-100 hover:border-brand-200'
              }`}
              title="برای جانمایی، بکشید و روی نقشه رها کنید"
            >
              <button type="button" className="min-w-0 flex-1 text-right" onClick={() => onFlyTo(row.device.id)}>
                <span className="block truncate text-[12px] font-medium text-ink-700">{row.device.name}</span>
              </button>
              {row.device.latitude == null ? <MapPin size={12} className="shrink-0 text-sun-500" /> : null}
              <StatusPill status={row.device.status} size="sm" showLabel={false} />
              <Link to={`/devices/${row.device.id}`} className="btn-ghost btn-xs">
                جزئیات
              </Link>
            </div>
          )
        }
      />
    </div>
  );
}
