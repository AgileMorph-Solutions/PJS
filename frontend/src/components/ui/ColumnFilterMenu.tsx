import { useEffect, useRef, useState } from "react";
import { isActive, type ActiveFilter, type FilterKind } from "./columnFilters";
import { DateInput } from "./DateInput";

interface Props {
  label: string;
  kind: FilterKind;
  /** The values a checklist offers (ignored for the other kinds). */
  options: string[];
  value: ActiveFilter | undefined;
  onChange: (next: ActiveFilter) => void;
}

const field =
  "w-full px-2.5 py-1.5 rounded-lg border border-warmstone-200 bg-warmstone-50 text-[12.5px] font-normal normal-case tracking-normal text-warmstone-900 outline-none focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

/**
 * The funnel in a column header, and the small panel it opens: a checklist, a text box, a number range or a
 * date range, depending on the column. The panel is positioned from the button (fixed), because the table's
 * own scroll container would clip anything that hangs below a short table.
 */
export function ColumnFilterMenu({ label, kind, options, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [optionSearch, setOptionSearch] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const active = isActive(value);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    // The panel is placed once, so it follows nothing: close it when the page moves under it.
    const close = () => setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggle() {
    if (!open && button.current) {
      const r = button.current.getBoundingClientRect();
      // Keep the 240px panel on screen when the column is near the right edge.
      setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 248)) });
      setOptionSearch("");
    }
    setOpen((o) => !o);
  }

  const set = (patch: ActiveFilter) => onChange({ ...value, ...patch });
  const selected = value?.selected ?? [];
  const shown = options.filter((o) => o.toLowerCase().includes(optionSearch.trim().toLowerCase()));

  return (
    <>
      <button
        ref={button} type="button" onClick={toggle} aria-label={`Filter ${label}`} aria-expanded={open} aria-haspopup="dialog"
        className={`relative inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors ${
          active ? "bg-brand-100 text-brand-700" : "text-warmstone-400 hover:text-warmstone-700 hover:bg-warmstone-100"
        }`}
      >
        <span className="material-symbols-outlined text-[16px]">filter_alt</span>
        {active && <span aria-hidden className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-brand-700" />}
      </button>

      {open && pos && (
        <div
          ref={panel} role="dialog" aria-label={`Filter ${label}`} style={{ top: pos.top, left: pos.left }}
          className="fixed z-40 w-60 rounded-xl border border-warmstone-200 bg-white shadow-lg p-3 space-y-2.5 text-left"
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold text-warmstone-800 normal-case tracking-normal">{label}</span>
            {active && <button type="button" onClick={() => onChange({})} className="text-[11.5px] font-semibold text-brand-700 hover:text-brand-800 normal-case tracking-normal">Clear</button>}
          </div>

          {kind === "number" && (
            <div className="flex items-center gap-2">
              <input autoFocus aria-label={`${label} minimum`} inputMode="decimal" placeholder="Min" value={value?.min ?? ""} onChange={(e) => set({ min: e.target.value })} className={field} />
              <span className="text-warmstone-400">–</span>
              <input aria-label={`${label} maximum`} inputMode="decimal" placeholder="Max" value={value?.max ?? ""} onChange={(e) => set({ max: e.target.value })} className={field} />
            </div>
          )}

          {kind === "date" && (
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold text-warmstone-500 normal-case tracking-normal">From
                <DateInput autoFocus aria-label={`${label} from`} value={value?.from ?? ""} max={value?.to || undefined} onChange={(from) => set({ from })} className={`${field} mt-0.5 w-full`} />
              </label>
              <label className="block text-[11px] font-semibold text-warmstone-500 normal-case tracking-normal">To
                <DateInput aria-label={`${label} to`} value={value?.to ?? ""} min={value?.from || undefined} onChange={(to) => set({ to })} className={`${field} mt-0.5 w-full`} />
              </label>
            </div>
          )}

          {kind === "select" && (
            <>
              {options.length > 8 && <input autoFocus aria-label={`Search ${label} values`} placeholder="Search values…" value={optionSearch} onChange={(e) => setOptionSearch(e.target.value)} className={field} />}
              <ul className="max-h-56 overflow-y-auto -mx-1 px-1 space-y-0.5">
                {shown.map((o) => (
                  <li key={o}>
                    <label className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-warmstone-50 cursor-pointer text-[12.5px] font-normal normal-case tracking-normal text-warmstone-800">
                      <input
                        type="checkbox" checked={selected.includes(o)}
                        onChange={(e) => set({ selected: e.target.checked ? [...selected, o] : selected.filter((s) => s !== o) })}
                      />
                      <span className={o === "(blank)" ? "text-warmstone-400" : ""}>{o}</span>
                    </label>
                  </li>
                ))}
                {shown.length === 0 && <li className="px-1.5 py-1 text-[12px] text-warmstone-400 normal-case tracking-normal">No match</li>}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}
