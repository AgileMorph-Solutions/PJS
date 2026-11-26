import type { Stage } from "../types/stage";
import { derivedRuleFor } from "../domain/receiptMath";
import { AUTO_FIELD_NOTES, autoFieldFor } from "@anagroci/contract/data/autoFields";
import { BIN_FINALISE_FIELDS } from "@anagroci/contract/domain/binFinalise";
import { fieldChoices } from "@anagroci/contract/data/fieldChoices";
import { fieldNote, isNoFutureDate, isNumericField, type FieldIssue } from "@anagroci/contract/domain/fieldRules";
import { CURRENCY, isMoneyField } from "@anagroci/contract/domain/currency";
import { FieldInput } from "./FieldInput";
import { isSupplierLinkedField } from "@anagroci/contract/domain/supplierCode";

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
  /** On a read-only form, the fields that stay editable: a Branch Manager's / QFS Officer's own fields still to fill. */
  editable?: readonly string[];
  /** A note per field label, in place of the field's usual one (what a submitted value is waiting for). */
  notes?: Record<string, string>;
  /** Limit the grid to these field labels (a role's form covers only part of a stage). */
  only?: string[];
  /** Field labels this person may not see at all (price and amount for the Warehouse Incharge, contract HIDDEN_FIELDS). */
  hidden?: string[];
  /** What could be filled in from elsewhere, per empty field label — offered, never written. */
  suggestions?: Record<string, { value: string; from: string }>;
  /** Closed lists per field label that come from a master (WH LOCATION's warehouses, the Bins): a searchable dropdown. The fixed lists of
   * the spec (contract data/fieldChoices.ts) are added by this form itself. */
  choices?: Record<string, readonly string[]>;
  /** Told when any dropdown in the form opens, so the page can re-read the masters its lists come from. */
  onChoicesOpen?: () => void;
  /** A caution per field label, shown under the field while it is editable. */
  warnings?: Record<string, string>;
  /** What the field rules say about each value (contract domain/fieldRules.ts): shown as a warning under the field; the value is saved either way. */
  issues?: Record<string, FieldIssue>;
  /** Set when the phase before this one isn't complete (contract domain/phaseGate.ts): shown above the fields, which are read-only. */
  lockedMessage?: string;
  /** Field labels typed on this record though usually calculated (KOR on a truck from the Unit warehouse, which has no cut test). */
  typed?: readonly string[];
}

/**
 * A "Sample X" field and its "Final X" twin (QFS moisture, nut count and cut test), plus KOR and FINAL KOR, go on one row, sample
 * on the left and final on the right, so the two readings of the same thing are read across under one Sample / Final header. Layout
 * only: the stage's field order stays the spec's (stages.ts), except that KOR's row goes last, under the grams it is calculated
 * from. A field without its twin stays in the ordinary grid.
 */
function pairSampleFinal<F extends { n: string }>(fields: F[]) {
  // KOR is the sample's reading but its label doesn't say so, so it can't be matched by prefix.
  const finalTwinOf = (n: string) => (n === "KOR" ? "FINAL KOR" : n.startsWith("Sample ") ? `Final ${n.slice("Sample ".length)}` : undefined);
  const byName = new Map(fields.map((f) => [f.n, f]));
  const pairs: [F, F][] = [];
  const paired = new Set<string>();
  for (const f of fields) {
    const twinName = finalTwinOf(f.n);
    const twin = twinName ? byName.get(twinName) : undefined;
    if (twin) { pairs.push([f, twin]); paired.add(f.n).add(twin.n); }
  }
  // KOR comes out of the cut-test grams, so it reads last, under the grams it is calculated from (Nov 2026).
  const korLast = [...pairs.filter(([a]) => a.n !== "KOR"), ...pairs.filter(([a]) => a.n === "KOR")];
  return { single: fields.filter((f) => !paired.has(f.n)), pairs: korLast };
}

/**
 * A field nobody types on this form: a calculation (Gross, Net, Paid, Amount, SACS, KOR…) or a value the Finalise action
 * stamps. Placement only; whether a calculation locks the field right now is decided per render below.
 */
const isSystemField = (stageId: string, label: string): boolean =>
  Boolean(derivedRuleFor(stageId, label)) || (stageId === "n-bin" && (BIN_FINALISE_FIELDS as readonly string[]).includes(label)) || isSupplierLinkedField(stageId, label);

/** Generic renderer driven entirely by a Stage's data — adding a stage later is a data change.
 * Presentational: `values` and `onFieldChange` let the same component back either a receipt record
 * field (ReceiptDetailPage) or a scratch draft (the intake wizard). */
export function StageForm({ stage, values, derived, onFieldChange, onFieldBlur, readOnly: readOnlyProp, editable, notes, only, hidden, suggestions, warnings, choices, onChoicesOpen, issues, lockedMessage, typed }: Props) {
  const readOnly = readOnlyProp || Boolean(lockedMessage);
  const shown = stage.fields.filter((f) => (!only || only.includes(f.n)) && !hidden?.includes(f.n));
  const { single: spec, pairs } = pairSampleFinal(shown);
  // What the system fills or calculates comes after everything a person types (Nov 2026: a read-only field in the middle of
  // the form confused people). A stable sort: the rest keep the spec's order (stages.ts), which the workbook columns follow.
  const single = [...spec].sort((a, b) => Number(isSystemField(stage.id, a.n)) - Number(isSystemField(stage.id, b.n)));
  const render = (f: Stage["fields"][number]) => {
    // A calculation with a typed fallback locks the field only once it has a value to show (`derived` holds one
    // exactly when every input is recorded); one calculated only in the app (KOR) is never typed here at all.
    const rule = typed?.includes(f.n) ? undefined : derivedRuleFor(stage.id, f.n);
    const inForce = rule && !rule.editable && (!rule.fallbackToTyped || rule.calculatedOnlyInApp || derived?.[f.n] !== undefined);
    // Filled in by its formula but a person may change it (the bag totals): an ordinary box showing what is stored, so it
    // can be emptied while typing. The form saves the new total with each count (followingTotals); a cleared one refills on save.
    const editableCalc = rule?.editable ? rule : undefined;
    // The whole Lot stage is the system's (the server refuses any write to it), and calculated
    // fields follow their formula. Nobody types either.
    const system = rule && inForce
      ? { kind: "calculated" as const, hint: rule.formula }
      // The Lot Number is the system's until it is issued; after that a person may replace it (25 Nov 2026).
      : stage.id === "n-lot" && !(f.n === "Lot Number" && (values[f.n] ?? "").trim())
        ? {
            kind: "issued" as const,
            hint: f.n === "Lot Number" ? "Issued by the system when the truck passes quality" : "Filled in when the Lot is issued",
          }
        : stage.id === "n-bin" && (BIN_FINALISE_FIELDS as readonly string[]).includes(f.n)
          ? { kind: "issued" as const, hint: "Stamped when the bin allocation is finalised" }
          : isSupplierLinkedField(stage.id, f.n)
            ? { kind: "issued" as const, hint: "The supplier's own code, from Masters › Suppliers. Change the supplier to change it." }
            : undefined;
    // A field that fills itself: say so while it is still blank, so nobody wonders why it appears after saving.
    const auto = autoFieldFor(stage.id, f.n);
    const fieldReadOnly = readOnly && !(editable?.includes(f.n) && !lockedMessage);
    const note = notes?.[f.n] ?? (editableCalc
      ? editableCalc.formula
      : stage.id === "n-lot" && f.n === "Lot Number"
        ? "Issued by the system. You can change it."
      : auto && !(values[f.n] ?? "").trim() && !fieldReadOnly
      ? `${AUTO_FIELD_NOTES[auto.from]} You can change it until the record is locked.`
      : fieldNote(stage.id, f.n));
    return (
      <FieldInput
        key={f.n}
        field={f}
        value={inForce ? (derived?.[f.n] ?? values[f.n] ?? "") : (values[f.n] ?? "")}
        suggestion={suggestions?.[f.n]}
        choices={choices?.[f.n] ?? fieldChoices(stage.id, f.n)}
        onChoicesOpen={onChoicesOpen}
        warning={warnings?.[f.n] ?? issues?.[f.n]?.message}
        numeric={isNumericField(stage.id, f.n)}
        lead={isMoneyField(stage.id, f.n) ? CURRENCY : undefined}
        maxDate={isNoFutureDate(stage.id, f.n) ? new Date().toISOString().slice(0, 10) : undefined}
        onChange={(v) => onFieldChange(f.n, v)}
        onBlur={onFieldBlur}
        idPrefix={stage.id}
        readOnly={fieldReadOnly}
        system={system}
        note={note}
      />
    );
  };

  return (
    <div className="space-y-4">
      {lockedMessage && (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-warmstone-200 bg-warmstone-100 px-3 py-2 text-[13px] text-warmstone-800">
          <span className="material-symbols-outlined text-[18px] text-warmstone-500">lock</span>
          {lockedMessage}
        </p>
      )}
      {stage.file && (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-warmstone-100 text-warmstone-600 text-[11px] font-medium">
          <span className="material-symbols-outlined text-[13px]">description</span>
          {stage.file}
          {stage.sheet ? ` · ${stage.sheet}` : ""}
        </span>
      )}
      {pairs.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-4">
          <p className="hidden sm:block text-[11px] font-bold uppercase tracking-wide text-warmstone-500">Truck sampling</p>
          <p className="hidden sm:block text-[11px] font-bold uppercase tracking-wide text-warmstone-500">Final unloading</p>
          {pairs.flatMap(([a, b]) => [render(a), render(b)])}
        </div>
      )}
      {single.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-4">
          {single.map(render)}
        </div>
      )}
    </div>
  );
}
