import { useMemo } from "react";
import { inputClass } from "./Input";
import { useComboPanel, type ComboOption } from "./useComboPanel";

export type SearchSelectOption = ComboOption;

interface Props {
  id: string;
  value: string;
  /** Plain strings, or {value, label, detail} when what is shown differs from what is saved. */
  options: readonly (string | SearchSelectOption)[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Offers a × to empty the field. Off for a field that must always hold a value. */
  clearable?: boolean;
  /** Told each time the list opens, e.g. to re-read a master so what someone just added is there. */
  onOpen?: () => void;
  /** Read by screen readers when there is no visible label tied to the id. */
  "aria-label"?: string;
  /** Put on the input, so a grid can find and focus the cell (Enter moves down a column). */
  dataAttrs?: Record<`data-${string}`, string | number>;
}

/** Rows drawn at once. Typing narrows the rest, so a long master stays quick to open. */
const DRAWN = 100;

/**
 * A dropdown you can type in to search: one answer, taken only from the list, never free text. A saved value the
 * list doesn't have (an older upload's) is shown and kept, never dropped: the caller says why beside the field.
 */
export function SearchSelect({ id, value, options, onChange, placeholder = "Choose…", disabled, clearable = true, onOpen, "aria-label": ariaLabel, dataAttrs }: Props) {
  const list = useMemo(() => {
    const all = options.map((o): SearchSelectOption => (typeof o === "string" ? { value: o, label: o } : o));
    return value && !all.some((o) => o.value === value) ? [{ value, label: value }, ...all] : all;
  }, [options, value]);
  const current = list.find((o) => o.value === value);

  const c = useComboPanel(id, list, (picked) => {
    c.setOpen(false);
    c.setQuery("");
    if (picked !== value) onChange(picked);
  });

  function openAtCurrent() {
    if (disabled) return;
    onOpen?.();
    c.setQuery("");
    c.show(Math.max(0, list.findIndex((o) => o.value === value)));
  }

  return (
    <div className="relative">
      <input
        {...c.inputProps} {...dataAttrs} aria-label={ariaLabel} disabled={disabled}
        // Closed, the box shows the answer. Open, it is the search, with the answer kept as its placeholder.
        value={c.open ? c.query : current?.label ?? ""}
        placeholder={c.open && current ? current.label : placeholder}
        className={`${inputClass} ${clearable && value ? "pr-16" : "pr-9"} ${disabled ? "cursor-default text-warmstone-600" : "cursor-pointer"}`}
        onChange={(e) => c.search(e.target.value)}
        onFocus={openAtCurrent} onClick={() => !c.open && openAtCurrent()}
        onBlur={() => { c.setOpen(false); c.setQuery(""); }}
      />
      {clearable && value && !disabled && (
        <button
          type="button" aria-label="Clear" tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { c.setOpen(false); c.setQuery(""); onChange(""); }}
          className="absolute right-8 top-1/2 -translate-y-1/2 p-0.5 rounded-lg text-warmstone-400 hover:bg-warmstone-100 hover:text-warmstone-700 transition-colors"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px] block">close</span>
        </button>
      )}
      <span aria-hidden="true" className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[18px] text-warmstone-400 pointer-events-none">expand_more</span>

      {c.open && c.pos && (
        <ul
          ref={c.panel} id={`${id}-list`} role="listbox" style={c.pos}
          className="fixed z-40 max-h-64 overflow-y-auto rounded-xl border border-warmstone-200 bg-white shadow-lg py-1"
        >
          {c.shown.slice(0, DRAWN).map((o, i) => {
            const on = o.value === value;
            return (
              <li
                key={o.value} {...c.optionProps(i, o.value)} aria-selected={on}
                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer text-[13px] text-warmstone-800 ${i === c.active ? "bg-warmstone-100" : ""}`}
              >
                <span className={`shrink-0 ${on ? "font-bold text-brand-700" : "font-medium"}`}>{o.label}</span>
                {o.detail && <span className={`min-w-0 truncate ${o.detailTone === "emphasis" ? "font-medium text-danger-700" : "text-warmstone-500"}`}>{o.detail}</span>}
                {o.figure && (
                  <span className="ml-auto shrink-0 tabular-nums text-right">
                    <span className="font-semibold text-warmstone-900">{o.figure.value}</span>
                    {o.figure.note && <span className="ml-2 text-[12px] text-warmstone-500">{o.figure.note}</span>}
                  </span>
                )}
                {on && <span aria-hidden="true" className={`material-symbols-outlined text-[16px] text-brand-700 ${o.figure ? "" : "ml-auto"}`}>check</span>}
              </li>
            );
          })}
          {c.shown.length > DRAWN && (
            <li className="px-3 py-2 text-[12px] text-warmstone-500">{c.shown.length - DRAWN} more: keep typing to narrow the list</li>
          )}
          {c.shown.length === 0 && <li className="px-3 py-2 text-[13px] text-warmstone-500">No match</li>}
        </ul>
      )}
    </div>
  );
}
