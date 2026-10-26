import type { Stage } from "../types/stage";
import { derivedRuleFor } from "../domain/receiptMath";
import { AUTO_DATE_FIELDS } from "@anagroci/contract/data/autoFields";
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
  /** Field labels this person may not see at all (price and amount for the Warehouse Incharge, contract HIDDEN_FIELDS). */
  hidden?: string[];
  /** What could be filled in from elsewhere, per empty field label — offered, never written. */
  suggestions?: Record<string, { value: string; from: string }>;
  /** Known values per field label to choose from. */
  options?: Record<string, string[]>;
  /** A caution per field label, shown under the field while it is editable. */
  warnings?: Record<string, string>;
}

/**
 * A "Sample – X" field and its "Final – X" twin (the QFS cut test of the sample and of the final panel) go on one row, sample on
 * the left and final on the right, so the two readings of the same thing are read across. Layout only: the stage's field order
 * stays the spec's (stages.ts). A field without its twin stays in the ordinary grid.
 */
function pairSampleFinal<F extends { n: string }>(fields: F[]) {
  const SAMPLE = "Sample – ", FINAL = "Final – ";
  const byName = new Map(fields.map((f) => [f.n, f]));
  const pairs: [F, F][] = [];
  const paired = new Set<string>();
  for (const f of fields) {
    const twin = f.n.startsWith(SAMPLE) ? byName.get(FINAL + f.n.slice(SAMPLE.length)) : undefined;
    if (twin) { pairs.push([f, twin]); paired.add(f.n).add(twin.n); }
  }
  return { single: fields.filter((f) => !paired.has(f.n)), pairs };
}

/** Generic renderer driven entirely by a Stage's data — adding a stage later is a data change.
 * Presentational: `values` and `onFieldChange` let the same component back either a receipt record
 * field (ReceiptDetailPage) or a scratch draft (the intake wizard). */
export function StageForm({ stage, values, derived, onFieldChange, onFieldBlur, readOnly, only, hidden, suggestions, options, warnings }: Props) {
  const shown = stage.fields.filter((f) => (!only || only.includes(f.n)) && !hidden?.includes(f.n));
  const { single, pairs } = pairSampleFinal(shown);
  const render = (f: Stage["fields"][number]) => {
    // A calculation with a typed fallback (KOR) locks the field only once it has a value to show:
    // `derived` holds a value for it exactly when every input is recorded.
    const rule = derivedRuleFor(stage.id, f.n);
    const inForce = rule && (!rule.fallbackToTyped || derived?.[f.n] !== undefined);
    // The whole Lot stage is the system's (the server refuses any write to it), and calculated
    // fields follow their formula. Nobody types either.
    const system = rule && inForce
      ? { kind: "calculated" as const, hint: rule.formula }
      : stage.id === "n-lot"
        ? {
            kind: "issued" as const,
            hint: f.n === "Lot Number" ? "Issued by the system when the truck passes quality" : "Filled in when the Lot is issued",
          }
        : stage.id === "n-bin" && (f.n === "Bin allocation date" || f.n === "Finalised by")
          ? { kind: "issued" as const, hint: "Stamped when the bin allocation is finalised" }
          : undefined;
    // A date that fills itself: say so while it is still blank, so nobody wonders why it appears after saving.
    const auto = AUTO_DATE_FIELDS[stage.id]?.find((a) => a.label === f.n);
    const note = auto && !(values[f.n] ?? "").trim() && !readOnly
      ? auto.from === "arrival" ? "Fills itself with the day the truck arrived when this step is saved. You can change it until the record is locked." : "Fills itself with today's date when this step is saved. You can change it until the record is locked."
      : undefined;
    return (
      <FieldInput
        key={f.n}
        field={f}
        value={inForce ? (derived?.[f.n] ?? values[f.n] ?? "") : (values[f.n] ?? "")}
        suggestion={suggestions?.[f.n]}
        options={options?.[f.n]}
        warning={warnings?.[f.n]}
        onChange={(v) => onFieldChange(f.n, v)}
        onBlur={onFieldBlur}
        idPrefix={stage.id}
        readOnly={readOnly}
        system={system}
        note={note}
      />
    );
  };

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
        {single.map(render)}
      </div>
      {pairs.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-4">
          <p className="hidden sm:block text-[11px] font-bold uppercase tracking-wide text-warmstone-500">Sample</p>
          <p className="hidden sm:block text-[11px] font-bold uppercase tracking-wide text-warmstone-500">Final</p>
          {pairs.flatMap(([a, b]) => [render(a), render(b)])}
        </div>
      )}
    </div>
  );
}
