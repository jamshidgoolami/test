import { ExternalLink, Link2, Pencil, Trash2, X } from 'lucide-react';

import { faDigits } from '../../../lib/format';
import { CONNECTION_TYPES, connectionType } from '../../../lib/diagrams';
import type { DiagramConnectionKind, DiagramGraphItem, DiagramGraphLink } from '../../../lib/types';

type LinkInspectorProps = {
  link: DiagramGraphLink;
  canEdit: boolean;
  busy: boolean;
  labelDraft: string;
  nameOf: (id: number) => string;
  onLabelDraft: (value: string) => void;
  onClose: () => void;
  onUpdateMeta: (patch: { label?: string; fromSide?: null; toSide?: null }) => void;
  onChangeKind: (kind: DiagramConnectionKind) => void;
  onRemove: (from: number, nodeId: string, title: string) => void;
  onOpen: (id: number, nodeId?: string) => void;
};

export function OverviewLinkInspector({
  link,
  canEdit,
  busy,
  labelDraft,
  nameOf,
  onLabelDraft,
  onClose,
  onUpdateMeta,
  onChangeKind,
  onRemove,
  onOpen,
}: LinkInspectorProps) {
  const meta = connectionType(link.kind);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12.5px] font-semibold text-ink-800">جزئیات ارتباط</h3>
        <button
          type="button"
          className="btn-ghost btn-xs !px-1.5"
          onClick={onClose}
          aria-label="بستن جزئیات ارتباط"
        >
          <X size={13} />
        </button>
      </div>

      <div className="rounded-soft border border-ink-100 bg-ink-50/50 p-2.5">
        <p className="flex flex-wrap items-center gap-1 text-[12px] leading-5 text-ink-700">
          <strong className="font-semibold">{nameOf(link.from)}</strong>
          <span className="text-ink-400">↔</span>
          <strong className="font-semibold">{nameOf(link.to)}</strong>
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span
            className="rounded-pill px-1.5 py-0.5 text-[10px] font-medium"
            style={{ color: meta.color, background: `${meta.color}14` }}
          >
            {meta.label}
          </span>
          {link.nodeLabel ? <span className="text-[10px] text-ink-400">{link.nodeLabel}</span> : null}
        </div>
      </div>

      {canEdit ? (
        <>
          <label className="block">
            <span className="label mb-1">برچسب ارتباط</span>
            <input
              className="field"
              value={labelDraft}
              maxLength={120}
              onChange={(event) => onLabelDraft(event.target.value)}
              placeholder="مثلاً اتصال به مرکز مخابرات"
            />
          </label>
          <button
            type="button"
            className="btn-primary btn-xs w-full justify-center"
            disabled={busy || labelDraft.trim() === (link.label ?? '')}
            onClick={() => onUpdateMeta({ label: labelDraft.trim() })}
          >
            <Pencil size={12} />
            ذخیرهٔ برچسب
          </button>

          <label className="block">
            <span className="label mb-1">نوع ارتباط</span>
            <select
              className="field !py-1.5 text-[11.5px]"
              value={link.kind}
              disabled={busy}
              onChange={(event) => onChangeKind(event.target.value as DiagramConnectionKind)}
            >
              {CONNECTION_TYPES.map((type) => (
                <option key={type.kind} value={type.kind}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <p className="text-[10.5px] text-ink-400">برای ویرایش پیوند، حالت ویرایش را فعال کنید.</p>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-2">
        <button
          type="button"
          className="btn-soft btn-xs flex-1 justify-center"
          onClick={() => onOpen(link.from, link.nodeId)}
        >
          <ExternalLink size={12} />
          باز کردن مبدأ
        </button>
        {canEdit ? (
          <button
            type="button"
            className="btn-ghost btn-xs text-danger hover:!border-red-200 hover:!text-danger"
            disabled={busy}
            onClick={() => onRemove(link.from, link.nodeId, link.nodeLabel || link.label || 'پیوند')}
          >
            <Trash2 size={12} />
            حذف
          </button>
        ) : null}
      </div>
      <p className="text-[10px] leading-4 text-ink-400">
        این ارتباط دوطرفه نمایش داده می‌شود؛ حذف آن جزء متناظر در دیاگرام مقصد را هم برمی‌دارد.
      </p>
    </div>
  );
}

type CardInspectorProps = {
  card: DiagramGraphItem;
  outgoing: DiagramGraphLink[];
  incoming: DiagramGraphLink[];
  children: DiagramGraphItem[];
  canEdit: boolean;
  nameOf: (id: number) => string;
  onClose: () => void;
  onOpen: (id: number) => void;
  onConnect: (id: number) => void;
  onSelectLink: (key: string) => void;
  onSelectItem: (id: number) => void;
};

export function OverviewCardInspector({
  card,
  outgoing,
  incoming,
  children,
  canEdit,
  nameOf,
  onClose,
  onOpen,
  onConnect,
  onSelectLink,
  onSelectItem,
}: CardInspectorProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12.5px] font-semibold text-ink-800">جزئیات دیاگرام</h3>
        <button
          type="button"
          className="btn-ghost btn-xs !px-1.5"
          onClick={onClose}
          aria-label="بستن جزئیات دیاگرام"
        >
          <X size={13} />
        </button>
      </div>

      <div className="rounded-soft border border-ink-100 bg-ink-50/50 p-2.5">
        <p className="truncate text-[13px] font-semibold text-ink-800">{card.name}</p>
        <p className="num mt-1 text-[10.5px] text-ink-400">
          {faDigits(card.nodeCount)} جزء · {faDigits(card.edgeCount)} ارتباط · {faDigits(card.childCount)}{' '}
          زیرمجموعه
        </p>
        {card.description ? (
          <p className="mt-1 text-[10.5px] leading-5 text-ink-500">{card.description}</p>
        ) : null}
      </div>

      <div className="flex gap-1.5">
        <button type="button" className="btn-soft btn-xs flex-1 justify-center" onClick={() => onOpen(card.id)}>
          <ExternalLink size={12} />
          باز کردن
        </button>
        {canEdit ? (
          <button
            type="button"
            className="btn-ghost btn-xs"
            onClick={() => onConnect(card.id)}
            title="اتصال از این دیاگرام به دیاگرام دیگر"
          >
            <Link2 size={12} />
            اتصال
          </button>
        ) : null}
      </div>

      <div>
        <p className="label mb-1">ارتباط‌های خروجی ({faDigits(outgoing.length)})</p>
        {outgoing.length ? (
          <div className="space-y-1">
            {outgoing.map((link) => (
              <button
                key={`${link.from}:${link.nodeId}`}
                type="button"
                className="flex w-full items-center gap-1.5 rounded-lg border border-ink-100 px-2 py-1.5 text-right text-[10.5px] text-ink-600 transition hover:border-brand-200 hover:bg-brand-50/30"
                onClick={() => onSelectLink(`${link.from}:${link.nodeId}`)}
              >
                <span
                  className="h-0.5 w-4 shrink-0 rounded"
                  style={{ background: connectionType(link.kind).color }}
                  aria-hidden
                />
                <span className="truncate">{nameOf(link.to)}</span>
                <span className="ms-auto shrink-0 text-[9px] text-ink-400">
                  {connectionType(link.kind).label}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-ink-400">—</p>
        )}
      </div>

      <div>
        <p className="label mb-1">ارتباط‌های ورودی ({faDigits(incoming.length)})</p>
        {incoming.length ? (
          <div className="space-y-1">
            {incoming.map((link) => (
              <button
                key={`${link.from}:${link.nodeId}`}
                type="button"
                className="flex w-full items-center gap-1.5 rounded-lg border border-ink-100 px-2 py-1.5 text-right text-[10.5px] text-ink-600 transition hover:border-brand-200 hover:bg-brand-50/30"
                onClick={() => onSelectLink(`${link.from}:${link.nodeId}`)}
              >
                <span
                  className="h-0.5 w-4 shrink-0 rounded"
                  style={{ background: connectionType(link.kind).color }}
                  aria-hidden
                />
                <span className="truncate">{nameOf(link.from)}</span>
                <span className="ms-auto shrink-0 text-[9px] text-ink-400">
                  {connectionType(link.kind).label}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-ink-400">—</p>
        )}
      </div>

      {children.length ? (
        <div>
          <p className="label mb-1">زیرمجموعه‌ها ({faDigits(children.length)})</p>
          <div className="flex flex-wrap gap-1">
            {children.map((child) => (
              <button
                key={child.id}
                type="button"
                className="rounded-pill border border-ink-200 px-2 py-0.5 text-[10px] text-ink-600 transition hover:border-brand-300 hover:text-accent"
                onClick={() => onSelectItem(child.id)}
              >
                {child.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
