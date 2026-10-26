import { useState } from "react";
import type { ReceiptRecord } from "../types/receipt";
import type { SubmissionView } from "../types/user";
import { formById } from "../data/roles";
import { api } from "../repository/api";
import { useTracking } from "../state/TrackingContext";
import { usePendingApprovals } from "../state/PendingApprovals";
import { formatDateTime } from "@anagroci/contract/domain/dateFormat";

/** One submission as a current → submitted diff, with Approve / Reject (reason required). Shared by
 * the receipt page (its own submissions) and the Approvals queue (all pending ones). */
export function SubmissionReview({
  submission, receipt, onDone,
}: { submission: SubmissionView; receipt?: ReceiptRecord; onDone?: () => void }) {
  const { refresh } = useTracking();
  const { refresh: refreshPending } = usePendingApprovals();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = submission.status === "submitted";

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      refreshPending();
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const rows = Object.entries(submission.values).flatMap(([stageId, fields]) =>
    Object.entries(fields).map(([label, value]) => ({
      key: `${stageId}/${label}`, label, value, current: receipt?.stageData[stageId]?.[label] ?? "",
    }))
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap text-[12.5px]">
        <span className="font-semibold text-warmstone-900">{formById(submission.formId)?.title ?? submission.formId}</span>
        <span className="text-warmstone-500">
          {submission.submittedBy} · {formatDateTime(submission.submittedAt)}
        </span>
      </div>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-warmstone-500">
            <th className="py-1 pr-3">Field</th>
            {receipt && <th className="py-1 pr-3">Current</th>}
            <th className="py-1">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-warmstone-100">
              <td className="py-1.5 pr-3 text-warmstone-700">{r.label}</td>
              {receipt && <td className="py-1.5 pr-3 text-warmstone-400">{r.current || "-"}</td>}
              <td className={`py-1.5 font-semibold ${receipt && r.current !== r.value ? "text-brand-800" : "text-warmstone-900"}`}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!pending && (
        <p className="text-[12.5px] text-warmstone-500">
          {submission.status === "approved" ? "Approved" : "Rejected"} by {submission.reviewedBy}
          {submission.rejectReason ? ` - ${submission.rejectReason}` : ""}
        </p>
      )}
      {error && <p role="alert" className="text-[12.5px] text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
      {pending && !rejecting && (
        <div className="flex gap-2">
          <button
            type="button" disabled={busy}
            onClick={() => act(() => api.approveSubmission(submission.id))}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-[12.5px] font-bold"
          >
            <span className="material-symbols-outlined text-[16px]">check</span>Approve
          </button>
          <button
            type="button" disabled={busy} onClick={() => setRejecting(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white border border-danger-200 text-danger-700 text-[12.5px] font-bold hover:bg-danger-50"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>Reject
          </button>
        </div>
      )}
      {pending && rejecting && (
        <div className="space-y-2">
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required)"
            className="w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] outline-none focus:border-brand-700 focus:bg-white"
          />
          <div className="flex gap-2">
            <button
              type="button" disabled={busy || !reason.trim()}
              onClick={() => act(() => api.rejectSubmission(submission.id, reason.trim()))}
              className="px-3.5 py-1.5 rounded-xl bg-danger-600 disabled:opacity-50 text-white text-[12.5px] font-bold"
            >
              Confirm rejection
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="px-3.5 py-1.5 rounded-xl text-[12.5px] font-semibold text-warmstone-600 hover:bg-warmstone-100">
              Cancel
            </button>
          </div>
          <p className="text-[11.5px] text-warmstone-500">Rejection is final - the submitter can't resubmit. You can correct the receipt directly afterwards.</p>
        </div>
      )}
    </div>
  );
}
