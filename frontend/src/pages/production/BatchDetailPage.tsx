import { Fragment, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { StatBlock } from "../../components/ui/StatBlock";
import { Pill } from "../../components/ui/Pill";
import { BATCH_PHASES, BUILT_PHASES, BatchPhaseStepper, BatchStatusPill, formatTonnes, useSiteHrefs } from "../../components/production/batchUi";
import { BatchSteps } from "../../components/production/BatchSteps";
import { CalibrationSection } from "../../components/production/CalibrationSection";
import { CookingSection } from "../../components/production/CookingSection";
import { ShellingSection } from "../../components/production/ShellingSection";
import { ColourSortSection } from "../../components/production/ColourSortSection";
import { useBatch, useBatchCalibration, useBatchLots } from "../../state/productionBatches";
import { useRcnReceipts } from "../../state/rcnReceipts";
import { useCanEditDirectly, useHasRole } from "../../state/AuthContext";
import { RCN_RECEIPT_STATUS_LABELS, isIntakeDone, type RcnReceiptStatus } from "@anagroci/contract/domain/rcnReceipt";
import { formatDate, formatDateTime } from "@anagroci/contract/domain/dateFormat";
import type { LotInBin } from "@anagroci/contract/domain/productionBatch";
import type { BatchBinView } from "@anagroci/contract/types/productionBatch";

const LOT_NOTE: Record<LotInBin["state"], string | null> = {
  in_bin: null,
  weight_not_recorded: "no GRN weight",
  split_across_bins: "split over several bins",
  weighed_with_other_lots: "weighed with other Lots on the truck",
};

type Tab = "steps" | "overview" | "history";

/** The doc's "next person" column, for what the batch's loads are waiting on. */
const WAITING_ORDER: RcnReceiptStatus[] = ["waiting_for_moisture", "moisture_pending", "on_hold", "waiting_for_weighing", "weighing", "intake_done", "calibrating"];
const PHASE_TEXT = [
  "Record each load that comes from a warehouse bin, check its moisture, then weigh it.",
  "Sort each weighed load by nut size into the 9 silos, then check that each silo holds the right size.",
  "Steam-cook the nuts size by size to make a Lot, then rest the Lot 24 hours in a cooling silo.",
  "Cut the shells open and record what comes out: kernels, uncut nuts, shell and shell dust.",
  "A camera machine splits the kernels into wholes, pieces, rejection + oil and black rejection. Check the sorter before and after.",
  "dry the kernels in the ovens, trolley by trolley",
  "humidify, peel and grade the kernels",
  "pack, check and dispatch the finished goods",
];
const NEXT_PERSON: Record<RcnReceiptStatus, string> = {
  waiting_for_moisture: "QFS Officer",
  moisture_pending: "Warehouse Incharge",
  on_hold: "QFS Officer, to re-check",
  waiting_for_weighing: "weighing team",
  weighing: "weighing team, to finish",
  intake_done: "calibration team",
  calibrating: "calibration team, to finish",
  calibrated: "nobody, done",
};

/**
 * The batch page, the one place a batch is worked on, like a truck's Reception page. Steps & entry holds every
 * phase, one under the other, read by scrolling down; the stepper only jumps to one. Bins & Lots leads back to
 * procurement: bins → Lots → each Lot's truck (the link the Phase 1 doc asks for). History is what happened when.
 */
export function BatchDetailPage() {
  const { code } = useParams<{ code: string }>();
  const { batch, loading, error, refetch } = useBatch(code);
  const receipts = useRcnReceipts(code, { enabled: Boolean(code) });
  const calibration = useBatchCalibration(code);
  const lots = useBatchLots(code);
  const canEdit = useCanEditDirectly();
  const isQfs = useHasRole("qfs_officer");
  const [tab, setTab] = useState<Tab>("steps");
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [scrollTo, setScrollTo] = useState<number | null>(null);
  // After the render, as coming from another tab has only then put the phase on the page.
  useEffect(() => {
    if (scrollTo === null || tab !== "steps") return;
    // Phases not built yet share one block, the one after the last built phase.
    document.getElementById(`phase-${Math.min(scrollTo, BUILT_PHASES + 1)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setScrollTo(null);
  }, [scrollTo, tab]);
  const goToPhase = (n: number) => {
    setPicked(n);
    setTab("steps");
    setScrollTo(n);
  };

  if (loading) return <div className="p-10 text-warmstone-400 text-sm">Loading…</div>;
  if (!batch) return <div className="p-10 text-warmstone-400 text-sm">{error ?? `Batch "${code}" not found.`}</div>;

  const inBinsKg = batch.bins.reduce((n, b) => n + b.currentKg, 0);
  const loads = receipts.rows.length;
  const waiting = WAITING_ORDER.map((st) => [st, receipts.rows.filter((r) => r.status === st).length] as const).filter(([, n]) => n > 0);
  // A saved receipt changes the batch too (status, history), so both are read again.
  const onChanged = () => void Promise.all([refetch(), receipts.refetch(), calibration.refetch(), lots.refetch()]);
  // Phases overlap (loads keep arriving while earlier ones are sized), so the batch is "at" the furthest one reached.
  const lotList = lots.data?.lots ?? [];
  const phase = lotList.some((l) => l.status === "colour_sorted" || l.entries.some((e) => e.kind === "qc7_before" || e.kind === "qc7_after")) ? 5
    : lotList.some((l) => l.status === "ready" || l.status === "shelled") ? 4 : lotList.length > 0 ? 3 : receipts.rows.some((r) => isIntakeDone(r.status)) ? 2 : 1;
  const shown = picked ?? phase;
  const checksWaiting = (calibration.calibration?.sizingChecks.filter((c) => c.status === "submitted").length ?? 0)
    + lotList.flatMap((l) => l.entries).filter((e) => e.status === "submitted").length;

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
            <span className="text-[11px] font-bold uppercase tracking-wider text-warmstone-500">Current phase · {phase} of {BATCH_PHASES.length}: {BATCH_PHASES[phase - 1]}</span>
            {waiting.length === 0 && checksWaiting === 0 ? (
              <p className="mt-1.5 text-[13px] font-bold text-warmstone-900">{loads === 0 ? "Next: record the first RCN Receipt" : `${loads} load${loads === 1 ? "" : "s"}, nothing waiting`}</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {waiting.map(([st, n]) => (
                  <WaitingLine key={st} n={n} what={RCN_RECEIPT_STATUS_LABELS[st].toLowerCase()} who={NEXT_PERSON[st]} />
                ))}
                {checksWaiting > 0 && (
                  <WaitingLine n={checksWaiting} what={`quality check${checksWaiting === 1 ? "" : "s"} waiting for approval`} who="Warehouse Incharge" />
                )}
              </ul>
            )}
            <button type="button" onClick={() => goToPhase(phase)} className="mt-2 text-[12px] text-brand-700 font-semibold hover:underline">Go to {BATCH_PHASES[phase - 1]}</button>
          </div>
        </div>
        <BatchPhaseStepper current={phase} shown={shown} onShow={goToPhase} />
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
            <span className="material-symbols-outlined text-[18px]">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {tab === "steps" && (
        <div className="space-y-12">
          <PhaseSection n={1} current={phase}>
            <BatchSteps batch={batch} receipts={receipts.rows} can={{ canReceive: canEdit, canEnterMoisture: canEdit || isQfs, canReview: canEdit }} onChanged={onChanged} />
          </PhaseSection>
          <PhaseSection n={2} current={phase}>
            {calibration.calibration ? (
              <CalibrationSection batch={batch} receipts={receipts.rows} calibration={calibration.calibration} can={{ canSize: canEdit, canCheck: canEdit || isQfs, canReview: canEdit }} onChanged={onChanged} onGoToCooking={() => goToPhase(3)} />
            ) : (
              <p className="text-[13px] text-warmstone-500">{calibration.error ?? "Loading…"}</p>
            )}
          </PhaseSection>
          <PhaseSection n={3} current={phase}>
            {lots.data && calibration.calibration ? (
              <CookingSection batchCode={batch.code} data={lots.data} calibration={calibration.calibration} can={{ canFloor: canEdit, canCheck: canEdit || isQfs, canReview: canEdit }} onChanged={onChanged} onGoToShelling={() => goToPhase(4)} />
            ) : (
              <p className="text-[13px] text-warmstone-500">{lots.error ?? calibration.error ?? "Loading…"}</p>
            )}
          </PhaseSection>
          <PhaseSection n={4} current={phase}>
            {lots.data ? (
              <ShellingSection data={lots.data} can={{ canFloor: canEdit, canCheck: canEdit || isQfs, canReview: canEdit }} onChanged={onChanged} />
            ) : (
              <p className="text-[13px] text-warmstone-500">{lots.error ?? "Loading…"}</p>
            )}
          </PhaseSection>
          <PhaseSection n={5} current={phase}>
            {lots.data ? (
              <ColourSortSection data={lots.data} can={{ canFloor: canEdit, canCheck: canEdit || isQfs, canReview: canEdit }} onChanged={onChanged} />
            ) : (
              <p className="text-[13px] text-warmstone-500">{lots.error ?? "Loading…"}</p>
            )}
          </PhaseSection>
          {/* One block for every phase still to come, so the page doesn't end in a row of empty headings. */}
          <section id={`phase-${BUILT_PHASES + 1}`} className="scroll-mt-24 rounded-2xl border border-dashed border-warmstone-300 bg-warmstone-50/60 px-5 py-4">
            <h2 className="text-[15px] font-bold text-warmstone-900">Coming later</h2>
            <p className="text-[13px] text-warmstone-500 mt-1">
              {BATCH_PHASES.slice(BUILT_PHASES).map((name, i) => `Phase ${BUILT_PHASES + 1 + i} · ${name}`).join(", ")}. These phases are not built in the app yet.
            </p>
          </section>
        </div>
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
        <section className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
          <ol className="space-y-2.5">
            {batch.history.map((h, i) => (
              <li key={i} className="text-[12px] flex gap-3">
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

function WaitingLine({ n, what, who }: { n: number; what: string; who: string }) {
  return (
    <li className="text-[13px] text-warmstone-900 flex items-start gap-2">
      <span className="material-symbols-outlined text-[16px] text-brand-700 mt-0.5">arrow_forward</span>
      <span><b>{n}</b> {what} <span className="text-warmstone-500 text-[12px]">· {who}</span></span>
    </li>
  );
}

/** One phase of the batch: a clear numbered heading, what happens in it, then its work. */
function PhaseSection({ n, current, children }: { n: number; current: number; children: ReactNode }) {
  const done = n < current;
  return (
    // The scroll margin keeps the heading clear of the page's fixed top bar.
    <section id={`phase-${n}`} className="scroll-mt-24 space-y-4">
      <div className="flex items-start gap-3 border-b border-warmstone-200 pb-3">
        <span className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-[15px] font-bold ${done ? "bg-success-100 text-success-700 border border-success-200" : n === current ? "bg-brand-700 text-white" : "bg-warmstone-100 text-warmstone-500"}`}>
          {done ? <span className="material-symbols-outlined text-[20px]">check</span> : n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-bold text-warmstone-900">Phase {n} · {BATCH_PHASES[n - 1]}</h2>
            {n === current && <Pill tone="term" label="Current phase" />}
          </div>
          <p className="text-[12px] text-warmstone-500 mt-0.5">{PHASE_TEXT[n - 1]}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function LotRows({ bin, warehouse }: { bin: BatchBinView; warehouse: string }) {
  const { receiptHref, transferHref } = useSiteHrefs();
  if (bin.lots.length === 0) {
    return (
      <tr className="bg-warmstone-50/60">
        <td colSpan={4} className="px-10 py-3 text-[12px] text-warmstone-500">No completed Lots are in this bin now.</td>
      </tr>
    );
  }
  return (
    <tr className="bg-warmstone-50/60">
      <td colSpan={4} className="px-10 py-3">
        <table className="w-full text-[12px]">
          <thead className="text-[11px] uppercase tracking-wide text-warmstone-500">
            <tr>
              <th className="text-left font-bold py-1">Lot</th>
              <th className="text-left font-bold py-1">Supplier</th>
              <th className="text-left font-bold py-1">Arrived</th>
              <th className="text-right font-bold py-1">GRN kg</th>
            </tr>
          </thead>
          <tbody>
            {bin.lots.map((l) => (
              <tr key={`${l.receiptId}-${l.transferId ?? ""}`} className="border-t border-warmstone-100">
                <td className="py-1.5 font-mono">
                  {/* A Lot that came on a BKT has its receipt at the sending site; the BKT is what this site can open. */}
                  <Link to={l.transferId ? transferHref(warehouse, l.transferId) : receiptHref(warehouse, l.receiptId)} className="text-brand-700 hover:underline">{l.lotNo || l.receiptId}</Link>
                  {l.dried && <span className="ml-2"><Pill tone="system" label="dried" /></span>}
                  {l.transferId && <span className="ml-2"><Pill tone="system" label={`via ${l.transferId}`} /></span>}
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
