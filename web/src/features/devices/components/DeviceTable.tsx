import { useNavigate } from 'react-router-dom';
import { Activity, ArrowUpDown, Edit3, ExternalLink, Trash2, Wifi } from 'lucide-react';
import { StatusPill } from '../../../components/ui';
import { useLivePing } from '../../../components/LivePing';
import { useApp } from '../../../lib/store';
import { faDigits, fmtDate, fmtMs, fmtNumber, fmtPct, fmtRelative } from '../../../lib/format';
import type { Device } from '../../../lib/types';
import { DEVICE_TABLE_COLUMNS, openDeviceAddress } from '../model/table';

export function DeviceTable({
  devices,
  selected,
  allSelected,
  selectable,
  canProbe,
  canWrite,
  onToggleAll,
  onToggle,
  onPing,
  onEdit,
  onDelete,
  sort,
  order,
  onSort,
  visibleColumns,
}: {
  devices: Device[];
  selected: number[];
  allSelected: boolean;
  selectable: boolean;
  canProbe: boolean;
  canWrite: boolean;
  onToggleAll: () => void;
  onToggle: (id: number) => void;
  onPing: (d: Device) => void;
  onEdit: (d: Device) => void;
  onDelete: (d: Device) => void;
  sort: string;
  order: string;
  onSort: (key: string) => void;
  visibleColumns: string[];
}) {
  const navigate = useNavigate();
  const livePing = useLivePing();
  const { tzOffset } = useApp();
  const visible = new Set(visibleColumns);
  const columns = DEVICE_TABLE_COLUMNS.filter((column) => visible.has(column.key));
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {selectable ? (
              <th className="w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAll}
                  className="accent-brand-600"
                  aria-label="انتخاب همه"
                />
              </th>
            ) : null}
            {columns.map((c) => (
              <th key={c.key} className={c.className}>
                {c.sortable ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-accent"
                    onClick={() => onSort(c.key)}
                  >
                    {c.label}
                    <ArrowUpDown size={11} className={sort === c.key ? 'text-brand-500' : 'text-ink-300'} />
                    {sort === c.key ? (
                      <span className="text-[9px] text-brand-500">{order === 'asc' ? '▲' : '▼'}</span>
                    ) : null}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id} className="cursor-pointer" onClick={() => navigate(`/devices/${d.id}`)}>
              {selectable ? (
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.includes(d.id)}
                    onChange={() => onToggle(d.id)}
                    className="accent-brand-600"
                  />
                </td>
              ) : null}
              {visible.has('name') ? (
                <td>
                  <span className="block font-medium text-ink-800">{d.name}</span>
                  {d.location ? <span className="block text-[10.5px] text-ink-400">{d.location}</span> : null}
                </td>
              ) : null}
              {visible.has('ip') ? <td className="num">{d.ip}</td> : null}
              {visible.has('type') ? <td>{d.deviceType}</td> : null}
              {visible.has('group') ? (
                <td>
                  {d.groupName ? (
                    <span
                      className="chip"
                      style={{
                        borderColor: `${d.groupColor}44`,
                        background: `${d.groupColor}12`,
                        color: d.groupColor ?? undefined,
                      }}
                    >
                      {d.groupName}
                      {d.groups && d.groups.length > 1 ? (
                        <span className="num text-[9.5px]">+{faDigits(d.groups.length - 1)}</span>
                      ) : null}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              ) : null}
              {visible.has('installed') ? (
                <td className="num text-[11px] text-ink-500">
                  {d.installedAt ? fmtDate(d.installedAt, tzOffset) : '—'}
                </td>
              ) : null}
              {visible.has('status') ? (
                <td>
                  <StatusPill status={d.status} size="sm" />
                  {d.statusReason && d.status !== 'online' ? (
                    <span
                      className="mt-0.5 block max-w-[220px] truncate text-[10px] text-ink-400"
                      title={d.statusReason}
                    >
                      {d.statusReason}
                    </span>
                  ) : null}
                </td>
              ) : null}
              {visible.has('latency') ? <td className="num">{fmtMs(d.lastRtt)}</td> : null}
              {visible.has('loss') ? <td className="num">{fmtPct(d.lossPct)}</td> : null}
              {visible.has('uptime') ? <td className="num">{fmtPct(d.uptimePct, 2)}</td> : null}
              {visible.has('last_check') ? (
                <td className="text-[11px] text-ink-500">{fmtRelative(d.lastCheckAt)}</td>
              ) : null}
              {visible.has('outages') ? <td className="num">{fmtNumber(d.outageCount ?? 0)}</td> : null}
              {visible.has('actions') ? (
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-center gap-1">
                    {canProbe ? (
                      <>
                        <button
                          type="button"
                          className={`btn-xs ${livePing.has(d.id) ? 'btn-soft' : 'btn-ghost'}`}
                          title="پینگ زنده (هر ثانیه)"
                          onClick={() => livePing.toggle({ id: d.id, name: d.name, ip: d.ip, status: d.status })}
                        >
                          <Activity size={13} />
                        </button>
                        <button type="button" className="btn-ghost btn-xs" title="Ping" onClick={() => onPing(d)}>
                          <Wifi size={13} />
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="btn-ghost btn-xs"
                      title={`بازکردن ${d.ip} در تب جدید`}
                      aria-label={`بازکردن آدرس ${d.ip} در تب جدید`}
                      onClick={() => openDeviceAddress(d)}
                    >
                      <ExternalLink size={13} />
                    </button>
                    {canWrite ? (
                      <>
                        <button type="button" className="btn-ghost btn-xs" title="ویرایش" onClick={() => onEdit(d)}>
                          <Edit3 size={13} />
                        </button>
                        <button type="button" className="btn-ghost btn-xs" title="حذف" onClick={() => onDelete(d)}>
                          <Trash2 size={13} />
                        </button>
                      </>
                    ) : null}
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
