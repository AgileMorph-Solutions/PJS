/** A bar showing `value` of `max`. No domain knowledge: the caller says what it means and what tone it has. */
export function ProgressBar({ value, max, tone = "default", label }: { value: number; max: number; tone?: "default" | "over" | "gap"; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const fill = tone === "over" ? "bg-ambernut-500" : tone === "gap" ? "bg-danger-600" : "bg-success-600";
  return (
    <div
      role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}
      className="h-2 w-full min-w-[96px] rounded-full bg-warmstone-200 overflow-hidden"
    >
      <div className={`h-full rounded-full transition-all ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
