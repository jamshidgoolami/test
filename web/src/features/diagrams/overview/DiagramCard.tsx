import { useContext } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { fmtRelative, faDigits } from '../../../lib/format';
import { HANDLE_SIDES } from '../../../lib/diagrams';
import type { HandleSide } from '../../../lib/diagrams';
import { OverviewUi, type OverviewNode } from './model';

export const POSITION: Record<HandleSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

export const SIDE_LABEL: Record<HandleSide, string> = {
  top: 'بالا',
  right: 'راست',
  bottom: 'پایین',
  left: 'چپ',
};

export function DiagramCard({ id, data, selected }: NodeProps<OverviewNode>) {
  const { open } = useContext(OverviewUi);
  const connections = data.inLinks + data.outLinks + data.childCount;
  // بیضی کامل: خطوط می‌توانند از هر نقطهٔ محیط و با هر زاویه‌ای وارد شوند.
  const ring = data.connectSource
    ? 'ring-2 ring-brand-200'
    : selected
      ? 'ring-2 ring-sky-300 ring-offset-2 ring-offset-surface'
      : data.matched
        ? 'ring-2 ring-amber-300'
        : data.highlighted
          ? 'ring-2 ring-sky-200'
          : '';

  return (
    <div className={`group relative h-full w-full ${data.dimmed ? 'opacity-20' : ''}`} dir="rtl">
      <div
        className={`relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-[50%] border-2 bg-gradient-to-br from-surface via-surface to-ink-50 px-7 py-3 text-center shadow-soft transition-shadow hover:shadow-pop ${ring} ${
          data.connectSource
            ? '!border-dashed !border-brand-500'
            : selected
              ? '!border-sky-400'
              : data.current
                ? 'border-brand-300'
                : 'border-ink-200/80'
        }`}
        onDoubleClick={() => open(Number(id))}
        title={
          data.description
            ? `${data.name}\n${data.description}\nآخرین ویرایش: ${fmtRelative(data.updatedAt)}`
            : `${data.name} — ${faDigits(data.nodeCount)} جزء، ${faDigits(data.edgeCount)} ارتباط\nآخرین ویرایش: ${fmtRelative(data.updatedAt)}`
        }
      >
        <span className="flex max-w-full items-center justify-center gap-1">
          {data.current ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" title="دیاگرام جاری" aria-hidden />
          ) : null}
          <span
            className={`max-w-[150px] min-w-0 text-[12.5px] font-semibold leading-4 text-ink-800 ${
              data.compact ? 'truncate' : 'line-clamp-2'
            }`}
          >
            {data.name}
          </span>
        </span>

        {data.compact ? (
          <span className="num mt-0.5 rounded-pill bg-ink-100/80 px-1.5 py-0.5 text-[9px] text-ink-500">
            {faDigits(connections)} ارتباط
          </span>
        ) : (
          <span className="num mt-1 flex items-center gap-1 text-[9.5px] text-ink-400">
            <span>{faDigits(data.nodeCount)} جزء</span>
            <span aria-hidden>·</span>
            <span>{faDigits(connections)} ارتباط</span>
            {data.brokenLinks ? (
              <AlertTriangle
                size={10}
                className="text-warning"
                aria-label={`${faDigits(data.brokenLinks)} پیوند شکسته`}
              />
            ) : null}
          </span>
        )}

        {!data.compact ? (
          <button
            type="button"
            data-card-action
            className="nodrag nopan pointer-events-none mt-1.5 inline-flex items-center gap-1 rounded-pill border border-sky-200/80 bg-surface/90 px-2 py-0.5 text-[9px] font-medium text-info opacity-0 shadow-soft transition group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              open(Number(id));
            }}
            title={`ورود به دیاگرام «${data.name}»`}
          >
            <ExternalLink size={9} />
            ورود
          </button>
        ) : null}
      </div>

      {HANDLE_SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={POSITION[side]}
          isConnectable={data.connectable}
          title={`اتصال از سمت ${SIDE_LABEL[side]} به دیاگرام دیگر`}
          aria-label={`اتصال از سمت ${SIDE_LABEL[side]} به دیاگرام دیگر`}
          className={`diagram-handle ${data.connectable ? 'is-active' : ''}`}
          style={{
            width: 16,
            height: 16,
            background: 'rgb(var(--nw-surface))',
            borderColor: '#0ea5e9',
            pointerEvents: data.connectable ? 'all' : 'none',
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* یال بوم (ساختار درختی و پیوند دستی)                                 */
