import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Dices, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/store';
import { GENERATOR_DEFAULTS } from '../../lib/credential-rules';
import { faDigits } from '../../lib/format';
import type { GeneratedSecret, PasswordGeneratorOptions } from '../../lib/types';
import StrengthMeter from './StrengthMeter';

const LENGTH_PRESETS = [12, 16, 20, 24, 32];
const SEPARATORS = [
  { value: '-', label: 'خط تیره' },
  { value: '.', label: 'نقطه' },
  { value: '_', label: 'زیرخط' },
  { value: ' ', label: 'فاصله' },
];

function OptionChip({
  active,
  onClick,
  children,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      className={`chip justify-center transition ${
        active
          ? 'border-brand-200 bg-brand-50 text-accent'
          : 'border-ink-200 bg-surface text-ink-500 hover:border-brand-200 hover:text-ink-700'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      {children}
    </button>
  );
}

/**
 * تولیدکنندهٔ رمز سمت سرور با پیچیدگی قابل تنظیم.
 * تولید در سرور انجام می‌شود تا الگوریتم و مرزها یک منبع داشته باشند؛ این
 * مؤلفه فقط گزینه‌ها را می‌فرستد و نتیجه را نشان می‌دهد.
 */
export default function PasswordGenerator({ onUse }: { onUse?: (value: string) => void }) {
  const { push } = useToast();
  const [options, setOptions] = useState<PasswordGeneratorOptions>(GENERATOR_DEFAULTS);
  const [generated, setGenerated] = useState<GeneratedSecret | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ticket = useRef(0);

  const generate = useCallback(
    async (next: PasswordGeneratorOptions) => {
      const current = ++ticket.current;
      setLoading(true);
      setError(null);
      try {
        const result = await api.generateSecret(next);
        if (current !== ticket.current) return;
        setGenerated(result);
      } catch (e) {
        if (current !== ticket.current) return;
        setError(e instanceof Error ? e.message : 'تولید رمز ممکن نشد.');
      } finally {
        if (current === ticket.current) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void generate(options);
  }, [options, generate]);

  const update = (patch: Partial<PasswordGeneratorOptions>) => setOptions((prev) => ({ ...prev, ...patch }));

  const copy = async () => {
    if (!generated?.value) return;
    try {
      await navigator.clipboard.writeText(generated.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      push('کپی در مرورگر مجاز نیست؛ رمز را دستی انتخاب کنید.', 'warning');
    }
  };

  const isPhrase = options.mode === 'passphrase';

  return (
    <div className="rounded-card border border-brand-100 bg-brand-50/40 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-700">
          <Dices size={15} className="text-accent" />
          تولید رمز با پیچیدگی دلخواه
        </p>
        <div className="inline-flex rounded-soft bg-surface p-0.5 border border-ink-200">
          {(
            [
              { value: 'random', label: 'تصادفی' },
              { value: 'passphrase', label: 'عبارت عبور' },
            ] as const
          ).map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => update({ mode: mode.value })}
              className={`rounded-[10px] px-2.5 py-1 text-[11.5px] font-medium transition ${
                options.mode === mode.value ? 'bg-brand-500 text-white shadow-soft' : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2.5 flex items-stretch gap-2">
        <div
          className="min-w-0 flex-1 select-all rounded-soft border border-ink-200 bg-surface px-3 py-2 font-mono text-[13px] leading-6 text-ink-800"
          dir="ltr"
          aria-live="polite"
        >
          {loading && !generated ? (
            <span className="text-ink-400">در حال تولید…</span>
          ) : error ? (
            <span className="font-sans text-[12px] text-danger">{error}</span>
          ) : (
            <span className="break-all">{generated?.value}</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => void generate(options)}
            className="btn-ghost btn-xs h-8"
            title="تولید مجدد"
            aria-label="تولید مجدد"
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            className="btn-ghost btn-xs h-8"
            title="کپی"
            aria-label="کپی رمز تولیدشده"
            disabled={!generated?.value}
          >
            {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
          </button>
        </div>
      </div>

      {generated?.assessment ? (
        <div className="mt-2">
          <StrengthMeter
            score={generated.assessment.score}
            reasons={generated.assessment.reasons}
            entropyBits={generated.entropyBits}
            compact
          />
        </div>
      ) : null}

      {isPhrase ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="label">تعداد کلمه ({faDigits(options.words)})</span>
            <input
              type="range"
              min={3}
              max={12}
              step={1}
              value={options.words}
              onChange={(e) => update({ words: Number(e.target.value) })}
              className="w-full accent-[rgb(var(--nw-brand-500))]"
            />
          </label>
          <label className="block">
            <span className="label">جداکننده</span>
            <select className="input" value={options.separator} onChange={(e) => update({ separator: e.target.value })}>
              {SEPARATORS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-1.5 sm:col-span-2">
            <OptionChip active={options.addNumber} onClick={() => update({ addNumber: !options.addNumber })}>
              افزودن عدد
            </OptionChip>
            <OptionChip active={options.capitalize} onClick={() => update({ capitalize: !options.capitalize })}>
              حرف اول بزرگ
            </OptionChip>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-3">
            <label className="block flex-1">
              <span className="label">طول رمز ({faDigits(options.length)})</span>
              <input
                type="range"
                min={8}
                max={64}
                step={1}
                value={options.length}
                onChange={(e) => update({ length: Number(e.target.value) })}
                className="w-full accent-[rgb(var(--nw-brand-500))]"
              />
            </label>
            <div className="flex flex-wrap gap-1 pt-4">
              {LENGTH_PRESETS.map((preset) => (
                <OptionChip key={preset} active={options.length === preset} onClick={() => update({ length: preset })}>
                  <span className="num">{faDigits(preset)}</span>
                </OptionChip>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <OptionChip active={options.lower} onClick={() => update({ lower: !options.lower })}>
              a‑z
            </OptionChip>
            <OptionChip active={options.upper} onClick={() => update({ upper: !options.upper })}>
              A‑Z
            </OptionChip>
            <OptionChip active={options.digits} onClick={() => update({ digits: !options.digits })}>
              0‑9
            </OptionChip>
            <OptionChip active={options.symbols} onClick={() => update({ symbols: !options.symbols })}>
              !@#$%^
            </OptionChip>
            <OptionChip active={options.avoidAmbiguous} onClick={() => update({ avoidAmbiguous: !options.avoidAmbiguous })}>
              حذف نویسه‌های مبهم
            </OptionChip>
          </div>
        </div>
      )}

      {onUse ? (
        <button
          type="button"
          onClick={() => generated?.value && onUse(generated.value)}
          className="btn-primary btn-xs mt-3 w-full justify-center"
          disabled={!generated?.value}
        >
          استفاده از این رمز
        </button>
      ) : null}
    </div>
  );
}
