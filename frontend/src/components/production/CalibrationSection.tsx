import { formatKg } from "./batchUi";
import { CalibrationReportsStep } from "./CalibrationReports";
import { SortLoadsStep } from "./CalibrationLoads";
import { CheckSilosStep, FixSiloStep, silosToCheck, type CalibrationPermissions } from "./SizingChecks";
import { StepCard } from "./StepCard";
import { Card } from "../ui/Card";
import { DataTable, type Column } from "../ui/DataTable";
import { Pill } from "../ui/Pill";
import { ProgressBar } from "../ui/ProgressBar";
import { SILO_CHECK_LABELS, batchCalibrationTotals, nextCalibrationStep, siloLabel, silosWaiting, type SiloCheckState, type SiloStock } from "@anagroci/contract/domain/calibration";
import { canCalibrate, isIntakeDone } from "@anagroci/contract/domain/rcnReceipt";
import type { BatchCalibration } from "@anagroci/contract/types/calibration";
import type { BatchDetail } from "@anagroci/contract/types/productionBatch";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

const CHECK_TONE: Record<SiloCheckState, string> = { not_checked: "system", ok: "entry", failed: "gap", re_sized: "decision" };

const silos = (n: number) => `${n} silo${n === 1 ? "" : "s"}`;

/**
 * Phase 2 in the shape of a truck's Reception page: one sentence saying what to do next, how far the batch has got,
 * then numbered steps with only the current one open. The forms open in a dialog, so the page itself stays short.
 * The client's "pick a reconciled load" and "kg into each silo" are one step here: picking a load opens its form.
 */
export function CalibrationSection({ batch, receipts, calibration, can, onChanged }: {
  batch: BatchDetail;
  receipts: RcnReceipt[];
  calibration: BatchCalibration;
  can: CalibrationPermissions;
  onChanged: () => void;
}) {
  const toSort = receipts.filter((r) => canCalibrate(r.status));
  const anyReady = receipts.some((r) => isIntakeDone(r.status));
  const checksWaiting = calibration.sizingChecks.filter((c) => c.status === "submitted").length;
  const failedSilos = silosWaiting(calibration.silos, calibration.siloChecks).failed.length;
  const toCheck = silosToCheck(calibration).length;
  const inSilosKg = calibration.silos.reduce((n, s) => n + s.stockKg, 0);
  const next = nextCalibrationStep({ canSize: can.canSize, canCheck: can.canCheck, loadsToSort: toSort.length, checksWaiting, failedSilos, silosToCheck: toCheck });
  const allDone = anyReady && toSort.length === 0 && checksWaiting === 0 && failedSilos === 0 && toCheck === 0;

  const nextText =
    // The list is newest first; the load that has waited longest goes first.
    next === "sort" ? `Next: sort BTM ${toSort.at(-1)!.btmNo} into the silos.`
    : next === "check" ? (can.canSize && checksWaiting > 0 ? "Next: approve the silo check waiting for you." : `Next: check ${silos(toCheck)}.`)
    : next === "fix" ? "Next: move the nuts out of the failed silo."
    : allDone ? `Calibration is finished for every load so far. The silos hold ${formatKg(inSilosKg)}, ready for Cooking.`
    : anyReady ? "Nothing for you right now. The Warehouse Incharge or the QFS Officer has the next job here."
    : "Nothing to do yet. A load comes here after it is weighed in Intake.";

  const checkStatus = checksWaiting > 0 ? `${checksWaiting} waiting for approval`
    : calibration.silos.every((s) => s.stockKg <= 0) ? "Nothing in the silos yet"
    : toCheck > 0 ? `${silos(toCheck)} to check`
    : "All silos with nuts are checked";

  return (
    <div className="max-w-5xl space-y-3">
      <p className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-[13px] font-semibold text-warmstone-900 ${allDone ? "border-success-200 bg-success-50" : "border-brand-200 bg-brand-50"}`}>
        <span className={`material-symbols-outlined text-[18px] ${allDone ? "text-success-700" : "text-brand-700"}`}>{allDone ? "check_circle" : "arrow_forward"}</span>
        <span>{nextText}</span>
      </p>
      <Progress receipts={receipts} />
      <SortLoadsStep receipts={receipts} canEdit={can.canSize} active={next === "sort"} onChanged={onChanged} />
      <CheckSilosStep
        batch={batch} calibration={calibration} can={can} active={next === "check"} status={checkStatus}
        done={!calibration.silos.every((s) => s.stockKg <= 0) && toCheck === 0 && checksWaiting === 0} onChanged={onChanged}
      />
      <FixSiloStep calibration={calibration} can={can} active={next === "fix"} onChanged={onChanged} />
      <SiloStockStep calibration={calibration} />
      <CalibrationReportsStep receipts={receipts} calibration={calibration} />
    </div>
  );
}

/** How much of what Intake handed over has reached the silos. Only loads with a final weight have a kg to count. */
function Progress({ receipts }: { receipts: RcnReceipt[] }) {
  const t = batchCalibrationTotals(receipts);
  if (t.loads === 0) return null;
  return (
    <Card>
      <div className="px-5 py-4 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-[13px] font-bold text-warmstone-900 tabular-nums">{formatKg(t.sizedKg)} of {formatKg(t.toSilosKg)} sorted into the silos</p>
          <p className="text-[12px] text-warmstone-500 tabular-nums">{t.loadsDone} of {t.loads} load{t.loads === 1 ? "" : "s"} finished · {formatKg(t.leftKg)} left</p>
        </div>
        <ProgressBar value={t.sizedKg} max={t.toSilosKg} label="Kg sorted into the silos" />
      </div>
    </Card>
  );
}

function SiloStockStep({ calibration }: { calibration: BatchCalibration }) {
  const total = calibration.silos.reduce((n, s) => n + s.stockKg, 0);
  const moved = (s: SiloStock) => {
    const net = Math.round((s.manualInKg - s.manualOutKg) * 100) / 100;
    return net === 0 ? "-" : `${net > 0 ? "+" : "−"} ${formatKg(Math.abs(net))}`;
  };
  const columns: Column<SiloStock>[] = [
    { label: "Silo", nowrap: true, render: (s) => <b className="font-semibold">{siloLabel(s.size)}</b> },
    { label: "Sorted in, all batches", align: "right", nowrap: true, render: (s) => formatKg(s.sizedInKg) },
    { label: "Of which this batch", align: "right", nowrap: true, render: (s) => formatKg(calibration.batchSizedKg[s.size]) },
    { label: "Moved by hand", align: "right", nowrap: true, render: moved },
    { label: "Kg in the silo", align: "right", nowrap: true, render: (s) => <b className="font-semibold">{formatKg(s.stockKg)}</b> },
    { label: "Check", nowrap: true, render: (s) => {
      const c = calibration.siloChecks[s.size];
      // An empty silo has nothing to check, so it shouldn't read as a job left undone.
      return s.stockKg <= 0 ? "-" : <Pill tone={CHECK_TONE[c.state]} label={SILO_CHECK_LABELS[c.state]} />;
    } },
  ];
  return (
    <StepCard n={4} title="Silo stock" status={`${formatKg(total)} in all silos · worked out by the app`} active={false} done={false}>
      <p className="text-[13px] text-warmstone-800 mb-3">The silos belong to the factory, so they hold the nuts of every batch. Kg in the silo = sorted in, plus or minus what was moved by hand.</p>
      <DataTable columns={columns} rows={calibration.silos} keyFn={(s) => s.size} />
    </StepCard>
  );
}
