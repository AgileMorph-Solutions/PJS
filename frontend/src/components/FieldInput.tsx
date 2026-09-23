import type { StageField } from "../types/stage";

interface Props {
  field: StageField;
  value: string;
  onChange: (value: string) => void;
  /** Flush buffered edits immediately — writes are coalesced, so blur is the natural commit point. */
  onBlur?: () => void;
  /** Makes the generated input id unique across stages that render on the same page. */
  idPrefix?: string;
}

/** One field row: label + an optional "new" badge + a controlled input. `field.v` only ever
 * decides the badge (is this a proposed field with no real workbook backing it) — the actual
 * displayed value always comes from the record itself via `value`, never from the generic sample
 * in the field dictionary, so one receipt's blank field can't show another receipt's sample data.
 * Purely presentational — the caller owns where the value lives. */
export function FieldInput({ field, value, onChange, onBlur, idPrefix }: Props) {
  const isNew = field.v === "";
  const id = `field-${idPrefix ?? ""}-${field.col}`.replace(/\s+/g, "-");

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label htmlFor={id} className="text-[12.5px] font-semibold text-warmstone-700">
          {field.n}
        </label>
        {isNew && (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-ambernut-100 text-ambernut-800">new</span>
        )}
      </div>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={value ? "" : "Not recorded yet"}
        className="w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13.5px] text-warmstone-900 placeholder-warmstone-400 outline-none transition-all focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700"
      />
    </div>
  );
}
