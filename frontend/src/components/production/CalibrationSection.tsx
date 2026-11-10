import { formatKg } from "./batchUi";
import { CalibrationReportsStep } from "./CalibrationReports";
import { SortLoadsStep } from "./CalibrationLoads";
import { CheckSilosStep, FixSiloStep, silosToCheck, type CalibrationPermissions } from "./SizingChecks";
import { NextStep } from "./NextStep";
import { StepCard } from "./StepCard";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { DataTable, type Column } from "../ui/DataTable";
import { Pill } from "../ui/Pill";
import { ProgressBar } from "../ui/ProgressBar";
import { SILO_CHECK_LABELS, batchCalibrationTotals, nextCalibrationStep, siloLabel, silosWaiting, type SiloCheckState, type SiloStock } from "@anagroci/contract/domain/calibration";
import type { BatchCalibration } from "@anagroci/contract/types/calibration";
import type { BatchDetail } from "@anagroci/contract/types/productionBatch";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";
import { PRODUCTION_PAGE_SIZE, kgCol, statusCol, textCol } from "./columns";

const CHECK_TONE: Record<SiloCheckState, string> = { not_checked: "system", ok: "entry", failed: "gap", re_sized: "decision" };

const silos = (n: number) => `${n} silo${n === 1 ? "" : "s"}`;

/**
 * Phase 2 in the shape of a truck's Reception page: one sentence saying what to do next, how far the batch has got,
 * then the numbered steps, the one due now shown beside the list. The forms open in a dialog, so the page stays short.
 * The client's "pick a reconciled load" and "kg into each silo" are one step here: picking a load opens its form.
 */
export function CalibrationSection({ batch, receipts, calibration, can, onChanged, onGoToCooking }: {
  batch: BatchDetail;
  receipts: RcnReceipt[];
  calibration: BatchCalibration;
  can: CalibrationPermissions;
  onChanged: () => void;
  onGoToCooking: () => void;
}) {
  // Any load can be sorted at any step; one is done once its final weight is known and all of it is in the silos.
  const toSort = receipts.filter((r) => !r.calibration || r.calibration.leftKg === null || r.calibration.leftKg > 0);
  const anyReady = receipts.length > 0;
  const checksWaiting = calibration.sizingChecks.filter((c) => c.status === "submitted").length;
  const failedSilos = silosWaiting(calibration.silos, calibration.siloChecks).failed.length;
  const toCheck = silosToCheck(calibration).length;
  const inSilosKg = calibration.silos.reduce((n, s) => n + s.stockKg, 0);
  const next = nextCalibrationStep({ canSize: can.canSize, canCheck: can.canCheck, loadsToSort: toSort.length, checksWaiting, failedSilos, silosToCheck: toCheck });
  const allDone = anyReady && toSort.length === 0 && checksWaiting === 0 && failedSilos === 0 && toCheck === 0;

  const nextText =
    // The list is newest first; the load that has waited longest goes first.
    next === "sort" ? `Next: in step 1, click "Sort this load" for BTM ${toSort.at(-1)!.btmNo} and enter how many kg went into each silo.`
    : next === "check" ? (can.canSize && checksWaiting > 0 ? "Next: in step 2, approve or reject the silo check that is waiting for you." : `Next: in step 2, take a sample from each of the ${silos(toCheck)} with nuts and check the nuts are the right size.`)
    : next === "fix" ? "Next: in step 3, a silo failed its check. Move its nuts to the right silos."
    : allDone ? `Calibration is finished for every load so far. The silos hold ${formatKg(inSilosKg)}, ready for Cooking.`
    : anyReady ? "Nothing for you to do here right now. The Warehouse Incharge or the QFS Officer does the next job."
    : "Nothing to do yet. Record a load in Intake first.";

  const checkStatus = checksWaiting > 0 ? `${checksWaiting} waiting for approval`
    : calibration.silos.every((s) => s.stockKg <= 0) ? "Nothing in the silos yet"
    : toCheck > 0 ? `${silos(toCheck)} to check`
    : "All silos with nuts are checked";

  return (
    <div className="space-y-4">
      <NextStep done={allDone} action={allDone && <Button variant="secondary" icon="arrow_downward" onClick={onGoToCooking}>Go to Cooking</Button>}>{nextText}</NextStep>
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
    textCol("Silo", (s) => siloLabel(s.size), { strong: true }),
    kgCol("Sorted in, all runs", (s) => s.sizedInKg),
    kgCol("Of which this run", (s) => calibration.batchSizedKg[s.size]),
    { ...kgCol("Moved by hand", (s) => Math.round((s.manualInKg - s.manualOutKg) * 100) / 100), render: moved },
    { ...kgCol("Cooked", (s) => s.cookedKg), render: (s) => (s.cookedKg > 0 ? `− ${formatKg(s.cookedKg)}` : "-") },
    kgCol("Kg in the silo", (s) => s.stockKg, { strong: true }),
    // An empty silo has nothing to check, so it shouldn't read as a job left undone.
    statusCol("Check", (s) => (s.stockKg <= 0 ? "" : SILO_CHECK_LABELS[calibration.siloChecks[s.size].state]), (s) => {
      const c = calibration.siloChecks[s.size];
      return s.stockKg <= 0 ? "-" : <Pill tone={CHECK_TONE[c.state]} label={SILO_CHECK_LABELS[c.state]} />;
    }),
  ];
  return (
    <StepCard n={4} title="Silo stock" status={`${formatKg(total)} in all silos · worked out by the app`} active={false} done={false}>
      <p className="text-[13px] text-warmstone-800 mb-3">The silos belong to the factory, so they hold the nuts of every production run. Kg in the silo = sorted in, plus or minus what was moved by hand, minus what was cooked.</p>
      <DataTable pageSize={PRODUCTION_PAGE_SIZE} columns={columns} rows={calibration.silos} keyFn={(s) => s.size} />
    </StepCard>
  );
}
