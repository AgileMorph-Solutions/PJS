import type { Stage } from "../types/stage";
import { FieldInput } from "./FieldInput";

const KIND_LABEL: Record<Stage["kind"], string> = {
  entry: "Fill in here",
  decision: "Decision",
  system: "Automatic",
  gap: "New requirement",
};

interface Props {
  stage: Stage;
  values: Record<string, string>;
  onFieldChange: (fieldName: string, value: string) => void;
  /** Called when a field loses focus, so the caller can flush its coalesced writes. */
  onFieldBlur?: () => void;
}

/** Generic renderer driven entirely by a Stage's data — adding a stage later is a data change.
 * Presentational: `values` and `onFieldChange` let the same component back either a receipt record
 * field (ReceiptDetailPage) or a scratch draft (the intake wizard). */
export function StageForm({ stage, values, onFieldChange, onFieldBlur }: Props) {
  return (
    <>
      <span className={`kind-chip kind-${stage.kind}`}>{KIND_LABEL[stage.kind]}</span>
      {stage.file && (
        <div className="file-chip">
          📄 {stage.file}
          {stage.sheet ? ` · ${stage.sheet}` : ""}
        </div>
      )}
      <p className="stage-note">{stage.note}</p>
      {stage.fields.map((f) => (
        <FieldInput key={f.n} field={f} value={values[f.n] ?? ""} onChange={(v) => onFieldChange(f.n, v)} onBlur={onFieldBlur} />
      ))}
    </>
  );
}
