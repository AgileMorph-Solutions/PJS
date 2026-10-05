import type { Stage } from "../types/stage";
import { derivedRuleFor } from "../domain/receiptMath";
import { FieldInput } from "./FieldInput";

interface Props {
  stage: Stage;
  values: Record<string, string>;
  /** What the system would calculate for this stage from the receipt's current readings
   * (computeDerivedFields(...)[stage.id]) — shown at once, before the server has saved the write
   * that changed an input. Calculated fields display this instead of what is stored. */
  derived?: Record<string, string>;
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
export function StageForm({ stage, values, derived, onFieldChange, onFieldBlur, readOnly, only }: Props) {
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
        {stage.fields.filter((f) => !only || only.includes(f.n)).map((f) => {
          const rule = derivedRuleFor(stage.id, f.n);
          // The whole Lot stage is the system's (the server refuses any write to it), and calculated
          // fields follow their formula. Nobody types either.
          const system = rule
            ? { kind: "calculated" as const, hint: rule.formula }
            : stage.id === "n-lot"
              ? {
                  kind: "issued" as const,
                  hint: f.n === "Lot Number" ? "Issued by the system when the truck passes quality" : "Filled in when the Lot is issued",
                }
              : undefined;
          return (
            <FieldInput
              key={f.n}
              field={f}
              value={rule ? (derived?.[f.n] ?? values[f.n] ?? "") : (values[f.n] ?? "")}
              onChange={(v) => onFieldChange(f.n, v)}
              onBlur={onFieldBlur}
              idPrefix={stage.id}
              readOnly={readOnly}
              system={system}
            />
          );
        })}
      </div>
    </div>
  );
}
