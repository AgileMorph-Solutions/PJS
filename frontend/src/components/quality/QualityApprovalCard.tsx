import { useState } from "react";
import {
  DRYING_DECISION_LABELS, QUALITY_SUBMISSION_INFO, type QualitySubmissionView,
} from "@anagroci/contract/domain/qualityChecks";
import { binsAtSite } from "@anagroci/contract/domain/binNumber";
import { formatDateTime } from "@anagroci/contract/domain/dateFormat";
import { api } from "../../repository/api";
import { useTracking } from "../../state/TrackingContext";
import { usePendingApprovals } from "../../state/PendingApprovals";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import { SearchSelect } from "../ui/SearchSelect";
import { QualitySectionTag } from "./QualitySectionTag";

/** How a submitted reading is named on the card: the drying form's keys without their before/after prefix. */
const LABELS: Record<string, string> = {
  Moisture: "Moisture (%)", NutCount: "Nut count", Kor: "KOR", GoodKernelG: "Good kernel (g)", ImmatureG: "Immature (g)", SpottedG: "Spotted (g)",
  RejectionG: "Rejection (g)", VoidG: "Void (g)", OilG: "Oil (g)", ShellG: "Shell (g)",
  moisture: "Moisture (%)", kor: "KOR", nutCount: "Nut count", moisturePct: "Moisture after triage (%)", destinationBin: "New Bin", btmNo: "BTM",
};
const labelOf = (k: string) => LABELS[k] ?? LABELS[k.replace(/^(input|output)/, "")] ?? k;

/**
 * A QFS Officer's drying, transfer lot or triage check, for the Warehouse Incharge to approve or reject (26 Nov 2026). It says
 * which section it is from and what it is about, as the QFS Officer's list does. A drying that passed goes into a new Bin:
 * when the QFS Officer didn't name one, the Incharge chooses it here, since where the RCN goes is the warehouse's decision.
 */
export function QualityApprovalCard({ submission: q }: { submission: QualitySubmissionView }) {
  const { masters } = useTracking();
  const { refresh } = usePendingApprovals();
  const [bin, setBin] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsBin = q.kind === "drying_after" && q.values.decision === "pass";
  const bins = binsAtSite(masters.binInfo ?? [], masters.warehouses, masters.aliases, q.warehouse);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const readings = Object.entries(q.values).filter(([k]) => k !== "decision");
  return (
    <div className="bg-white border border-warmstone-200 rounded-2xl shadow-xs p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <QualitySectionTag section={q.section} />
        <span className="text-[13px] font-bold text-warmstone-900">{QUALITY_SUBMISSION_INFO[q.kind].title}</span>
        <span className="text-[12px] text-warmstone-500 ml-auto">{q.submittedBy} · {formatDateTime(q.submittedAt)}</span>
      </div>
      <p className="text-[13px] text-warmstone-800">{q.reference}</p>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-[13px]">
        {readings.map(([k, v]) => (
          <div key={k}><dt className="text-[12px] text-warmstone-500">{labelOf(k)}</dt><dd className="font-semibold text-warmstone-900 tabular-nums">{v}</dd></div>
        ))}
        {q.values.decision && (
          <div className="col-span-2"><dt className="text-[12px] text-warmstone-500">Result</dt><dd className="font-semibold text-warmstone-900">{DRYING_DECISION_LABELS[q.values.decision as keyof typeof DRYING_DECISION_LABELS] ?? q.values.decision}</dd></div>
        )}
      </dl>
      {needsBin && !q.values.destinationBin && (
        <div className="max-w-xs">
          <Field label="New Bin" hint="Where the dried RCN goes. Leave it if it was chosen when the RCN came back.">
            <SearchSelect id={`quality-bin-${q.id}`} value={bin} options={bins} placeholder="Choose the new Bin…" onChange={setBin} />
          </Field>
        </div>
      )}
      <div className="flex items-end gap-3 flex-wrap">
        {!rejecting ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>Reject</Button>
            <Button disabled={busy} icon="check" onClick={() => void act(() => api.approveQualityCheck(q.id, bin ? { destinationBin: bin } : {}))}>Approve the check</Button>
          </>
        ) : (
          <>
            <div className="flex-1 min-w-[14rem]"><Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it is rejected (required)" /></Field></div>
            <Button variant="secondary" onClick={() => setRejecting(false)}>Cancel</Button>
            <Button variant="danger" disabled={busy || !reason.trim()} onClick={() => void act(() => api.rejectQualityCheck(q.id, reason.trim()))}>Reject the check</Button>
          </>
        )}
      </div>
      {error && <p role="alert" className="text-[12px] text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
    </div>
  );
}
