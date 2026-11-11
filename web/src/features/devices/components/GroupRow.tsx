import { faDigits } from '../../../lib/format';

export function GroupRow({
  name,
  color,
  total,
  online,
  offline,
  active,
  onClick,
}: {
  name: string;
  color: string;
  total: number;
  online: number;
  offline: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-soft border px-2.5 py-2 text-right transition ${
        active ? 'border-brand-300 bg-brand-50/70' : 'border-ink-100 bg-surface/70 hover:border-brand-200'
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-700">{name}</span>
      </span>
      <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10.5px]">
        <span className="text-ink-400">
          کل: <span className="num font-medium text-ink-600">{faDigits(total)}</span>
        </span>
        <span className="text-success">
          وصل: <span className="num font-medium">{faDigits(online)}</span>
        </span>
        <span className="text-danger">
          قطع: <span className="num font-medium">{faDigits(offline)}</span>
        </span>
        <span className="text-ink-400">
          غیرفعال:{' '}
          <span className="num font-medium text-ink-500">{faDigits(Math.max(0, total - online - offline))}</span>
        </span>
      </span>
    </button>
  );
}
