import { useState } from "react";
import { Link } from "react-router-dom";
import type { DeliveryPlan, ReceiptPlanInfo } from "../../types/receipt";
import { api } from "../../repository/api";
import { InfoCard, InfoRow } from "../ui/InfoCard";
import { APPROVAL, LINK_STATUS, PlanFlagList, RECEPTION_TYPE } from "./PlanBadges";
import { Pill } from "../ui/Pill";
import { normalizeSupplierName } from "@anagroci/contract/domain/supplierCode";
import { formatDate } from "@anagroci/contract/domain/dateFormat";

const inputClass =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-warmstone-50 text-[13px] text-warmstone-900 outline-none focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-700";

/**
 * Where this truck stands against its Delivery Plan: planned, planned with an exception, or
 * unplanned — and the two things a person can do about it: approve an exception (a recorded
 * decision; the truck is never held up by it) or attach a plan to a truck that arrived without one.
 * Everything shown is derived on the server (services/receiptPlanInfo.ts); this only displays it.
 */
export function ReceiptPlanCard({
  receiptId, info, plans, siteSlug, canEdit, onChanged,
}: {
  receiptId: string;
  info: ReceiptPlanInfo | undefined;
  /** Plans at this warehouse, offered when the truck has none. */
  plans: DeliveryPlan[];
  siteSlug: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [note, setNote] = useState("");
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!info) return null;
  const type = RECEPTION_TYPE[info.type];
  const approval = APPROVAL[info.approval];
  // Plans still taking trucks: not cancelled, not already fully delivered.
  const open = plans.filter((p) => p.status === "planned" || p.status === "partially_received");

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await action(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <InfoCard icon="event_available" title="Delivery plan" badge={<Pill tone={type.tone} label={type.label} />}
      footer={error ? <p role="alert" className="text-[12.5px] text-danger-700">{error}</p> : undefined}>
      <InfoRow
        label="Plan"
        value={info.deliveryPlanId ? <Link to={`/${siteSlug}/delivery-plans`} className="font-mono text-brand-700 hover:text-brand-800">{info.deliveryPlanId}</Link> : "Arrived without a plan"}
      />
      <InfoRow label="How it was linked" value={LINK_STATUS[info.planLinkStatus]} />
      <InfoRow label="Exception approval" value={<Pill tone={approval.tone} label={approval.label} />} />
      {info.approvedAt && (
        // An approval carried in from the client's workbook has no approver or date of its own — say so rather than show a dash.
        <InfoRow label="Approved by" value={info.approvedBy ? `${info.approvedBy} · ${formatDate(info.approvedAt)}` : `Approver not recorded · applied ${formatDate(info.approvedAt)}`} />
      )}
      {info.approvalNote && <InfoRow label="Note" value={info.approvalNote} />}
      {info.flags.length > 0 && <div className="pt-1"><PlanFlagList flags={info.flags} /></div>}

      {canEdit && info.approval === "pending" && (
        <div className="pt-3 space-y-2">
          <label htmlFor="exc-note" className="block text-[12.5px] font-semibold text-warmstone-700">Why this arrival is accepted (optional)</label>
          <input id="exc-note" value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
          <button type="button" disabled={busy} onClick={() => void run(() => api.approveReceiptException(receiptId, note))}
            className="px-3.5 py-1.5 rounded-xl bg-brand-700 hover:bg-brand-800 text-white text-[12.5px] font-bold disabled:opacity-50">
            Approve exception
          </button>
        </div>
      )}

      {canEdit && !info.deliveryPlanId && open.length > 0 && (
        <div className="pt-3 space-y-2">
          <label htmlFor="link-plan" className="block text-[12.5px] font-semibold text-warmstone-700">Link to a delivery plan</label>
          <select id="link-plan" value={pick} onChange={(e) => setPick(e.target.value)} className={inputClass}>
            <option value="">Choose a plan…</option>
            {open.map((p) => <option key={p.id} value={p.id}>{p.id} · {normalizeSupplierName(p.supplierName)}</option>)}
          </select>
          <button type="button" disabled={busy || !pick} onClick={() => void run(() => api.linkReceiptToPlan(receiptId, pick))}
            className="px-3.5 py-1.5 rounded-xl bg-white border border-warmstone-200 text-warmstone-800 text-[12.5px] font-bold hover:bg-warmstone-50 disabled:opacity-50">
            Link truck to plan
          </button>
        </div>
      )}
    </InfoCard>
  );
}
