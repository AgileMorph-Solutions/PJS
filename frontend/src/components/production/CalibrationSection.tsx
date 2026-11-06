import { formatKg } from "./batchUi";
import { SortLoadsStep } from "./CalibrationLoads";
import { CheckSilosStep, FixSiloStep, openFailedChecks, type CalibrationPermissions } from "./SizingChecks";
import { StepCard } from "./StepCard";
import { DataTable, type Column } from "../ui/DataTable";
import { Pill } from "../ui/Pill";
import { SILO_CHECK_LABELS, nextCalibrationStep, siloLabel, type SiloCheckState, type SiloStock } from "@anagroci/contract/domain/calibration";
import { canCalibrate, isIntakeDone } from "@anagroci/contract/domain/rcnReceipt";
import type { BatchCalibration } from "@anagroci/contract/types/calibration";
import type { BatchDetail } from "@anagroci/contract/types/productionBatch";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

const CHECK_TONE: Record<SiloCheckState, string> = { not_checked: "system", ok: "entry", failed: "gap", re_sized: "decision" };

/**
 * Phase 2 in the shape of a truck's Reception page: one sentence saying what to do next, then numbered steps with
 * only the current one open. The forms open in a dialog, so the page itself stays short. The client's "pick a
 * reconciled load" and "kg into each silo" are one step here: picking a load is what opens its form.
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
  const failedSilos = openFailedChecks(calibration).filter((c) => calibration.siloChecks[c.point as SiloStock["size"]].state === "failed").length;
  const inSilos = calibration.silos.filter((s) => s.stockKg > 0);
  const silosToCheck = inSilos.filter((s) => ["not_checked", "re_sized"].includes(calibration.siloChecks[s.size].state)).length;
  const next = nextCalibrationStep({ canSize: can.canSize, canCheck: can.canCheck, loadsToSort: toSort.length, checksWaiting, failedSilos, silosToCheck });

  const nextText =
    // The list is newest first; the load that has waited longest goes first.
    next === "sort" ? `Next: sort BTM ${toSort.at(-1)!.btmNo} into the silos.`
    : next === "check" ? (can.canSize && checksWaiting > 0 ? "Next: approve the silo check waiting for you." : `Next: check ${silosToCheck} silo${silosToCheck === 1 ? "" : "s"}.`)
    : next === "fix" ? "Next: move the nuts out of the failed silo."
    : anyReady ? "Nothing to do here right now." : "Nothing to do yet. A load comes here after it is weighed in Intake.";

  const checkStatus = checksWaiting > 0 ? `${checksWaiting} waiting for approval`
    : inSilos.length === 0 ? "Nothing in the silos yet"
    : silosToCheck > 0 ? `${silosToCheck} silo${silosToCheck === 1 ? "" : "s"} to check`
    : "All silos with nuts are checked";

  return (
    <div className="max-w-4xl space-y-3">
      <p className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-[13px] font-semibold text-warmstone-900">
        <span className="material-symbols-outlined text-[18px] text-brand-700">arrow_forward</span>
        <span>{nextText}</span>
      </p>
      <SortLoadsStep receipts={receipts} canEdit={can.canSize} active={next === "sort"} onChanged={onChanged} />
      <CheckSilosStep
        batch={batch} calibration={calibration} can={can} active={next === "check"} status={checkStatus}
        done={inSilos.length > 0 && silosToCheck === 0 && checksWaiting === 0} onChanged={onChanged}
      />
      <FixSiloStep calibration={calibration} can={can} active={next === "fix"} onChanged={onChanged} />
      <SiloStockStep calibration={calibration} />
    </div>
  );
}

function SiloStockStep({ calibration }: { calibration: BatchCalibration }) {
  const total = calibration.silos.reduce((n, s) => n + s.stockKg, 0);
  const columns: Column<SiloStock>[] = [
    { label: "Silo", nowrap: true, render: (s) => <b className="font-semibold">{siloLabel(s.size)}</b> },
    { label: "Kg in the silo", align: "right", nowrap: true, render: (s) => formatKg(s.stockKg) },
    { label: "Check", nowrap: true, render: (s) => {
      const c = calibration.siloChecks[s.size];
      // An empty silo has nothing to check, so it shouldn't read as a job left undone.
      return s.stockKg <= 0 && c.state === "not_checked" ? "-" : <Pill tone={CHECK_TONE[c.state]} label={SILO_CHECK_LABELS[c.state]} />;
    } },
  ];
  return (
    <StepCard n={4} title="Silo stock" status={`${formatKg(total)} in all silos · worked out by the app`} active={false} done={false}>
      <DataTable columns={columns} rows={calibration.silos} keyFn={(s) => s.size} />
    </StepCard>
  );
}
