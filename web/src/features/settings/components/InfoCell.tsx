export function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft border border-ink-200 bg-surface/70 px-2.5 py-2">
      <p className="text-[10.5px] text-ink-400">{label}</p>
      <p className="num mt-0.5 text-[12px] font-semibold text-ink-700">{value}</p>
    </div>
  );
}

/* ------------------------------- Groups ------------------------------- */
