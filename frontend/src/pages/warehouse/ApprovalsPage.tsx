import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { EmptyState } from "../../components/ui/EmptyState";
import { Pill } from "../../components/ui/Pill";
import { SubmissionReview } from "../../components/SubmissionReview";
import { useTracking } from "../../state/TrackingContext";
import { useSubmissions, useSupplierRequests } from "../../state/userManagement";
import { usePendingApprovals } from "../../state/PendingApprovals";
import { api } from "../../repository/api";
import { siteSlugForSiteName } from "../../config/sites";
import type { SupplierRequestView } from "../../types/user";
import { formatDate } from "@anagroci/contract/domain/dateFormat";

/** Warehouse Incharge's queue: Branch Manager / QFS submissions and supplier requests waiting on a
 * decision. Approving a submission applies its values to the receipt (atomically, server-side). */
export function ApprovalsPage() {
  const { receipts } = useTracking();
  const pending = useSubmissions({ status: "submitted" });
  const requests = useSupplierRequests("pending");

  return (
    <div className="space-y-6">
      <PageHeader kicker="Approvals" title="Waiting for your decision" lede="Nothing here has touched the receipts yet - approving applies it, rejecting closes it for good." />

      <section className="space-y-3">
        <h2 className="text-[11px] font-bold text-warmstone-400 uppercase tracking-wider px-1">Form submissions · {pending.rows.length}</h2>
        {pending.rows.length === 0 && <EmptyState title={pending.loading ? "Loading…" : "No submissions waiting"} />}
        {pending.rows.map((s) => {
          const receipt = receipts.find((r) => r.id === s.receiptId);
          const slug = siteSlugForSiteName(s.warehouse) ?? "unit";
          return (
            <div key={s.id} className="bg-white border border-warmstone-200 rounded-2xl shadow-xs p-5 space-y-3">
              <Link to={`/${slug}/receipts/${s.receiptId}`} className="text-[13px] font-bold text-brand-700 hover:text-brand-800">
                {receipt?.lotNo ? `Lot ${receipt.lotNo} · ` : ""}{s.receiptId}
              </Link>
              <SubmissionReview submission={s} receipt={receipt} onDone={() => void pending.refetch()} />
            </div>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] font-bold text-warmstone-400 uppercase tracking-wider px-1">Supplier requests · {requests.rows.length}</h2>
        {requests.rows.length === 0 && <EmptyState title={requests.loading ? "Loading…" : "No supplier requests waiting"} />}
        {requests.rows.map((r) => <SupplierRequestRow key={r.id} request={r} onDone={() => void requests.refetch()} />)}
      </section>
    </div>
  );
}

function SupplierRequestRow({ request, onDone }: { request: SupplierRequestView; onDone: () => void }) {
  const { refresh } = useTracking();
  const { refresh: refreshPending } = usePendingApprovals();
  const [code, setCode] = useState(request.code ?? "");
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); await refresh(); refreshPending(); onDone(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="bg-white border border-warmstone-200 rounded-2xl shadow-xs p-5 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-semibold text-warmstone-900 text-[14px]">{request.name}</span>
        <Pill tone="decision" label="Add supplier" />
        <span className="text-[12.5px] text-warmstone-500 ml-auto">{request.requestedBy} · {formatDate(request.createdAt)}</span>
      </div>
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label htmlFor={`req-code-${request.id}`} className="block text-[12px] font-semibold text-warmstone-700 mb-1">LBA code</label>
          <input id={`req-code-${request.id}`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="LBA-0XX-ABC"
            className="px-3 py-1.5 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] outline-none focus:border-brand-700" />
        </div>
        {!rejecting && (
          <>
            <button type="button" disabled={!code.trim()} onClick={() => act(() => api.approveSupplierRequest(request.id, code.trim()))}
              className="px-3.5 py-1.5 rounded-xl bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-[12.5px] font-bold">Approve & assign</button>
            <button type="button" onClick={() => setRejecting(true)}
              className="px-3.5 py-1.5 rounded-xl bg-white border border-danger-200 text-danger-700 text-[12.5px] font-bold">Reject</button>
          </>
        )}
        {rejecting && (
          <>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)"
              className="px-3 py-1.5 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] outline-none focus:border-brand-700" />
            <button type="button" disabled={!reason.trim()} onClick={() => act(() => api.rejectSupplierRequest(request.id, reason.trim()))}
              className="px-3.5 py-1.5 rounded-xl bg-danger-600 disabled:opacity-50 text-white text-[12.5px] font-bold">Confirm rejection</button>
            <button type="button" onClick={() => setRejecting(false)} className="text-[12.5px] font-semibold text-warmstone-600">Cancel</button>
          </>
        )}
      </div>
      {error && <p role="alert" className="text-[12.5px] text-danger-700 bg-danger-100 rounded-lg px-3 py-2">{error}</p>}
    </div>
  );
}
