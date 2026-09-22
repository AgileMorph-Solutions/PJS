import type { Stage } from "../types/stage";
import { FieldInput } from "./FieldInput";

const KIND_LABEL: Record<Stage["kind"], string> = {
  entry: "Fill in here",
  decision: "Decision",
  system: "Automatic",
  gap: "New requirement",
};

const KIND_CLASS: Record<Stage["kind"], string> = {
  entry: "bg-success-100 text-success-800",
  decision: "bg-ambernut-100 text-ambernut-800",
  system: "bg-warmstone-100 text-warmstone-700",
  gap: "bg-brand-100 text-brand-800",
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
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${KIND_CLASS[stage.kind]}`}>
          {KIND_LABEL[stage.kind]}
        </span>
        {stage.file && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-warmstone-100 text-warmstone-600 text-[11px] font-medium">
            <span className="material-symbols-outlined text-[13px]">description</span>
            {stage.file}
            {stage.sheet ? ` · ${stage.sheet}` : ""}
          </span>
        )}
      </div>
      <p className="text-[13px] text-warmstone-500 leading-relaxed">{stage.note}</p>
      <div className="grid sm:grid-cols-2 gap-4">
        {stage.fields.map((f) => (
          <FieldInput
            key={f.n}
            field={f}
            value={values[f.n] ?? ""}
            onChange={(v) => onFieldChange(f.n, v)}
            onBlur={onFieldBlur}
            idPrefix={stage.id}
          />
        ))}
      </div>
    </div>
  );
}
