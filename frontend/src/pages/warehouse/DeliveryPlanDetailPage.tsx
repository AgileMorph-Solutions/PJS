import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PLAN_STATUS_LABELS, type PlanStatus } from "@anagroci/contract/domain/deliveryPlan";
import { PageHeader } from "../../components/ui/PageHeader";
import { KpiTile } from "../../components/ui/KpiTile";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { Pill } from "../../components/ui/Pill";
import { ReceiptStatusPill } from "../../components/ReceiptStatusPill";
import { APPROVAL, PlanFlagList, RECEPTION_TYPE } from "../../components/receipt/PlanBadges";
import { useSite } from "../../state/SiteContext";
import { api } from "../../repository/api";
import type { DeliveryPlanDetail, DeliveryPlanTruck } from "../../types/receipt";
import { normalizeSupplierName } from "@anagroci/contract/domain/supplierCode";

const STATUS_TONE: Record<PlanStatus, string> = { planned: "decision", partially_received: "term", delivered: "entry", cancelled: "gap" };
const kg = (n: number | null) => (n === null ? "-" : n.toLocaleString());
const signed = (n: number | null) => (n === null ? "-" : `${n > 0 ? "+" : ""}${n.toLocaleString()}`);

/**
 * One plan and every truck recorded against it: which arrived, which were accepted or rejected (and
 * why), and what each added to stock. The numbers come from the same derivation as the plans table
 * (contract domain/deliveryPlan.ts), so this page and the list can never disagree.
 */
export function DeliveryPlanDetailPage() {
  const { id = "" } = useParams();
  const site = useSite();
  const [plan, setPlan] = useState<DeliveryPlanDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPlan(null);
    setError(null);
    api.getDeliveryPlan(id).then(setPlan).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (error) return <p className="text-sm text-danger-700">{error}</p>;
  if (!plan) return <p className="text-sm text-warmstone-500">Loading…</p>;

  const { progress: p } = plan;
  const columns: Column<DeliveryPlanTruck>[] = [
    { label: "Receipt", nowrap: true, render: (t) => <Link to={`/${site.slug}/receipts/${t.receiptId}`} className="font-mono text-[12.5px] font-semibold text-brand-700 hover:text-brand-800">{t.receiptId}</Link> },
    { label: "Arrived", nowrap: true, render: (t) => t.arrivalDate },
    { label: "Truck", nowrap: true, render: (t) => t.vehicleNo || "-" },
    { label: "Outcome", render: (t) => (
      <span className="inline-flex flex-col items-start gap-1">
        <ReceiptStatusPill status={t.status} />
        {t.rejected && <span className="text-[11.5px] text-danger-700 whitespace-normal max-w-[16rem]">{t.rejectionReason ?? "No reason recorded"}</span>}
      </span>
    ) },
    { label: "GRN (kg)", nowrap: true, render: (t) => (t.rejected ? "-" : t.grnKg === null ? <span className="text-warmstone-400">awaiting GRN</span> : kg(t.grnKg)) },
    { label: "Lot", nowrap: true, render: (t) => t.lotNo ?? "-" },
    { label: "Against the plan", render: (t) => (
      <span className="inline-flex flex-col items-start gap-1">
        <Pill tone={RECEPTION_TYPE[t.type].tone} label={RECEPTION_TYPE[t.type].label} />
        <PlanFlagList flags={t.flags} />
        {t.approval === "pending" && <span className="text-[10.5px] font-semibold text-ambernut-700">{APPROVAL.pending.label}</span>}
      </span>
    ) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={<Link to={`/${site.slug}/delivery-plans`} className="hover:text-warmstone-700">← Delivery plans</Link>}
        title={plan.id}
        lede={`${normalizeSupplierName(plan.supplierName)}${plan.supplierCode ? ` · ${plan.supplierCode}` : ""} → ${plan.destinationWarehouse}${plan.destinationStore ? ` · ${plan.destinationStore}` : ""}. Expected ${plan.expectedDeliveryEnd ? `${plan.expectedArrivalDate} to ${plan.expectedDeliveryEnd}` : plan.expectedArrivalDate}${plan.expectedOrigin ? ` from ${plan.expectedOrigin}` : ""}.`}
        actions={<span className="inline-flex items-center gap-2"><Pill tone={STATUS_TONE[plan.status]} label={PLAN_STATUS_LABELS[plan.status]} />{plan.overdue && <Pill tone="gap" label="Overdue" />}</span>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Expected (kg)" value={kg(plan.expectedQuantityKg)} />
        <KpiTile label="Received (kg)" value={kg(p.actualKg)} />
        <KpiTile label="Remaining (kg)" value={kg(p.remainingKg)} />
        <KpiTile label="Variance (kg)" value={signed(p.varianceKg)} tone={p.varianceKg !== null && p.varianceKg < 0 ? "gap" : "default"} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={plan.expectedTrucks === null ? "Trucks arrived" : `Trucks arrived (of ${plan.expectedTrucks})`} value={p.arrivals} />
        <KpiTile label="Accepted" value={p.acceptedTrucks} />
        <KpiTile label="Rejected" value={p.rejectedTrucks} tone={p.rejectedTrucks > 0 ? "gap" : "default"} />
        <KpiTile label="Awaiting GRN" value={p.awaitingGrnTrucks} />
      </div>
      {plan.cancelledAt && <p className="text-sm text-danger-700">Cancelled{plan.cancelReason ? `: ${plan.cancelReason}` : ""}</p>}
      {plan.remarks && <p className="text-sm text-warmstone-600">{plan.remarks}</p>}

      <DataTable columns={columns} rows={plan.trucks} keyFn={(t) => t.receiptId} emptyTitle="No truck has arrived against this plan yet" />
    </div>
  );
}
