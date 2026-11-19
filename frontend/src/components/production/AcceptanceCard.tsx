import { api } from "../../repository/api";
import { formatKg } from "./batchUi";
import { ReviewBar } from "./ReviewBar";
import { acceptApplies } from "./loadSteps";
import { acceptanceProblem } from "@anagroci/contract/domain/rcnReceipt";
import { weighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import { formatDateTime } from "@anagroci/contract/domain/dateFormat";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

/**
 * The last step of a load: production accepts what the warehouse recorded (Lokesh, 16 Nov 2026: "Warehouse page, they
 * will update the details of quantity and quality. Then operations will accept"). It shows what is being accepted —
 * the warehouse's net out of its bin, what goes into the silos, the approved moisture — so the Production Incharge
 * reads the figures before taking them. Nothing is copied: the bin's stock and the silos are worked out from it.
 */
export function AcceptanceCard({ receipt, canAccept, onChanged }: { receipt: RcnReceipt; canAccept: boolean; onChanged: () => void }) {
  const t = weighingTotals(receipt.pallets, receipt.finalWeight ?? { emptyPallets: [] });
  const moisture = receipt.moistureChecks.filter((c) => c.status === "approved").at(-1);
  const problem = acceptanceProblem(receipt.status);

  const figures: [string, string][] = [
    ["Out of warehouse bin", receipt.finalWeight ? `${formatKg(t.netKg)} from ${receipt.binCode}` : "-"],
    ["Into the silos", receipt.finalWeight ? `${formatKg(t.toSilosKg)} (dust ${formatKg(t.dustKg)} · voids ${formatKg(t.voidsKg)})` : "-"],
    ["Pallets · bags", `${t.pallets} · ${t.bags.toLocaleString("en-US")}`],
    ["Moisture", moisture ? `${moisture.moisture} % · nut count ${moisture.nutCount}` : "-"],
  ];

  return (
    <div className="space-y-4">
      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
        {figures.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] font-semibold text-warmstone-500">{label}</dt>
            <dd className="text-[13px] font-medium text-warmstone-900 tabular-nums mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>

      {receipt.acceptance ? (
        <p className="rounded-xl border border-success-200 bg-success-50 text-success-800 px-4 py-3 text-[12px]">
          {receipt.acceptance.acceptedBy
            ? <>Accepted by <b>{receipt.acceptance.acceptedBy}</b> on {formatDateTime(receipt.acceptance.acceptedAt)}.</>
            : <>In the silos since {formatDateTime(receipt.acceptance.acceptedAt)}, from before production accepted loads in the app.</>}
          {" "}Its weighing and quality can no longer change; an Admin can correct them.
        </p>
      ) : problem ? (
        <p className="text-[13px] text-warmstone-500">Not ready for production yet. {problem}</p>
      ) : canAccept ? (
        <ReviewBar
          applies={acceptApplies(receipt)}
          approveLabel="Accept this load"
          onApprove={() => api.acceptRcnReceipt(receipt.id)}
          onDone={onChanged}
        />
      ) : (
        <p className="rounded-xl border border-ambernut-200 bg-ambernut-50 text-ambernut-900 px-4 py-3 text-[12px]">Weighed and checked. Waiting for the Production Incharge to accept it.</p>
      )}
    </div>
  );
}
