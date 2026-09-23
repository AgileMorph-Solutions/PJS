export function StatBlock({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "success" | "danger";
}) {
  const toneCls =
    tone === "success"
      ? "bg-success-50 border-success-200 [&_.stat-label]:text-success-700 [&_.stat-value]:text-success-900 [&_.stat-sub]:text-success-700 [&_.stat-icon]:text-success-700"
      : tone === "danger"
        ? "bg-danger-50 border-danger-200 [&_.stat-label]:text-danger-700 [&_.stat-value]:text-danger-900 [&_.stat-sub]:text-danger-700 [&_.stat-icon]:text-danger-700"
        : "bg-warmstone-50 border-warmstone-200 hover:bg-warmstone-100";
  return (
    <div className={`rounded-xl p-4 border transition-all ${toneCls}`}>
      <div className="flex items-center justify-between text-xs font-bold text-warmstone-500 stat-label uppercase mb-1">
        <span>{label}</span>
        <span className="material-symbols-outlined text-[19px] text-brand-700 stat-icon">{icon}</span>
      </div>
      <div className="text-xl font-bold text-warmstone-900 tracking-tight tabular-nums stat-value">{value}</div>
      {sub && <div className="text-xs text-warmstone-500 mt-0.5 font-medium stat-sub">{sub}</div>}
    </div>
  );
}
