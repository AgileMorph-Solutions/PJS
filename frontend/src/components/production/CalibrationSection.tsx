import { formatKg } from "./batchUi";
import { CalibrationReportsStep } from "./CalibrationReports";
import { CheckSilosStep, FixSiloStep, silosToCheck, type CalibrationPermissions } from "./SizingChecks";
import { NextStep } from "./NextStep";
import { Button } from "../ui/Button";
import { StatBlock } from "../ui/StatBlock";
import { nextCalibrationStep, silosWaiting } from "@anagroci/contract/domain/calibration";
import { isIntakeDone } from "@anagroci/contract/domain/rcnReceipt";
import type { BatchCalibration } from "@anagroci/contract/types/calibration";
import type { BatchDetail } from "@anagroci/contract/types/productionBatch";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

const silos = (n: number) => `${n} silo${n === 1 ? "" : "s"}`;

/**
 * The silo half of "Intake & Calibration", below the run's loads. Nobody weighs the 9 silos one by one (decision, Nov
 * 2026), so a load is in the silos as one total, net − dust − voids, once production accepts it: there is nothing
 * to sort by hand. What is left here is the silos' total, the QC-2 checks and moving nuts after a failed one.
 */
export function CalibrationSection({ batch, receipts, calibration, can, onChanged, onGoToCooking }: {
  batch: BatchDetail;
  receipts: RcnReceipt[];
  calibration: BatchCalibration;
  can: CalibrationPermissions;
  onChanged: () => void;
  onGoToCooking: () => void;
}) {
  const stock = calibration.silos.stockKg;
  const checksWaiting = calibration.sizingChecks.filter((c) => c.status === "submitted").length;
  const failedSilos = silosWaiting(stock, calibration.siloChecks).failed.length;
  const toCheck = silosToCheck(calibration).length;
  const next = nextCalibrationStep({ canSize: can.canSize, canCheck: can.canCheck, checksWaiting, failedSilos, silosToCheck: toCheck });
  const calibrated = receipts.filter((r) => isIntakeDone(r.status)).length;
  const ready = stock > 0 && checksWaiting === 0 && failedSilos === 0 && toCheck === 0;

  const nextText =
    next === "check" ? (can.canSize && checksWaiting > 0 ? "Next: in step 1, approve or reject the silo check that is waiting for you." : `Next: in step 1, check the ${silos(toCheck)} whose nuts were moved.`)
    : next === "fix" ? "Next: in step 2, a silo failed its check. Move its nuts to the right silos."
    : ready ? `This run has ${formatKg(stock)} in the silos, ready for Cooking.`
    : stock > 0 ? "Nothing for you to do here right now. The Production Incharge or the QFS Officer does the next job."
    : "Nothing in the silos yet. A load goes in when production accepts it.";

  const checkStatus = checksWaiting > 0 ? `${checksWaiting} waiting for approval`
    : toCheck > 0 ? `${silos(toCheck)} to check again`
    : calibration.sizingChecks.length === 0 ? "No silo checked yet"
    : "No silo waiting for a check";

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[15px] font-bold text-warmstone-900">The silos</h3>
        <p className="text-[12px] text-warmstone-500 mt-0.5">
          {calibrated} of {receipts.length} load{receipts.length === 1 ? "" : "s"} in the silos. Only the total is tracked, not the kg in each of the 9 silos.
        </p>
      </div>
      <NextStep done={ready} action={ready && <Button variant="secondary" icon="arrow_forward" onClick={onGoToCooking}>Go to Cooking</Button>}>{nextText}</NextStep>
      <SiloStock calibration={calibration} />
      <CheckSilosStep n={1} batch={batch} calibration={calibration} can={can} active={next === "check"} status={checkStatus} done={false} onChanged={onChanged} />
      <FixSiloStep n={2} checkStep={1} calibration={calibration} can={can} active={next === "fix"} onChanged={onChanged} />
      <CalibrationReportsStep n={3} receipts={receipts} calibration={calibration} />
    </div>
  );
}

/** "Silo stock = calibrated in − cooked", for this production run only: each run's stock is its own. */
function SiloStock({ calibration }: { calibration: BatchCalibration }) {
  const { inKg, cookedKg, stockKg } = calibration.silos;
  return (
    <div className="grid sm:grid-cols-3 gap-4">
      <StatBlock icon="input" label="Calibrated in" value={formatKg(inKg)} sub="Net − dust − voids of this run's accepted loads" />
      <StatBlock icon="outdoor_grill" label="Cooked out" value={formatKg(cookedKg)} sub="This run's Lots" />
      <StatBlock icon="move_down" label="In the silos now" value={formatKg(stockKg)} sub="Calibrated in − cooked out" tone={stockKg > 0 ? "success" : "default"} />
    </div>
  );
}
