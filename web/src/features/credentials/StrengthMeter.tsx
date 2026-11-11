
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { STRENGTH_META, strengthMeta } from '../../lib/credential-rules';
import { faDigits } from '../../lib/format';

/**
 * نوار پنج‌بخشی قدرت رمز + دلایل هشدار.
 * برچسب «برآورد» در فرم به کاربر یادآوری می‌کند امتیاز ذخیره‌شده را سرور
 * محاسبه می‌کند؛ در جدول همین مؤلفه امتیاز قطعی سرور را نشان می‌دهد.
 */
export default function StrengthMeter({
  score,
  reasons = [],
  entropyBits,
  estimated = false,
  compact = false,
}: {
  score: number;
  reasons?: string[];
  entropyBits?: number;
  estimated?: boolean;
  compact?: boolean;
}) {
  const meta = strengthMeta(score);
  const level = Math.max(0, Math.min(5, Number(score) + 1));
  const strong = score >= 3;

  return (
    <div className={compact ? '' : 'rounded-soft border border-ink-100 bg-ink-50/50 p-3'}>
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${meta.text}`}>
          {strong ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}
          {meta.label}
        </span>
        <span className="flex items-center gap-2 text-[11px] text-ink-400">
          {entropyBits ? <span className="num">{faDigits(Math.round(entropyBits))} بیت</span> : null}
          {estimated ? <span>· برآورد</span> : null}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-1" role="img" aria-label={`قدرت رمز: ${meta.label}`}>
        {STRENGTH_META.map((item, index) => (
          <span
            key={item.label}
            className="h-1.5 flex-1 rounded-pill transition-colors duration-300"
            style={{
              background: index < level ? STRENGTH_META[score]?.bar ?? meta.bar : 'rgb(var(--nw-ink-200, 226 232 240))',
              opacity: index < level ? 1 : 0.55,
            }}
          />
        ))}
      </div>

      {reasons.length ? (
        <ul className="mt-2 space-y-1">
          {reasons.slice(0, compact ? 2 : 3).map((reason) => (
            <li key={reason} className="flex items-start gap-1.5 text-[11px] leading-4 text-ink-500">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warning" />
              {reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
