import { useState } from "react";
import { FieldInput } from "../FieldInput";

interface Field { n: string; v: string; col: string }

interface Props {
  /** The real field dictionary for one production table (from @anagroci/contract/data/
   * productionTables), so the form is driven by data — a new table is a data change, not a new
   * component, same rule StageForm already follows for procurement. */
  fields: Field[];
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  idPrefix: string;
}

/** A small, generic add-row form for a production table. Unlike StageForm (which edits a field
 * already living on a persisted record), this collects a fresh row's worth of values and submits
 * them once — production writes are per-record submissions (a receipt line, a cooking run), not
 * per-keystroke stage edits, so there's no coalescing/debounce machinery to reuse from
 * TrackingContext here. */
export function ProductionRowForm({ fields, submitLabel, onSubmit, idPrefix }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(values);
      setValues({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {fields.map((f) => (
          <FieldInput
            key={f.col}
            field={f}
            value={values[f.n] ?? ""}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.n]: v }))}
            idPrefix={idPrefix}
          />
        ))}
      </div>
      {error && (
        <p className="text-[12.5px] text-danger-700 bg-danger-50 border border-danger-200 rounded-lg px-3 py-2">{error}</p>
      )}
      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={submitting}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-bold transition-all shadow-sm disabled:opacity-50"
      >
        {submitting ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}
