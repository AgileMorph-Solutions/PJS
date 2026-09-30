import type { Stage } from "../types/stage";
import { FieldInput } from "./FieldInput";

interface Props {
  stage: Stage;
  values: Record<string, string>;
  onFieldChange: (fieldName: string, value: string) => void;
  /** Called when a field loses focus, so the caller can flush its coalesced writes. */
  onFieldBlur?: () => void;
  readOnly?: boolean;
  /** Limit the grid to these field labels (a role's form covers only part of a stage). */
  only?: string[];
}

/** Generic renderer driven entirely by a Stage's data — adding a stage later is a data change.
 * Presentational: `values` and `onFieldChange` let the same component back either a receipt record
 * field (ReceiptDetailPage) or a scratch draft (the intake wizard). */
export function StageForm({ stage, values, onFieldChange, onFieldBlur, readOnly, only }: Props) {
  return (
    <div className="space-y-4">
      {stage.file && (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-warmstone-100 text-warmstone-600 text-[11px] font-medium">
          <span className="material-symbols-outlined text-[13px]">description</span>
          {stage.file}
          {stage.sheet ? ` · ${stage.sheet}` : ""}
        </span>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        {stage.fields.filter((f) => !only || only.includes(f.n)).map((f) => (
          <FieldInput
            key={f.n}
            field={f}
            value={values[f.n] ?? ""}
            onChange={(v) => onFieldChange(f.n, v)}
            onBlur={onFieldBlur}
            idPrefix={stage.id}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}
