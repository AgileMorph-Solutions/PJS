import { StepCard, type StepState } from "./StepCard";
import { MoistureCard } from "./MoistureCard";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

/**
 * One load opened on its batch's page — the doc's "Receipt page: moisture card, pallet grid, final weight",
 * numbered as the doc numbers a load's steps. Weighing (3–4) is listed, not built.
 */
export function LoadPanel({ receipt, canEnterMoisture, canReview, direct, onChanged }: {
  receipt: RcnReceipt;
  canEnterMoisture: boolean;
  canReview: boolean;
  direct: boolean;
  onChanged: () => void;
}) {
  const moistureState: StepState =
    receipt.status === "waiting_for_weighing" ? "done" : receipt.status === "moisture_pending" ? "waiting" : canEnterMoisture ? "active" : "waiting";

  return (
    <div className="space-y-3">
      <StepCard num={1} title="RCN Receipt" state="done" sub={`BTM ${receipt.btmNo} from ${receipt.binCode} on ${formatDate(receipt.date)}${receipt.createdBy ? ` · ${receipt.createdBy}` : ""}`} />
      <StepCard
        num={2}
        title="Moisture check"
        sub="Is this load dry enough? Sample: moisture, nut count and the cut test; the app calculates KOR"
        state={moistureState}
        open={receipt.status !== "waiting_for_weighing" || undefined}
      >
        <MoistureCard receipt={receipt} canEnter={canEnterMoisture} canReview={canReview} direct={direct} onChanged={onChanged} />
      </StepCard>
      <StepCard num={3} title="Weigh pallets" state="later" />
      <StepCard num={4} title="Final weight" state="later" />
    </div>
  );
}
