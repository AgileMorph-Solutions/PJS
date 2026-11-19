import { useState } from "react";
import { Button } from "../ui/Button";
import { inputClass } from "../ui/Input";
import { ApiError } from "../../repository/api";

/**
 * The one approve / reject bar of production: a moisture check, a silo check (QC-2), a Lot's checks, and production's
 * acceptance of a load — on their own pages and on the Approvals page alike. Without `onReject` it only approves (a load
 * is accepted; the client hasn't said what refusing one means yet).
 */
export function ReviewBar({ applies, onApprove, onReject, onDone, approveLabel = "Approve this check", rejectLabel = "Reject this check" }: {
  /** What approving does, as the end of "Approving applies it: …". */
  applies: string;
  onApprove: () => Promise<unknown>;
  onReject?: (reason: string) => Promise<unknown>;
  onDone: () => void;
  approveLabel?: string;
  rejectLabel?: string;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(call: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await call();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border-2 border-ambernut-300 bg-ambernut-50 p-4 space-y-3">
      <p className="text-[13px] text-ambernut-900">
        <b>Needs your approval.</b> Approving applies it: {applies}{onReject ? " Rejecting applies nothing." : ""}
      </p>
      {rejecting && (
        <input className={inputClass} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it rejected? (required)" />
      )}
      {error && <p role="alert" className="text-[12px] text-danger-700">{error}</p>}
      <div className="flex flex-wrap gap-2 justify-end">
        {rejecting && onReject ? (
          <>
            <Button variant="secondary" onClick={() => setRejecting(false)} disabled={busy}>Cancel</Button>
            <Button variant="danger" icon="close" disabled={busy || !reason.trim()} onClick={() => run(() => onReject(reason.trim()))}>{rejectLabel}</Button>
          </>
        ) : (
          <>
            {onReject && <Button variant="secondary" onClick={() => setRejecting(true)} disabled={busy}>Reject…</Button>}
            <Button icon="check" disabled={busy} onClick={() => run(onApprove)}>{busy ? "Saving…" : approveLabel}</Button>
          </>
        )}
      </div>
    </div>
  );
}
