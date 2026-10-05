import type { StageField } from "../types/stage";

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
}

/** One field row: label + an optional "new" badge + a controlled input. `field.v` only ever
 * decides the badge (is this a proposed field with no real workbook backing it) — the actual
 * displayed value always comes from the record itself via `value`, never from the generic sample
 * in the field dictionary, so one receipt's blank field can't show another receipt's sample data.
 * Purely presentational — the caller owns where the value lives. */
export function FieldInput({ field, value, onChange, onBlur, idPrefix, readOnly, system }: Props) {
  const isNew = field.v === "";
  const locked = readOnly || Boolean(system);
  const id = `field-${idPrefix ?? ""}-${field.col}`.replace(/\s+/g, "-");

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label htmlFor={id} className="text-[12.5px] font-semibold text-warmstone-700">
          {field.n}
        </label>
        {system ? (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-warmstone-200 text-warmstone-700">
            {system.kind === "calculated" ? "calculated" : "system"}
          </span>
        ) : (
          isNew && (
            <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-ambernut-100 text-ambernut-800">new</span>
          )
        )}
      </div>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        readOnly={locked}
        aria-describedby={system ? `${id}-hint` : undefined}
        placeholder={value ? "" : system ? (system.kind === "calculated" ? "Calculated automatically" : "Issued automatically") : "Not recorded yet"}
        className={`w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13.5px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700 ${locked ? "cursor-default text-warmstone-600" : ""}`}
      />
      {system && (
        <p id={`${id}-hint`} className="mt-1 text-[11.5px] text-warmstone-500">
          {system.hint}
        </p>
      )}
    </div>
  );
}
