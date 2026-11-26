import { Link, useParams, useSearchParams } from "react-router-dom";
import { StatBlock } from "../../components/ui/StatBlock";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { PRODUCTION_PAGE_SIZE, dateCol, kgCol, numCol, textCol } from "../../components/production/columns";
import { Pill } from "../../components/ui/Pill";
import { Card, CardTitle } from "../../components/ui/Card";
import { SheetRef } from "../../components/ui/SheetRef";
import { StepNav, type StepItem, type StepState } from "../../components/ui/StepNav";
import { PRODUCTION_STAGES, BatchStatusPill, formatTonnes, useSiteHrefs, type ProductionStageId } from "../../components/production/batchUi";
import { binQualityColumns, lotQualityColumns } from "../../components/production/binQualityColumns";
import { IntakeStage } from "../../components/production/IntakeStage";
import { CalibrationSection } from "../../components/production/CalibrationSection";
import { CookingSection } from "../../components/production/CookingSection";
import { ShellingSection } from "../../components/production/ShellingSection";
import { ColourSortSection } from "../../components/production/ColourSortSection";
import { useBatch, useBatchCalibration, useBatchLots } from "../../state/productionBatches";
import { useRcnReceipts } from "../../state/rcnReceipts";
import { useProductionPermissions } from "../../state/AuthContext";
import { RCN_RECEIPT_STATUS_LABELS, isIntakeDone, type RcnReceiptStatus } from "@anagroci/contract/domain/rcnReceipt";
import { formatDate, formatDateTime } from "@anagroci/contract/domain/dateFormat";
import type { LotInBin } from "@anagroci/contract/domain/productionBatch";
import type { BatchBinView, BatchDetail } from "@anagroci/contract/types/productionBatch";

const LOT_NOTE: Record<LotInBin["state"], string | null> = {
  in_bin: null,
  weight_not_recorded: "no GRN weight",
  split_across_bins: "split over several bins",
  weighed_with_other_lots: "weighed with other Lots on the truck",
};

/** The doc's "next person" column, for what the run's loads are waiting on. */
const WAITING_ORDER: RcnReceiptStatus[] = ["waiting_for_moisture", "moisture_pending", "on_hold", "waiting_for_weighing", "weighing", "waiting_for_acceptance"];
const NEXT_PERSON: Record<RcnReceiptStatus, string> = {
  waiting_for_moisture: "QFS Officer",
  moisture_pending: "Warehouse Incharge",
  on_hold: "QFS Officer, to re-check",
  waiting_for_weighing: "weighing team",
  weighing: "weighing team, to finish",
  waiting_for_acceptance: "Production Incharge, to accept",
  calibrated: "nobody, done",
};

type View = ProductionStageId | "bins" | "history";
const isView = (v: string | null): v is View => v === "bins" || v === "history" || PRODUCTION_STAGES.some((s) => s.id === v);
/** Calibration was its own stage until Nov 2026; an old link to it opens the stage it is part of now. */
const viewOf = (v: string | null): string | null => (v === "calibration" ? "intake" : v);

/**
 * One production run, worked on stage by stage, laid out like a truck's Reception page: a tab row, then the stages
 * across the top with where each stands, and the picked stage's forms below at full width. Every stage can be opened
 * at any time — the marks say how far the run has got, they lock nothing. Bins & Lots leads back to
 * procurement (bin → Lot → its truck); History is what happened when. The picked stage is in the URL (?stage=), so a
 * link or a refresh lands on the same one.
 */
export function ProductionRunPage() {
  const { code } = useParams<{ code: string }>();
  const { batch: run, loading, error, refetch } = useBatch(code);
  const receipts = useRcnReceipts(code, { enabled: Boolean(code) });
  const perm = useProductionPermissions();
  // The warehouse team sees its loads and nothing after them (18 Nov 2026): the silos and the Lots are never read for it.
  const calibration = useBatchCalibration(code, perm.seeFactory);
  const lots = useBatchLots(code, perm.seeFactory);
  const [params, setParams] = useSearchParams();

  if (loading) return <div className="p-10 text-warmstone-400 text-[13px]">Loading…</div>;
  if (!run) return <div className="p-10 text-warmstone-400 text-[13px]">{error ?? `Production run "${code}" not found.`}</div>;

  const loads = receipts.rows;
  // A saved form changes the run too (status, history), so everything is read again.
  const onChanged = () => void Promise.all([refetch(), receipts.refetch(), calibration.refetch(), lots.refetch()]);
  const lotList = lots.data?.lots ?? [];
  const checksWaiting = calibration.calibration?.sizingChecks.filter((c) => c.status === "submitted").length ?? 0;
  const entriesWaiting = lotList.flatMap((l) => l.entries).filter((e) => e.status === "submitted").length;

  // Stages overlap (loads keep arriving while earlier ones are cooked), so the run is "at" the furthest one reached.
  const reached = lotList.some((l) => l.status === "colour_sorted" || l.entries.some((e) => e.kind === "qc7_before" || e.kind === "qc7_after")) ? 4
    : lotList.some((l) => l.status === "ready" || l.status === "shelled") ? 3 : lotList.length > 0 ? 2 : 1;
  const stateOf = (n: number, built: boolean): StepState => (!built ? "later" : n < reached ? "done" : n === reached ? "current" : "todo");

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const inIntake = loads.filter((r) => !isIntakeDone(r.status)).length;
  const SUB: Record<ProductionStageId, string> = {
    intake: loads.length === 0 ? "No load yet"
      : `${plural(loads.length, "load")}${inIntake ? ` · ${inIntake} in progress` : ""}${checksWaiting ? ` · ${plural(checksWaiting, "silo check")} to approve` : ""}`,
    cooking: lotList.length ? `${plural(lotList.length, "Lot")} cooked` : "No Lot yet",
    shelling: `${lotList.filter((l) => l.status === "shelled" || l.status === "colour_sorted").length} of ${plural(lotList.length, "Lot")} shelled`,
    colour_sort: `${lotList.filter((l) => l.status === "colour_sorted").length} sorted`,
    borma: "Not built yet",
    peeling: "Not built yet",
    packing: "Not built yet",
  };
  // The stages this person sees: the warehouse team only its Intake, the production team every one.
  const shownStages = perm.seeFactory ? PRODUCTION_STAGES : PRODUCTION_STAGES.filter((s) => s.id === "intake");
  const steps: StepItem<ProductionStageId>[] = shownStages.map((s, i) => ({ id: s.id, label: s.label, state: stateOf(i + 1, s.built), sub: SUB[s.id] }));
  const firstStage = perm.seeFactory ? PRODUCTION_STAGES[reached - 1]!.id : "intake";

  const asked = viewOf(params.get("stage"));
  const allowed = (v: View) => v === "bins" || v === "history" || shownStages.some((s) => s.id === v);
  const view: View = isView(asked) && allowed(asked) ? asked : firstStage;
  const show = (v: View) => setParams((p) => { const next = new URLSearchParams(p); next.set("stage", v); return next; }, { replace: true });
  const stage = shownStages.find((s) => s.id === view);

  const waiting = WAITING_ORDER.map((st) => [st, loads.filter((r) => r.status === st).length] as const).filter(([, n]) => n > 0);
  // The warehouse records and weighs the loads; everything from their acceptance on is production's.
  const can = { canFloor: perm.factory, canCheck: perm.factoryCheck, canReview: perm.factory };
  const loadingText = (e: string | null | undefined) => <p className="text-[13px] text-warmstone-500">{e ?? "Loading…"}</p>;

  return (
    <div className="space-y-5">
      <div className="text-[13px] text-warmstone-500">
        <Link to="/production/runs" className="hover:text-brand-700">Production runs</Link>
        <span className="mx-1.5">/</span>
        <span className="font-mono">{run.code}</span>
      </div>

      <Card>
        <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-warmstone-500 mb-1.5">Production run · {run.warehouse}</p>
            <h1 className="text-2xl font-bold tracking-tight text-warmstone-900 flex flex-wrap items-center gap-3">
              <span className="font-mono">{run.code}</span> <BatchStatusPill status={run.status} />
            </h1>
            {run.name && <p className="text-[13px] text-warmstone-700 mt-1">Also known as <span className="font-mono font-semibold">{run.name}</span></p>}
            <p className="text-[13px] text-warmstone-500 mt-1">
              {plural(run.bins.length, "warehouse bin")} ({run.bins.map((b) => b.binCode).join(", ")}) · {formatTonnes(run.plannedKg)} planned · started {formatDate(run.startDate)}
              {run.createdBy ? ` by ${run.createdBy}` : ""}
            </p>
          </div>
          <div className="bg-warmstone-50 border border-warmstone-200 rounded-xl p-4 w-full lg:w-96">
            <p className="text-[11px] font-bold uppercase tracking-wider text-warmstone-500">Waiting now</p>
            {waiting.length === 0 && checksWaiting + entriesWaiting === 0 ? (
              <p className="mt-1.5 text-[13px] font-semibold text-warmstone-900">{loads.length === 0 ? "Record the first load in Intake." : "Nothing is waiting."}</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {waiting.map(([st, n]) => (
                  <WaitingLine key={st} n={n} what={`load${n === 1 ? "" : "s"} ${RCN_RECEIPT_STATUS_LABELS[st].toLowerCase()}`} who={NEXT_PERSON[st]} />
                ))}
                {checksWaiting + entriesWaiting > 0 && (
                  <WaitingLine n={checksWaiting + entriesWaiting} what={`quality check${checksWaiting + entriesWaiting === 1 ? "" : "s"} to approve`} who="Production Incharge" />
                )}
              </ul>
            )}
          </div>
        </div>
      </Card>

      {/* The same tab row as a truck's Reception page; under "Stages & entry" the stages run across the top. */}
      <div className="flex items-center gap-1 border-b border-warmstone-200 overflow-x-auto">
        {([
          ["stages", "Stages & entry", "fact_check"],
          ["bins", "Bins & Lots", "warehouse"],
          ["history", "History", "history"],
        ] as const).map(([id, label, icon]) => {
          const on = id === "stages" ? Boolean(stage) : view === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => show(id === "stages" ? firstStage : id)}
              aria-current={on ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                on ? "border-brand-700 text-brand-700" : "border-transparent text-warmstone-500 hover:text-warmstone-800 hover:border-warmstone-200"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{icon}</span>
              {label}
            </button>
          );
        })}
      </div>

      {stage && (
        <StepNav label="Stages of this production run" layout="horizontal" steps={steps} selected={stage.id} onSelect={show} />
      )}

      <div>
        <section className="min-w-0 space-y-4">
          {stage && (
            <div>
              <h2 className="text-[17px] font-bold text-warmstone-900">{stage.label}</h2>
              <p className="text-[13px] text-warmstone-500 mt-0.5">{stage.text}</p>
              {/* The client's workbooks this stage replaces, named as their files are, so people who know the sheets find their way. */}
              {stage.sheets && <div className="mt-2"><SheetRef sheets={stage.sheets.split(" · ").map((s) => `${s}.xlsx`)} /></div>}
            </div>
          )}

          {view === "intake" && (
            <>
              <IntakeStage run={run} receipts={loads} can={{ canReceive: perm.intake, canEnterMoisture: perm.moistureCheck, canReview: perm.intake, canAccept: perm.factory }} onChanged={onChanged} />
              {/* The silos are the factory's: the production team's to see. */}
              {perm.seeFactory && (
                <div className="pt-4">
                  {calibration.calibration
                    ? <CalibrationSection batch={run} receipts={loads} calibration={calibration.calibration} can={{ canSize: perm.factory, canCheck: perm.factoryCheck, canReview: perm.factory }} onChanged={onChanged} onGoToCooking={() => show("cooking")} />
                    : loadingText(calibration.error)}
                </div>
              )}
            </>
          )}
          {view === "cooking" && (lots.data && calibration.calibration
            ? <CookingSection batchCode={run.code} data={lots.data} calibration={calibration.calibration} can={can} onChanged={onChanged} onGoToShelling={() => show("shelling")} />
            : loadingText(lots.error ?? calibration.error))}
          {view === "shelling" && (lots.data ? <ShellingSection data={lots.data} can={can} onChanged={onChanged} /> : loadingText(lots.error))}
          {view === "colour_sort" && (lots.data ? <ColourSortSection data={lots.data} can={can} onChanged={onChanged} /> : loadingText(lots.error))}
          {stage && !stage.built && (
            <p className="rounded-2xl border border-dashed border-warmstone-300 bg-warmstone-50/60 px-5 py-4 text-[13px] text-warmstone-500">This stage is not built in the app yet.</p>
          )}

          {view === "bins" && <BinsAndLots run={run} />}
          {view === "history" && (
            <Card>
              <div className="px-5 pt-4 pb-3"><CardTitle>History</CardTitle></div>
              <ol className="px-5 pb-5 space-y-2.5">
                {run.history.map((h, i) => (
                  <li key={i} className="text-[12px] flex gap-3">
                    <span className="text-warmstone-500 tabular-nums whitespace-nowrap">{formatDateTime(h.at)}</span>
                    <span className="text-warmstone-800">
                      {h.text}
                      {h.actor && <span className="text-warmstone-500"> · {h.actor}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </section>
      </div>
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

/** The run's warehouse bins, then every Lot in them (filter by bin), each linking back to its truck. */
function BinsAndLots({ run }: { run: BatchDetail }) {
  const { receiptHref, transferHref } = useSiteHrefs();
  const inBinsKg = run.bins.reduce((n, b) => n + b.currentKg, 0);
  type LotRow = LotInBin & { binCode: string };
  const lots: LotRow[] = run.bins.flatMap((b) => b.lots.map((l) => ({ ...l, binCode: b.binCode })));

  const binColumns: Column<BatchBinView>[] = [
    { ...textCol<BatchBinView>("Bin", (b) => b.binCode, { mono: true, strong: true }), render: (b) => <Link to={`/masters/bins/${encodeURIComponent(b.binCode)}`} className="font-mono font-semibold hover:text-brand-700">{b.binCode}</Link> },
    { ...kgCol<BatchBinView>("Planned", (b) => b.plannedKg), render: (b) => formatTonnes(b.plannedKg) },
    { ...kgCol<BatchBinView>("Accepted by production", (b) => b.issuedKg), render: (b) => formatTonnes(b.issuedKg) },
    { ...kgCol<BatchBinView>("In bin now", (b) => b.currentKg), render: (b) => formatTonnes(b.currentKg) },
    numCol("Lots", (b) => b.lots.length, { digits: 0 }),
    // The Bin's quality, not its trucks (26 Nov 2026, user).
    ...binQualityColumns<BatchBinView>((b) => b.lots),
  ];
  const lotColumns: Column<LotRow>[] = [
    {
      ...textCol<LotRow>("Lot", (l) => l.lotNo || l.receiptId, { mono: true }),
      render: (l) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {/* A Lot that came on a BKT has its receipt at the sending site; the BKT is what this site can open. */}
          <Link to={l.transferId ? transferHref(run.warehouse, l.transferId) : receiptHref(run.warehouse, l.receiptId)} className="font-mono text-brand-700 hover:underline">{l.lotNo || l.receiptId}</Link>
          {l.dried && <Pill tone="system" label="dried" />}
          {l.transferId && <Pill tone="system" label={`via ${l.transferId}`} />}
        </span>
      ),
    },
    ...lotQualityColumns<LotRow>(),
    textCol("Bin", (l) => l.binCode, { mono: true }),
    textCol("Supplier", (l) => l.supplierName, { wrap: true }),
    dateCol("Arrived", (l) => l.arrivalDate),
    { ...kgCol<LotRow>("GRN kg", (l) => l.kg), render: (l) => (l.kg !== undefined ? <>{l.kg.toLocaleString("en-US")}{l.kgShared && <span className="block text-[11px] text-warmstone-500">share of its truck, by bags</span>}</> : <span className="text-ambernut-800">{LOT_NOTE[l.state]}</span>) },
  ];

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatBlock icon="inventory_2" label="Planned" value={formatTonnes(run.plannedKg)} sub={`≈ ${run.days} days at 150 t/day`} />
        <StatBlock icon="warehouse" label="Still in warehouse bins" value={formatTonnes(inBinsKg)} sub="Procurement stock, less the loads production accepted" />
        <StatBlock icon="receipt_long" label="Lots in its bins" value={String(lots.length)} sub="Each traces back to its truck" />
        <StatBlock icon="event" label="Estimated end" value={run.endDate ? formatDate(run.endDate) : "-"} />
      </div>

      <Card>
        <div className="px-5 pt-4 pb-3">
          <CardTitle>Warehouse bins</CardTitle>
          <p className="text-[12px] text-warmstone-500 mt-0.5">Planned is the bin's stock when the run was started. Each load production accepts leaves the bin at its net weight.</p>
        </div>
        <div className="px-5 pb-5"><DataTable pageSize={PRODUCTION_PAGE_SIZE} columns={binColumns} rows={run.bins} keyFn={(b) => b.binCode} /></div>
      </Card>

      <Card>
        <div className="px-5 pt-4 pb-3">
          <CardTitle>Lots in these bins ({lots.length})</CardTitle>
          <p className="text-[12px] text-warmstone-500 mt-0.5">Every completed Lot in the run's bins. Open one to see its truck.</p>
        </div>
        <div className="px-5 pb-5">
          <DataTable pageSize={PRODUCTION_PAGE_SIZE} columns={lotColumns} rows={lots} keyFn={(l) => `${l.binCode}-${l.receiptId}-${l.transferId ?? ""}`} emptyTitle="No completed Lot in these bins now" />
        </div>
      </Card>
    </div>
  );
}
