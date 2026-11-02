import { Fragment, useState } from "react";
import { BATCH_PHASES, RcnReceiptStatusPill, formatTonnes } from "./batchUi";
import { RcnReceiptForm } from "./RcnReceiptForm";
import { LoadPanel } from "./LoadPanel";
import { StepCard } from "./StepCard";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
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

/**
 * The batch's work in the doc's order: 0 · the batch (done), 1 · record each load, then every load with its
 * own steps (2 · moisture, 3–4 · weighing), opened in place. The phases after Intake are listed, not built.
 */
export function BatchSteps({ batch, receipts, can, onChanged }: { batch: BatchDetail; receipts: RcnReceipt[]; can: StepPermissions; onChanged: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-4 max-w-5xl">
      <StepCard num={0} title="Batch" sub="The plan: which warehouse bins this batch will use" state="done">
        <p className="text-[13px] text-warmstone-700">
          Created {formatDate(batch.createdAt)}{batch.createdBy ? ` by ${batch.createdBy}` : ""} with {batch.bins.length} bin{batch.bins.length === 1 ? "" : "s"} ({batch.bins.map((b) => b.binCode).join(", ")}), {formatTonnes(batch.plannedKg)} planned, start {formatDate(batch.startDate)}.
        </p>
      </StepCard>

      {can.canReceive && (
        <StepCard num={1} title="RCN Receipt · record a load" sub="A load arrives on the production floor from one of the batch's bins, with its BTM slip" state="active" open={receipts.length === 0}>
          <RcnReceiptForm batch={batch} existing={receipts} onSaved={onChanged} />
        </StepCard>
      )}

      <section className="bg-white border border-warmstone-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <h3 className="text-[15px] font-bold text-warmstone-900">Loads of this batch</h3>
          <p className="text-[12px] text-warmstone-500 mt-0.5">One row per load. The status says which step it waits for; open a load to do that step.</p>
        </div>
        {receipts.length === 0 ? (
          <p className="px-5 pb-5 text-[12.5px] text-warmstone-500">No loads received yet. The first one puts the batch In process.</p>
        ) : (
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
                        {open ? "Close" : "Open"}
                        <span className="material-symbols-outlined text-[16px] align-middle ml-0.5">{open ? "expand_less" : "expand_more"}</span>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-warmstone-50/70">
                        <td colSpan={6} className="px-5 py-4">
                          <LoadPanel receipt={r} canEnterMoisture={can.canEnterMoisture} canReview={can.canReview} direct={can.canReview} onChanged={onChanged} />
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

      <div className="space-y-2">
        <h3 className="px-1 pt-2 text-[11px] font-bold text-warmstone-400 uppercase tracking-wider">After Intake</h3>
        {BATCH_PHASES.slice(2).map((label) => (
          <StepCard key={label} num="·" title={label} state="later" />
        ))}
      </div>
    </div>
  );
}
