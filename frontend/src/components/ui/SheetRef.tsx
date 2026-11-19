/**
 * "This replaces the client's Excel file X": the workbooks a screen stands in for, so people who know the sheets find
 * their way in the app. Plain muted text, not coloured chips: it is a pointer, not something to act on. No domain
 * knowledge: the caller passes the file names.
 */
export function SheetRef({ sheets, label = "Excel" }: { sheets: readonly string[]; label?: string }) {
  if (sheets.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-warmstone-500">
      <span className="text-[11px] font-bold uppercase tracking-wider">{label}</span>
      {sheets.map((s, i) => (
        <span key={s} className="inline-flex items-center gap-1">
          <span className="material-symbols-outlined text-[16px]">table_view</span>
          {s}
          {i < sheets.length - 1 && <span aria-hidden> · </span>}
        </span>
      ))}
    </p>
  );
}
