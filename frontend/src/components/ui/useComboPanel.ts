import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

export interface ComboOption {
  value: string;
  label: string;
  /** Muted text after the label. Also searched. */
  detail?: string;
  /** "emphasis": the detail is the figure to read (a Bin's stock, what is left of a lot), shown in red so it stands out. */
  detailTone?: "emphasis";
  /** A number to read and compare down the list (a Bin's stock), right-aligned in its own column: `value` in bold, `note`
   * muted after it. Not searched. */
  figure?: { value: string; note?: string };
  /** Shown but can't be picked (MultiSelect greys it and says why through its detail). */
  disabled?: boolean;
}

type Position = { left: number; width: number; top?: number; bottom?: number };

const PANEL_ROOM = 270; // max-h-64 plus the gap: below this much space under the box, the panel opens upward if there's more room there.

/**
 * What MultiSelect and SearchSelect share: the typed search, the panel's place on screen and the keyboard.
 * The panel is positioned from the box (fixed), like ColumnFilterMenu's, because a card's overflow-hidden would
 * clip anything hanging below it. Each option's search text is lower-cased once per list, not on every key.
 */
export function useComboPanel<T extends ComboOption>(id: string, options: T[], onPick: (value: string) => void) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLUListElement>(null);

  const haystack = useMemo(() => options.map((o) => `${o.label} ${o.detail ?? ""}`.toLowerCase()), [options]);
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => (needle ? options.filter((_, i) => haystack[i]!.includes(needle)) : options), [options, haystack, needle]);

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

  function show(startAt = 0) {
    if (open || !input.current || options.length === 0) return;
    const r = input.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const upward = below < PANEL_ROOM && r.top > below;
    setPos({ left: r.left, width: r.width, ...(upward ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
    setActive(startAt);
    setOpen(true);
  }

  function search(text: string) {
    setQuery(text);
    setActive(0);
    show();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return show();
      setActive((a) => (e.key === "ArrowDown" ? Math.min(a + 1, shown.length - 1) : Math.max(a - 1, 0)));
    } else if (e.key === "Enter") {
      e.preventDefault(); // Enter picks an option here; it must never submit the form around this box.
      if (open && shown[active] && !shown[active].disabled) onPick(shown[active].value);
    } else if (e.key === "Escape" && open) {
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  /** Props for the box itself. */
  const inputProps = {
    ref: input, id, role: "combobox" as const, autoComplete: "off", "aria-expanded": open, "aria-controls": `${id}-list`,
    "aria-autocomplete": "list" as const, "aria-activedescendant": open && shown[active] ? `${id}-option-${active}` : undefined, onKeyDown,
  };
  /** Props for one row of the panel. */
  const optionProps = (i: number, value: string) => ({
    id: `${id}-option-${i}`, role: "option" as const,
    // Keeps focus in the box, so typing carries on after a pick.
    onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
    onClick: () => { if (!options.find((o) => o.value === value)?.disabled) onPick(value); },
    onMouseEnter: () => setActive(i),
  });

  return { query, setQuery, open, setOpen, pos, active, shown, panel, input, show, search, inputProps, optionProps };
}
