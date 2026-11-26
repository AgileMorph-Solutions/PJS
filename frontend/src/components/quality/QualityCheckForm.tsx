import { useState, type FormEvent } from "react";
import {
  APPROVER_LABEL, DRYING_DECISION_LABELS, QUALITY_SECTIONS, QUALITY_SUBMISSION_INFO, qualitySubmissionProblem,
  type QualitySubmissionKind,
} from "@anagroci/contract/domain/qualityChecks";
import { transferNumberProblem } from "@anagroci/contract/domain/transferLot";
import { api } from "../../repository/api";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import { DryingQualityInputs } from "./DryingQualityInputs";
import { hasHardProblem, qualityKeys } from "./dryingQuality";

interface Props {
  kind: QualitySubmissionKind;
  targetId: string;
  /** What the record already says, from the list (contract QualityCheckItem.facts). */
  facts?: Record<string, string>;
  onSent: () => void;
  onCancel: () => void;
}

/**
 * A QFS Officer's drying or transfer lot check, sent for the Warehouse Incharge's approval (26 Nov 2026). The inputs
 * are the ones the Incharge's own form has (DryingQualityInputs, the transfer number rules), so both read the same; the
 * server refuses what the contract's qualitySubmissionProblem refuses here.
 */
export function QualityCheckForm({ kind, targetId, facts = {}, onSent, onCancel }: Props) {
  const [values, setValues] = useState<Record<string, string>>(kind === "drying_after" ? { decision: "pass" } : {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));
  const info = QUALITY_SUBMISSION_INFO[kind];
  const approver = APPROVER_LABEL[QUALITY_SECTIONS[info.section].approver];

  const blocked = kind === "drying_before" ? hasHardProblem(values, qualityKeys("input"), "input")
    : kind === "drying_after" ? hasHardProblem(values, qualityKeys("output"), "output")
    : false;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const sent = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
    const problem = qualitySubmissionProblem(kind, sent);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try { await api.submitQualityCheck(kind, targetId, sent); onSent(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  }

  const transferBox = (key: "moisture" | "kor" | "nutCount", label: string, hint?: string) => (
    <Field label={`${label} *`} hint={hint} problem={values[key]?.trim() ? transferNumberProblem(key, values[key]) : undefined}>
      <Input numeric inputMode={key === "nutCount" ? "numeric" : "decimal"} value={values[key] ?? ""} onChange={(e) => set(key, e.target.value)} />
    </Field>
  );

  return (
    <form onSubmit={submit} className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 space-y-4" noValidate>
      <h4 className="text-[13px] font-bold text-warmstone-900">{info.title}</h4>
      {kind === "drying_before" && <DryingQualityInputs prefix="input" values={values} onChange={set} />}
      {kind === "drying_after" && (
        <>
          <p className="text-[12px] text-warmstone-600">
            Before this round: moisture <b>{facts.inputMoisture || "-"}%</b> · KOR <b>{facts.inputKor || "-"}</b> · nut count <b>{facts.inputNutCount || "-"}</b>
          </p>
          <DryingQualityInputs prefix="output" values={values} onChange={set} />
          <fieldset>
            <legend className="text-[13px] font-bold text-warmstone-900 mb-2">Result</legend>
            <div className="flex flex-col gap-2 text-[13px] text-warmstone-800">
              {(["pass", "redry", ...(facts.production ? ["production"] as const : [])] as const).map((d) => (
                <label key={d} className="flex items-center gap-2">
                  <input type="radio" name={`decision-${targetId}`} checked={values.decision === d} onChange={() => set("decision", d)} />
                  {DRYING_DECISION_LABELS[d]}
                </label>
              ))}
            </div>
            {values.decision === "pass" && (
              <p className="text-[12px] text-warmstone-500 mt-2">
                {facts.destinationBin ? `New Bin chosen with what came back: ${facts.destinationBin}.` : "The Warehouse Incharge chooses the new Bin when approving."}
              </p>
            )}
          </fieldset>
        </>
      )}
      {kind === "transfer_lot" && (
        <div className="grid sm:grid-cols-3 gap-4">
          {transferBox("moisture", "Moisture (%)")}
          {transferBox("kor", "KOR")}
          {transferBox("nutCount", "Nut count", "Nuts in 1 kg.")}
        </div>
      )}
      {error && <p role="alert" className="text-[12px] text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" icon="send" disabled={busy || blocked}>{busy ? "Sending…" : "Send for approval"}</Button>
        <span className="text-[12px] text-warmstone-500">The {approver} approves it; nothing changes on the record before that.</span>
      </div>
    </form>
  );
}
