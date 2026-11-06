import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { inputClass } from "./Input";

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Muted text after the label. Also searched. */
  detail?: string;
}

interface Props {
  id: string;
  options: MultiSelectOption[];
  selected: string[];
  onToggle: (value: string) => void;
  placeholder?: string;
}

type Position = { left: number; width: number; top?: number; bottom?: number };

const PANEL_ROOM = 270; // max-h-64 plus the gap: below this much space under the box, the panel opens upward if there's more room there.

/**
 * A box you type in to search a list, with several options ticked at once. It stays open while ticking,
 * so a run of options takes one search. The panel is positioned from the box (fixed), like
 * ColumnFilterMenu's, because a card's overflow-hidden would clip anything hanging below it.
 */
export function MultiSelect({ id, options, selected, onToggle, placeholder }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLUListElement>(null);

  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((o) => `${o.label} ${o.detail ?? ""}`.toLowerCase().includes(needle)) : options;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !input.current?.contains(target)) setOpen(false);
    };
    // The panel is placed once, so it closes when the page moves under it. Scrolling its own list doesn't count.
    const scrolled = (e: Event) => { if (!panel.current?.contains(e.target as Node)) setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", away);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  function show() {
    if (open || !input.current || options.length === 0) return;
    const r = input.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const upward = below < PANEL_ROOM && r.top > below;
    setPos({ left: r.left, width: r.width, ...(upward ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
    setActive(0);
    setOpen(true);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return show();
      setActive((a) => (e.key === "ArrowDown" ? Math.min(a + 1, shown.length - 1) : Math.max(a - 1, 0)));
    } else if (e.key === "Enter") {
      e.preventDefault(); // Enter ticks an option here; it must never submit the form around this box.
      if (open && shown[active]) onToggle(shown[active].value);
    } else if (e.key === "Escape" && open) {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        ref={input} id={id} role="combobox" autoComplete="off" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${id}-option-${active}` : undefined}
        placeholder={placeholder} value={query} className={`${inputClass} pr-9`}
        onChange={(e) => { setQuery(e.target.value); setActive(0); show(); }}
        onFocus={show} onClick={show} onKeyDown={onKeyDown}
      />
      <span aria-hidden="true" className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[18px] text-warmstone-400 pointer-events-none">expand_more</span>

      {open && pos && (
        <ul
          ref={panel} id={`${id}-list`} role="listbox" aria-multiselectable="true" style={pos}
          className="fixed z-40 max-h-64 overflow-y-auto rounded-xl border border-warmstone-200 bg-white shadow-lg py-1"
        >
          {shown.map((o, i) => {
            const on = selected.includes(o.value);
            return (
              <li
                key={o.value} id={`${id}-option-${i}`} role="option" aria-selected={on}
                // Keeps focus in the box, so typing carries on after a tick.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onToggle(o.value)}
                onMouseEnter={() => setActive(i)}
                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer text-[13px] text-warmstone-800 ${i === active ? "bg-warmstone-100" : ""}`}
              >
                <span aria-hidden="true" className={`material-symbols-outlined text-[18px] shrink-0 ${on ? "fill text-brand-700" : "text-warmstone-400"}`}>
                  {on ? "check_box" : "check_box_outline_blank"}
                </span>
                <span className="font-medium shrink-0">{o.label}</span>
                {o.detail && <span className="min-w-0 truncate text-warmstone-500">{o.detail}</span>}
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-3 py-2 text-[13px] text-warmstone-500">No match</li>}
        </ul>
      )}
    </div>
  );
}
