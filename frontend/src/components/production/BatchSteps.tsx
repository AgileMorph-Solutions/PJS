import { useState } from "react";
import { RcnReceiptStatusPill } from "./batchUi";
import { Button } from "../ui/Button";
import { Card, CardTitle } from "../ui/Card";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { RcnReceiptForm } from "./RcnReceiptForm";
import { MoistureCard } from "./MoistureCard";
import { WeighingCard } from "./WeighingCard";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import { canWeigh, isIntakeDone, type RcnReceiptStatus } from "@anagroci/contract/domain/rcnReceipt";
import type { BatchDetail } from "@anagroci/contract/types/productionBatch";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

export interface StepPermissions {
  /** Record a load (Admin / Warehouse Incharge for now; Data Entry later). */
  canReceive: boolean;
  /** Take a moisture check (the QFS Officer, or the Incharge / Admin directly). */
  canEnterMoisture: boolean;
  /** Approve or reject a submitted check, and enter directly without approval. */
  canReview: boolean;
}

/** What opening a row lets this person do, so the row says it instead of a bare "Open". */
function actionLabel(status: RcnReceiptStatus, can: StepPermissions): string {
  if (status === "waiting_for_moisture" && can.canEnterMoisture) return "Enter moisture";
  if (status === "moisture_pending" && can.canReview) return "Review moisture";
  if (status === "on_hold" && can.canEnterMoisture) return "Re-check moisture";
  if (canWeigh(status) && can.canReceive) return "Weigh pallets";
  return "View";
}

/** The receipt's current step, opened in place: moisture while it's due, then the weighing. */
function ReceiptWork({ receipt, can, onChanged }: { receipt: RcnReceipt; can: StepPermissions; onChanged: () => void }) {
  const ok = receipt.moistureChecks.filter((c) => c.status === "approved").at(-1);
  const pastMoisture = canWeigh(receipt.status) || isIntakeDone(receipt.status);

  if (!pastMoisture || !ok) {
    return (
      <>
        <h4 className="text-[13px] font-bold text-warmstone-900 mb-3">Moisture check</h4>
        <MoistureCard receipt={receipt} canEnter={can.canEnterMoisture} canReview={can.canReview} direct={can.canReview} onChanged={onChanged} />
      </>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-[12px] text-warmstone-700 flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[18px] text-success-700">check_circle</span>
        <b>Moisture OK</b> · {ok.moisture} %, nut count {ok.nutCount}{ok.kor !== null ? `, KOR ${ok.kor.toFixed(2)}` : ""} · {ok.submittedBy}
      </p>
      <WeighingCard receipt={receipt} canEdit={can.canReceive} onChanged={onChanged} />
      {receipt.calibration && <p className="text-[12px] text-warmstone-500">This load is weighed. Its next step is in the Calibration phase.</p>}
    </div>
  );
}

/**
 * Intake: the batch's RCN Receipts (one per load / BTM slip) in one table. A receipt's next job, moisture check
 * then weighing, opens in a dialog, so the table never grows rows that open and close inside it.
 */
export function BatchSteps({ batch, receipts, can, onChanged }: { batch: BatchDetail; receipts: RcnReceipt[]; can: StepPermissions; onChanged: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Read from the fresh list each render, so the dialog shows the receipt's new step right after a save.
  const opened = receipts.find((r) => r.id === openId);

  const columns: Column<RcnReceipt>[] = [
    { label: "Receipt", nowrap: true, render: (r) => <b className="font-semibold">{r.id}</b> },
    { label: "Date", nowrap: true, render: (r) => formatDate(r.date) },
    { label: "BTM", nowrap: true, render: (r) => r.btmNo },
    { label: "From bin", nowrap: true, render: (r) => r.binCode },
    { label: "Status", nowrap: true, render: (r) => <RcnReceiptStatusPill status={r.status} /> },
    {
      label: "", align: "right", nowrap: true,
      render: (r) => {
        const action = actionLabel(r.status, can);
        return <Button variant={action === "View" ? "secondary" : "primary"} onClick={() => setOpenId(r.id)}>{action}</Button>;
      },
    },
  ];

  return (
    <Card>
      <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <CardTitle>RCN Receipts ({receipts.length})</CardTitle>
          <p className="text-[12px] text-warmstone-500 mt-0.5">One receipt for each load brought from a bin. Each load gets a moisture check, then is weighed. A weighed load moves on to Calibration.</p>
        </div>
        {can.canReceive && <Button icon="add" onClick={() => setAdding(true)}>New RCN Receipt</Button>}
      </div>
      <div className="px-5 pb-5">
        <DataTable
          columns={columns} rows={receipts} keyFn={(r) => r.id} onRowClick={(r) => setOpenId(r.id)}
          emptyTitle="No RCN Receipt yet" emptyHint={can.canReceive ? "Click New RCN Receipt when the first load comes in from a bin." : "The first load has not come in yet."}
        />
      </div>

      {adding && (
        <Modal wide title="New RCN Receipt" onClose={() => setAdding(false)}>
          <RcnReceiptForm batch={batch} existing={receipts} onSaved={() => { setAdding(false); onChanged(); }} />
        </Modal>
      )}
      {opened && (
        <Modal wide title={`${opened.id} · BTM ${opened.btmNo}`} onClose={() => setOpenId(null)}>
          <ReceiptWork receipt={opened} can={can} onChanged={onChanged} />
        </Modal>
      )}
    </Card>
  );
}
