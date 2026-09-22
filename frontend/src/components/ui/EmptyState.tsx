export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-14 px-6 border border-dashed border-warmstone-300 rounded-2xl bg-warmstone-50/60">
      <span className="material-symbols-outlined text-[28px] text-warmstone-300 mb-2 block">inbox</span>
      <p className="text-sm font-semibold text-warmstone-600">{title}</p>
      {hint && <p className="text-[13px] text-warmstone-400 mt-1">{hint}</p>}
    </div>
  );
}
