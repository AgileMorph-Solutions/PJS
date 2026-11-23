import type { StageField } from "../types/stage";
import { formatDate, formatDateTime } from "@anagroci/contract/domain/dateFormat";
import { DateTimeInput, nowStamp } from "./ui/DateTimeInput";
import { DateInput } from "./ui/DateInput";
import { SearchSelect } from "./ui/SearchSelect";

interface Props {
  field: StageField;
  value: string;
  onChange: (value: string) => void;
  /** Flush buffered edits immediately — writes are coalesced, so blur is the natural commit point. */
  onBlur?: () => void;
  /** Makes the generated input id unique across stages that render on the same page. */
  idPrefix?: string;
  /** Shown but not editable — for roles that submit a form for approval instead of editing directly. */
  readOnly?: boolean;
  /** The system, not a person, produces this value. Always read-only, with the reason shown under it
   * ("Good + damp + torn bags", "Issued by the system when the truck passes quality"). */
  system?: { kind: "calculated" | "issued"; hint: string };
  /** A quiet line under an editable field (for example "fills itself with today's date when saved"). */
  note?: string;
  /** Offered while the field is empty and never written on its own: taking it is the person confirming it. */
  suggestion?: { value: string; from: string };
  /** A caution under an editable field (a value the master doesn't have) — it warns, it doesn't block. */
  warning?: string;
  /** A number field: phones and tablets open the number keyboard. */
  numeric?: boolean;
  /** The latest day a date field's calendar offers (ISO): later days are greyed out. */
  maxDate?: string;
  /** A closed list: a dropdown you can type in to search, never free text. A stored value outside it stays, never dropped. */
  choices?: readonly string[];
  /** Told when the choices dropdown opens (the page re-reads its masters then). */
  onChoicesOpen?: () => void;
}

/** One field row: label + an optional system/calculated badge + a controlled input. The displayed
 * value always comes from the record itself via `value`, never from the generic sample (`field.v`)
 * in the field dictionary, so one receipt's blank field can't show another receipt's sample data.
 * Purely presentational — the caller owns where the value lives. */
export function FieldInput({ field, value, onChange, onBlur, idPrefix, readOnly, system, note, suggestion, warning, numeric, choices, onChoicesOpen, maxDate }: Props) {
  const locked = readOnly || Boolean(system);
  const id = `field-${idPrefix ?? ""}-${field.col}`.replace(/\s+/g, "-");
  // A locked box gets no focus ring: the orange "typing here" border on a calculated value made people think they could change it.
  const inputClass = `w-full px-3 py-2 rounded-xl border border-warmstone-200 text-[13px] placeholder-warmstone-400 outline-none transition-all ${
    locked ? "bg-warmstone-100 text-warmstone-600 cursor-not-allowed" : "bg-warmstone-50 text-warmstone-900 focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
  }`;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label htmlFor={id} className="text-[12.5px] font-semibold text-warmstone-700">
          {field.label ?? field.n}
        </label>
        {system && (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-warmstone-200 text-warmstone-700">
            {system.kind === "calculated" ? "calculated" : "system"}
          </span>
        )}
      </div>
      {field.format === "datetime" && !locked ? (
        // A date and a time; with maxDate set the field can't be in the future, to the minute.
        <DateTimeInput id={id} value={value} onChange={onChange} onBlur={onBlur} max={maxDate ? nowStamp() : undefined} />
      ) : field.format === "date" && !locked ? (
        <DateInput id={id} value={value} onChange={onChange} onBlur={onBlur} max={maxDate} className={inputClass} />
      ) : choices && !locked ? (
        // Saved on pick, not on blur: a pick is a whole answer, unlike a half-typed number.
        <SearchSelect id={id} value={value} options={choices} onOpen={onChoicesOpen} onChange={(v) => { onChange(v); onBlur?.(); }} />
      ) : (
      <input
        id={id}
        // A date or timestamp that cannot be edited here is still shown in the app's one date format.
        value={field.format === "datetime" ? formatDateTime(value) : field.format === "date" ? formatDate(value) : value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        readOnly={locked}
        inputMode={numeric ? "decimal" : undefined}
        aria-describedby={system ? `${id}-hint` : undefined}
        placeholder={value ? "" : system ? (system.kind === "calculated" ? "Calculated automatically" : "Issued automatically") : "Not recorded yet"}
        className={inputClass}
      />
      )}
      {system && (
        <p id={`${id}-hint`} className="mt-1 text-[11.5px] text-warmstone-500">
          {system.hint}
        </p>
      )}
      {note && !system && <p className="mt-1 text-[12px] text-warmstone-500">{note}</p>}
      {warning && !locked && <p className="mt-1 text-[12px] font-semibold text-ambernut-700">{warning}</p>}
      {suggestion && !locked && !value.trim() && (
        <button
          type="button"
          onClick={() => { onChange(suggestion.value); onBlur?.(); }}
          className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-700 hover:text-brand-800"
        >
          <span className="material-symbols-outlined text-[14px]">auto_fix_high</span>
          Use {suggestion.value} <span className="font-normal text-warmstone-500">(from {suggestion.from})</span>
        </button>
      )}
    </div>
  );
}
