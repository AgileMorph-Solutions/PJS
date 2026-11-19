import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { EmptyState } from "../../components/ui/EmptyState";
import { Pill } from "../../components/ui/Pill";
import { SubmissionReview } from "../../components/SubmissionReview";
import { ProductionApprovalCard } from "../../components/production/ProductionApprovalCard";
import { useTracking } from "../../state/TrackingContext";
import { usePendingApprovals } from "../../state/PendingApprovals";
import { api } from "../../repository/api";
import { siteSlugFor } from "../../config/sites";
import { useSites } from "../../state/SiteContext";
import type { SupplierRequestView } from "../../types/user";
import { formatDate } from "@anagroci/contract/domain/dateFormat";

/** Everything waiting for this person's decision, each step sent up to the role above it: in production, the warehouse's
 * weighed loads and the QFS Officer's checks; in procurement, Branch Manager / QFS submissions and supplier requests.
 * Approving applies it (atomically, server-side); nothing here has touched a record before that. The rows come from
 * PendingApprovalsProvider — the same copy the sidebar badge counts. */
export function ApprovalsPage() {
  const { reviews, production, refresh } = usePendingApprovals();

  return (
    <div className="space-y-6">
      <PageHeader kicker="Approvals" title="Waiting for your decision" lede="Nothing here counts until you decide: approving applies it, rejecting closes it for good." />

      {reviews.production && (
        <section className="space-y-3">
          <h2 className="text-[11px] font-bold text-warmstone-500 uppercase tracking-wider px-1">Production · {production.rows.length}</h2>
          {production.rows.length === 0 && <EmptyState title={production.loading ? "Loading…" : "Nothing waiting in production"} />}
          {production.rows.map((item) => <ProductionApprovalCard key={`${item.kind}-${item.id}`} item={item} onDone={refresh} />)}
        </section>
      )}

      {reviews.procurement && <ProcurementApprovals />}
    </div>
  );
}

/** Procurement's two queues: Branch Manager / QFS submissions on a truck, and requests for a new supplier. */
function ProcurementApprovals() {
  const { receipts, masters } = useTracking();
  const sites = useSites();
  const { submissions: pending, supplierRequests: requests } = usePendingApprovals();

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-[11px] font-bold text-warmstone-400 uppercase tracking-wider px-1">Form submissions · {pending.rows.length}</h2>
        {pending.rows.length === 0 && <EmptyState title={pending.loading ? "Loading…" : "No submissions waiting"} />}
        {pending.rows.map((s) => {
          const receipt = receipts.find((r) => r.id === s.receiptId);
          const slug = siteSlugFor(sites, masters, s.warehouse);
          return (
            <div key={s.id} className="bg-white border border-warmstone-200 rounded-2xl shadow-xs p-5 space-y-3">
              <Link to={`/${slug}/receipts/${s.receiptId}`} className="text-[13px] font-bold text-brand-700 hover:text-brand-800">
                {receipt?.lotNo ? `Lot ${receipt.lotNo} · ` : ""}{s.receiptId}
              </Link>
              <SubmissionReview submission={s} receipt={receipt} />
            </div>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] font-bold text-warmstone-400 uppercase tracking-wider px-1">Supplier requests · {requests.rows.length}</h2>
        {requests.rows.length === 0 && <EmptyState title={requests.loading ? "Loading…" : "No supplier requests waiting"} />}
        {requests.rows.map((r) => <SupplierRequestRow key={r.id} request={r} />)}
      </section>
    </>
  );
}

function SupplierRequestRow({ request }: { request: SupplierRequestView }) {
  const { refresh } = useTracking();
  const { refresh: refreshPending } = usePendingApprovals();
  const [code, setCode] = useState(request.code ?? "");
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); await refresh(); refreshPending(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
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
