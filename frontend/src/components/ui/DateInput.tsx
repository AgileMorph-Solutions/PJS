import { useEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { DATE_FORMAT_LABEL, formatDate, isIsoDate, parseDateInput } from "@anagroci/contract/domain/dateFormat";

type Passthrough = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max" | "size">;

interface Props extends Passthrough {
  /** ISO (YYYY-MM-DD), or "". Anything else (a workbook's free-text date) is shown as it is until the person types a real date. */
  value: string;
  /** Always called with ISO or "": what is shown (DD/MM/YYYY) never leaks into stored data. */
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
}

/**
 * THE date field of the app: every place a person enters or filters by a date uses this, so they all look and read the
 * same (DD/MM/YYYY, domain/dateFormat.ts) and all open the same calendar. Typing works for fast entry (the batch grid),
 * the calendar button for everyone else; both end in an ISO value.
 *
 * The calendar is the browser's own date picker, opened from a hidden native input, because a native date input on its
 * own would show the visitor's locale format and not ours. A typed value that is not a real day, or falls outside
 * min/max, is flagged and not passed on.
 */
export function DateInput({ value, onChange, min, max, className = "", onBlur, onKeyDown, ...rest }: Props) {
  const [text, setText] = useState(() => formatDate(value));
  const [invalid, setInvalid] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  // The value changed from outside (a Clear button, a pre-filled form): show it, unless it is what was just typed.
  useEffect(() => {
    setText((t) => (parseDateInput(t) === value ? t : formatDate(value)));
    setInvalid(false);
  }, [value]);

  const outOfRange = (iso: string) => Boolean(iso) && ((min && iso < min) || (max && iso > max));

  function commit(raw: string) {
    const iso = parseDateInput(raw);
    if (iso === null || outOfRange(iso)) { setInvalid(true); return; }
    setInvalid(false);
    setText(formatDate(iso));
    if (iso !== value) onChange(iso);
  }

  function openCalendar() {
    const el = picker.current;
    if (!el || rest.disabled || rest.readOnly) return;
    el.value = isIsoDate(value) ? value : "";
    try { el.showPicker(); } catch { el.click(); }
  }

  const wide = className.includes("w-full");
  return (
    <span className={`relative ${wide ? "block w-full" : "inline-block"}`}>
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        size={11}
        value={text}
        placeholder={rest.placeholder ?? DATE_FORMAT_LABEL}
        aria-invalid={invalid || undefined}
        title={invalid ? `Enter a real date as ${DATE_FORMAT_LABEL}${min || max ? " within the allowed range" : ""}` : rest.title}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          setInvalid(false);
          // A complete date is passed on at once; anything shorter waits for blur so a half-typed day is not saved.
          if (!t.trim()) onChange("");
          else if (/\d{4}$/.test(t.trim())) { const iso = parseDateInput(t); if (iso && !outOfRange(iso) && iso !== value) onChange(iso); }
        }}
        onBlur={(e) => { commit(e.target.value); onBlur?.(e); }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") commit(e.currentTarget.value); onKeyDown?.(e); }}
        className={`${className} ${invalid ? "!border-danger-700 !ring-1 !ring-danger-700" : ""}`}
        style={{ paddingRight: 34, ...rest.style }}
      />
      {!rest.readOnly && !rest.disabled && (
        <button
          type="button" tabIndex={-1} onClick={openCalendar} aria-label="Open calendar"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-6 h-6 rounded-md text-warmstone-400 hover:text-brand-700 hover:bg-warmstone-100"
        >
          <span className="material-symbols-outlined text-[17px]">calendar_month</span>
        </button>
      )}
      {/* Inline style, not classes: a FilterBar styles every descendant input and would otherwise make this one visible. */}
      <input
        ref={picker} type="date" tabIndex={-1} aria-hidden="true" min={min} max={max}
        style={{ position: "absolute", left: 0, bottom: 0, width: "100%", height: 0, padding: 0, border: 0, opacity: 0, pointerEvents: "none" }}
        onChange={(e) => { if (e.target.value) { setInvalid(false); setText(formatDate(e.target.value)); onChange(e.target.value); } }}
      />
    </span>
  );
}
