import { Fragment, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { StatBlock } from "../../components/ui/StatBlock";
import { Pill } from "../../components/ui/Pill";
import { BatchPhaseStepper, BatchStatusPill, formatTonnes, receiptHref } from "../../components/production/batchUi";
import { BatchSteps } from "../../components/production/BatchSteps";
import { useBatch } from "../../state/productionBatches";
import { useRcnReceipts } from "../../state/rcnReceipts";
import { useCanEditDirectly, useHasRole } from "../../state/AuthContext";
import { RCN_RECEIPT_STATUS_LABELS, type RcnReceiptStatus } from "@anagroci/contract/domain/rcnReceipt";
import { formatDate, formatDateTime } from "@anagroci/contract/domain/dateFormat";
import type { LotInBin } from "@anagroci/contract/domain/productionBatch";
import type { BatchBinView } from "@anagroci/contract/types/productionBatch";

const LOT_NOTE: Record<LotInBin["state"], string | null> = {
  in_bin: null,
  weight_not_recorded: "no GRN weight",
  split_across_bins: "split over several bins",
};

type Tab = "steps" | "overview" | "history";

/** The doc's "next person" column, for what the batch's loads are waiting on. */
const WAITING_ORDER: RcnReceiptStatus[] = ["waiting_for_moisture", "moisture_pending", "on_hold", "waiting_for_weighing"];
const NEXT_PERSON: Record<RcnReceiptStatus, string> = {
  waiting_for_moisture: "QFS Officer",
  moisture_pending: "Warehouse Incharge",
  on_hold: "QFS Officer, to re-check",
  waiting_for_weighing: "weighing (not built yet)",
};

/**
 * The batch page, the one place a batch is worked on, like a truck's Reception page. Steps & entry holds
 * each phase's form (today: Intake's RCN Receipt). Bins & Lots leads back to procurement: bins → Lots →
 * each Lot's truck (the link the Phase 1 doc asks for). History is what happened when.
 */
export function BatchDetailPage() {
  const { code } = useParams<{ code: string }>();
  const { batch, loading, error, refetch } = useBatch(code);
  const receipts = useRcnReceipts(code, { enabled: Boolean(code) });
  const canEdit = useCanEditDirectly();
  const isQfs = useHasRole("qfs_officer");
  const [tab, setTab] = useState<Tab>("steps");
  const [open, setOpen] = useState<string | null>(null);

  if (loading) return <div className="p-10 text-warmstone-400 text-sm">Loading…</div>;
  if (!batch) return <div className="p-10 text-warmstone-400 text-sm">{error ?? `Batch "${code}" not found.`}</div>;

  const inBinsKg = batch.bins.reduce((n, b) => n + b.currentKg, 0);
  const loads = receipts.rows.length;
  const waiting = WAITING_ORDER.map((st) => [st, receipts.rows.filter((r) => r.status === st).length] as const).filter(([, n]) => n > 0);
  // A saved receipt changes the batch too (status, history), so both are read again.
  const onChanged = () => void Promise.all([refetch(), receipts.refetch()]);

  return (
    <div className="space-y-5">
      <div className="text-[13px] text-warmstone-500">
        <Link to="/production/batches" className="hover:text-brand-700">Batches</Link>
        <span className="mx-1.5">/</span>
        <span className="font-mono">{batch.code}</span>
      </div>

      <section className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div>
            <p className="text-[11px] font-bold text-warmstone-500 uppercase tracking-wider mb-1.5">{batch.warehouse}</p>
            <h1 className="text-2xl font-bold text-warmstone-900 tracking-tight flex items-center gap-3">
              Batch {batch.code} <BatchStatusPill status={batch.status} />
            </h1>
            <p className="text-[13px] text-warmstone-500 mt-1">
              {batch.bins.length} warehouse bin{batch.bins.length === 1 ? "" : "s"} · start {formatDate(batch.startDate)} · created {formatDate(batch.createdAt)}
              {batch.createdBy ? ` by ${batch.createdBy}` : ""}
              {batch.proposedBy ? ` · proposed by ${batch.proposedBy}` : ""}
            </p>
          </div>
          <div className="bg-warmstone-50 border border-warmstone-200 rounded-2xl p-4 w-full lg:w-96">
            <span className="text-xs font-bold uppercase tracking-wider text-warmstone-500">Intake · {loads} load{loads === 1 ? "" : "s"} received</span>
            {waiting.length === 0 ? (
              <p className="mt-1.5 text-sm font-bold text-warmstone-900">{loads === 0 ? "Next: record the first load" : "Nothing waiting"}</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {waiting.map(([st, n]) => (
                  <li key={st} className="text-[13px] text-warmstone-900 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-brand-700">arrow_forward</span>
                    <b>{n}</b> {RCN_RECEIPT_STATUS_LABELS[st].toLowerCase()}
                    <span className="text-warmstone-500 text-[12px]">· {NEXT_PERSON[st]}</span>
                  </li>
                ))}
              </ul>
            )}
            {tab !== "steps" && (
              <button type="button" onClick={() => setTab("steps")} className="mt-2 text-[12px] text-brand-700 font-semibold hover:underline">Go to Steps & entry</button>
            )}
          </div>
        </div>
        <BatchPhaseStepper />
      </section>

      <div className="flex items-center gap-1 border-b border-warmstone-200 overflow-x-auto">
        {([
          ["steps", "Steps & entry", "fact_check"],
          ["overview", "Bins & Lots", "warehouse"],
          ["history", "History", "history"],
        ] as const).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === id ? "border-brand-700 text-brand-700" : "border-transparent text-warmstone-500 hover:text-warmstone-800 hover:border-warmstone-200"
            }`}
          >
            <span className="material-symbols-outlined text-[17px]">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {tab === "steps" && (
        <BatchSteps batch={batch} receipts={receipts.rows} can={{ canReceive: canEdit, canEnterMoisture: canEdit || isQfs, canReview: canEdit }} onChanged={onChanged} />
      )}

      {tab === "overview" && (
        <div className="space-y-5">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatBlock icon="inventory_2" label="Planned" value={formatTonnes(batch.plannedKg)} sub={`≈ ${batch.days} days at 150 t/day`} />
            <StatBlock icon="warehouse" label="Still in warehouse bins" value={formatTonnes(inBinsKg)} sub="Procurement stock in the batch's bins now" />
            <StatBlock icon="receipt_long" label="Lots in its bins" value={String(batch.bins.reduce((n, b) => n + b.lots.length, 0))} sub="Each traces back to its truck" />
            <StatBlock icon="event" label="Estimated end" value={batch.endDate ? formatDate(batch.endDate) : "-"} />
          </div>

          <section className="bg-white border border-warmstone-200 rounded-2xl shadow-xs overflow-hidden">
            <div className="px-5 pt-5 pb-3">
              <h3 className="text-[15px] font-bold text-warmstone-900">Warehouse bins</h3>
              <p className="text-[12px] text-warmstone-500 mt-0.5">Planned is the bin's stock when the batch was made. Open a bin to see its Lots, each linking to its truck.</p>
            </div>
            <table className="w-full text-[13px]">
              <thead className="bg-warmstone-50 text-[11px] uppercase tracking-wide text-warmstone-500">
                <tr>
                  <th className="text-left font-bold px-5 py-2">Bin</th>
                  <th className="text-right font-bold px-3 py-2">Planned</th>
                  <th className="text-right font-bold px-3 py-2">In bin now</th>
                  <th className="text-right font-bold px-5 py-2">Lots</th>
                </tr>
              </thead>
              <tbody>
                {batch.bins.map((b) => (
                  <Fragment key={b.binCode}>
                    <tr className="border-t border-warmstone-100 hover:bg-warmstone-50 cursor-pointer" onClick={() => setOpen(open === b.binCode ? null : b.binCode)}>
                      <td className="px-5 py-2.5 font-mono font-semibold">
                        <span className="material-symbols-outlined text-[16px] align-middle text-warmstone-400 mr-1">{open === b.binCode ? "expand_less" : "expand_more"}</span>
                        <Link to={`/masters/bins/${encodeURIComponent(b.binCode)}`} onClick={(e) => e.stopPropagation()} className="hover:text-brand-700">{b.binCode}</Link>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatTonnes(b.plannedKg)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatTonnes(b.currentKg)}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{b.lots.length}</td>
                    </tr>
                    {open === b.binCode && <LotRows bin={b} warehouse={batch.warehouse} />}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {tab === "history" && (
        <section className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs max-w-4xl">
          <ol className="space-y-2.5">
            {batch.history.map((h, i) => (
              <li key={i} className="text-[12.5px] flex gap-3">
                <span className="text-warmstone-400 tabular-nums whitespace-nowrap">{formatDateTime(h.at)}</span>
                <span className="text-warmstone-800">
                  {h.text}
                  {h.actor && <span className="text-warmstone-500"> · {h.actor}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function LotRows({ bin, warehouse }: { bin: BatchBinView; warehouse: string }) {
  if (bin.lots.length === 0) {
    return (
      <tr className="bg-warmstone-50/60">
        <td colSpan={4} className="px-10 py-3 text-[12.5px] text-warmstone-500">No completed Lots are in this bin now.</td>
      </tr>
    );
  }
  return (
    <tr className="bg-warmstone-50/60">
      <td colSpan={4} className="px-10 py-3">
        <table className="w-full text-[12.5px]">
          <thead className="text-[10.5px] uppercase tracking-wide text-warmstone-500">
            <tr>
              <th className="text-left font-bold py-1">Lot</th>
              <th className="text-left font-bold py-1">Supplier</th>
              <th className="text-left font-bold py-1">Arrived</th>
              <th className="text-right font-bold py-1">GRN kg</th>
            </tr>
          </thead>
          <tbody>
            {bin.lots.map((l) => (
              <tr key={l.receiptId} className="border-t border-warmstone-100">
                <td className="py-1.5 font-mono">
                  <Link to={receiptHref(warehouse, l.receiptId)} className="text-brand-700 hover:underline">{l.lotNo || l.receiptId}</Link>
                  {l.dried && <span className="ml-2"><Pill tone="system" label="dried" /></span>}
                </td>
                <td className="py-1.5">{l.supplierName || "-"}</td>
                <td className="py-1.5">{formatDate(l.arrivalDate)}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {l.kg !== undefined ? l.kg.toLocaleString("en-US") : <span className="text-ambernut-800">{LOT_NOTE[l.state]}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}
