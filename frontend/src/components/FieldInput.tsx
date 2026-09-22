import type { StageField } from "../types/stage";

interface Props {
  field: StageField;
  value: string;
  onChange: (value: string) => void;
  /** Flush buffered edits immediately — writes are coalesced, so blur is the natural commit point. */
  onBlur?: () => void;
}

/** One field row: label + "from <file>" / "new" badge + a controlled input.
 * `field.v` only ever decides the badge (does a real workbook capture this *kind* of field) —
 * the actual displayed value always comes from the record itself via `value`, never from the
 * generic sample in the field dictionary, so one receipt's blank field can't show another
 * receipt's sample data. Purely presentational — the caller owns where the value lives. */
export function FieldInput({ field, value, onChange, onBlur }: Props) {
  const isMock = field.v !== "";
  const placeholder = !isMock
    ? "Not captured anywhere today — type a value to try it out"
    : value
      ? ""
      : "Not yet recorded for this receipt";

  return (
    <div className="field-row">
      <div className="field-label">
        <span>{field.n}</span>
        <span className={`field-badge ${isMock ? "xl" : "new"}`}>
          {isMock ? "from workbook" : "new field"}
        </span>
      </div>
      <input value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} />
    </div>
  );
}
