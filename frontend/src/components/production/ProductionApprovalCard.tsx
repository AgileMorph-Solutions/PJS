import { Link } from "react-router-dom";
import { Card } from "../ui/Card";
import { Pill } from "../ui/Pill";
import { ReviewBar } from "./ReviewBar";
import { acceptApplies } from "./loadSteps";
import { api } from "../../repository/api";
import { formatDateTime } from "@anagroci/contract/domain/dateFormat";
import { PRODUCTION_APPROVAL_LABELS, type ProductionApproval } from "@anagroci/contract/domain/productionApprovals";

/**
 * One production item on the Approvals page: what it is, where it comes from, and the same approve / reject bar its own
 * page shows (ReviewBar), calling the same routes. A load is accepted, not approved: it has no reject (the client hasn't
 * said what refusing one means yet), so a disagreement goes to the load's page and an Admin.
 */
export function ProductionApprovalCard({ item, onDone }: { item: ProductionApproval; onDone: () => void }) {
  const run = `/production/runs/${encodeURIComponent(item.runCode)}`;
  const href = item.loadId
    ? `${run}/loads/${encodeURIComponent(item.loadId)}?step=${item.kind === "load_acceptance" ? "acceptance" : "moisture"}`
    : item.kind === "sizing_check" ? `${run}?stage=intake` : run;

  return (
    <Card>
      <div className="px-5 py-4 space-y-3">
        <div className="flex items-start gap-3 flex-wrap">
          <Pill tone="decision" label={PRODUCTION_APPROVAL_LABELS[item.kind]} />
          <div className="min-w-0 flex-1">
            <Link to={href} className="text-[13px] font-bold text-brand-700 hover:text-brand-800">{item.title}</Link>
            <p className="text-[13px] text-warmstone-800 mt-0.5 tabular-nums">{item.detail}</p>
            <p className="text-[12px] text-warmstone-500 mt-0.5">
              Production run <span className="font-mono">{item.runName ? `${item.runCode} (${item.runName})` : item.runCode}</span>
              {item.submittedBy ? ` · from ${item.submittedBy}` : ""} · {formatDateTime(item.at)}
            </p>
          </div>
        </div>
        <Decision item={item} onDone={onDone} />
      </div>
    </Card>
  );
}

function Decision({ item, onDone }: { item: ProductionApproval; onDone: () => void }) {
  const id = item.id;
  switch (item.kind) {
    case "load_acceptance":
      return <ReviewBar applies={acceptApplies({ binCode: item.binCode ?? "its bin" })} approveLabel="Accept this load" onApprove={() => api.acceptRcnReceipt(String(id))} onDone={onDone} />;
    case "moisture_check":
      return <ReviewBar applies="the load's moisture check counts." onApprove={() => api.approveMoistureCheck(Number(id))} onReject={(r) => api.rejectMoistureCheck(Number(id), r)} onDone={onDone} />;
    case "sizing_check":
      return <ReviewBar applies="the silo's check counts." onApprove={() => api.approveSizingCheck(Number(id))} onReject={(r) => api.rejectSizingCheck(Number(id), r)} onDone={onDone} />;
    case "lot_entry":
      return <ReviewBar applies="the check counts on the Lot." onApprove={() => api.approveLotEntry(Number(id))} onReject={(r) => api.rejectLotEntry(Number(id), r)} onDone={onDone} />;
  }
}
