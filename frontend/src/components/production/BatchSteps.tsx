import { Fragment, useState } from "react";
import { RcnReceiptStatusPill, primaryButton, secondaryButton } from "./batchUi";
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
      <p className="text-[12.5px] text-warmstone-700 flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[17px] text-success-700">check_circle</span>
        <b>Moisture OK</b> · {ok.moisture} %, nut count {ok.nutCount}{ok.kor !== null ? `, KOR ${ok.kor.toFixed(2)}` : ""} · {ok.submittedBy}
      </p>
      <WeighingCard receipt={receipt} canEdit={can.canReceive} onChanged={onChanged} />
      {receipt.calibration && <p className="text-[12px] text-warmstone-500">This load is weighed. It is sorted into the silos in Calibration, below.</p>}
    </div>
  );
}

/**
 * Intake on one page: the batch's RCN Receipts (one per load / BTM slip), a button to add one, and each
 * receipt's current step opened in place. Batch facts and later phases are in the page header, not here.
 */
export function BatchSteps({ batch, receipts, can, onChanged }: { batch: BatchDetail; receipts: RcnReceipt[]; can: StepPermissions; onChanged: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(receipts.length === 0);

  return (
    <section className="max-w-5xl bg-white border border-warmstone-200 rounded-2xl shadow-xs overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-[15px] font-bold text-warmstone-900">RCN Receipts ({receipts.length})</h3>
          <p className="text-[12px] text-warmstone-500 mt-0.5">One receipt for each load brought from a bin. Click a receipt to do its next step: moisture check, then weighing. Once weighed, it moves to Calibration below.</p>
        </div>
        {can.canReceive && !adding && (
          <button type="button" className={primaryButton} onClick={() => setAdding(true)}>
            <span className="material-symbols-outlined text-[18px]">add</span>New RCN Receipt
          </button>
        )}
      </div>

      {can.canReceive && adding && (
        <div className="mx-5 mb-5 rounded-2xl border border-warmstone-200 bg-warmstone-50/60 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h4 className="text-[13.5px] font-bold text-warmstone-900">New RCN Receipt</h4>
            {receipts.length > 0 && <button type="button" className={secondaryButton} onClick={() => setAdding(false)}>Cancel</button>}
          </div>
          <RcnReceiptForm
            batch={batch}
            existing={receipts}
            onSaved={() => {
              setAdding(false);
              onChanged();
            }}
          />
        </div>
      )}

      {receipts.length > 0 && (
        <table className="w-full text-[12.5px]">
          <thead className="bg-warmstone-50 text-[10.5px] uppercase tracking-wide text-warmstone-500">
            <tr>
              <th className="text-left font-bold px-5 py-2">Receipt</th>
              <th className="text-left font-bold px-3 py-2">Date</th>
              <th className="text-left font-bold px-3 py-2">BTM</th>
              <th className="text-left font-bold px-3 py-2">From bin</th>
              <th className="text-left font-bold px-3 py-2">Status</th>
              <th className="px-5 py-2" />
            </tr>
          </thead>
          <tbody>
            {receipts.map((r) => {
              const open = openId === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className={`border-t border-warmstone-100 cursor-pointer ${open ? "bg-brand-50/50" : "hover:bg-warmstone-50"}`} onClick={() => setOpenId(open ? null : r.id)}>
                    <td className="px-5 py-2.5 font-mono font-semibold">{r.id}</td>
                    <td className="px-3 py-2.5">{formatDate(r.date)}</td>
                    <td className="px-3 py-2.5 font-mono">{r.btmNo}</td>
                    <td className="px-3 py-2.5 font-mono">{r.binCode}</td>
                    <td className="px-3 py-2.5"><RcnReceiptStatusPill status={r.status} /></td>
                    <td className="px-5 py-2.5 text-right text-brand-700 font-semibold whitespace-nowrap">
                      {open ? "Close" : actionLabel(r.status, can)}
                      <span className="material-symbols-outlined text-[16px] align-middle ml-0.5">{open ? "expand_less" : "expand_more"}</span>
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-warmstone-50/70">
                      <td colSpan={6} className="px-5 py-4">
                        <ReceiptWork receipt={r} can={can} onChanged={onChanged} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
