import { Link } from "react-router-dom";
import { inputClass } from "./Input";
import { useComboPanel, type ComboOption } from "./useComboPanel";

/** An option may carry a link at the end of its row — for a disabled one, where to go to make it pickable. */
export type MultiSelectOption = ComboOption & { action?: { label: string; to: string } };

interface Props {
  id: string;
  options: MultiSelectOption[];
  selected: string[];
  onToggle: (value: string) => void;
  placeholder?: string;
}

/**
 * A box you type in to search a list, with several options ticked at once. It stays open while ticking,
 * so a run of options takes one search. SearchSelect is the one-answer version.
 */
export function MultiSelect({ id, options, selected, onToggle, placeholder }: Props) {
  const c = useComboPanel(id, options, onToggle);

  return (
    <div className="relative">
      <input
        {...c.inputProps} placeholder={placeholder} value={c.query} className={`${inputClass} pr-9`}
        onChange={(e) => c.search(e.target.value)} onFocus={() => c.show()} onClick={() => c.show()}
      />
      <span aria-hidden="true" className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[18px] text-warmstone-400 pointer-events-none">expand_more</span>

      {c.open && c.pos && (
        <ul
          ref={c.panel} id={`${id}-list`} role="listbox" aria-multiselectable="true" style={c.pos}
          className="fixed z-40 max-h-64 overflow-y-auto rounded-xl border border-warmstone-200 bg-white shadow-lg py-1"
        >
          {c.shown.map((o, i) => {
            const on = selected.includes(o.value);
            return (
              <li
                key={o.value} {...c.optionProps(i, o.value)} aria-selected={on} aria-disabled={o.disabled || undefined}
                className={`flex items-center gap-2.5 px-3 py-2 text-[13px] ${o.disabled ? "cursor-default text-warmstone-500" : "cursor-pointer text-warmstone-800"} ${i === c.active ? "bg-warmstone-100" : ""}`}
              >
                <span aria-hidden="true" className={`material-symbols-outlined text-[18px] shrink-0 ${on ? "fill text-brand-700" : o.disabled ? "text-warmstone-300" : "text-warmstone-400"}`}>
                  {o.disabled ? "block" : on ? "check_box" : "check_box_outline_blank"}
                </span>
                <span className="font-medium shrink-0">{o.label}</span>
                {o.detail && <span className={`min-w-0 truncate ${o.detailTone === "emphasis" ? "font-medium text-danger-700" : "text-warmstone-500"}`}>{o.detail}</span>}
                {o.figure && (
                  <span className="ml-auto shrink-0 tabular-nums text-right">
                    <span className="font-semibold text-warmstone-900">{o.figure.value}</span>
                    {o.figure.note && <span className="ml-2 text-[12px] text-warmstone-500">{o.figure.note}</span>}
                  </span>
                )}
                {o.action && (
                  <Link to={o.action.to} className="ml-auto shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-800">
                    {o.action.label}
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">arrow_forward</span>
                  </Link>
                )}
              </li>
            );
          })}
          {c.shown.length === 0 && <li className="px-3 py-2 text-[13px] text-warmstone-500">No match</li>}
        </ul>
      )}
    </div>
  );
}
