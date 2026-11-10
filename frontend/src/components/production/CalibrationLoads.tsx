import { useState } from "react";
import { formatKg } from "./batchUi";
import { SortLoadDialog } from "./CalibrationRunCard";
import { StepCard } from "./StepCard";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Pill } from "../ui/Pill";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";
import { PRODUCTION_PAGE_SIZE, kgCol, textCol } from "./columns";

/** Still to sort: nothing known about its total yet (no final weight), or kg left of it. */
const stillToSort = (r: RcnReceipt) => !r.calibration || r.calibration.leftKg === null || r.calibration.leftKg > 0;

/**
 * Step 1: every load of the run, ready to be sorted into the silos at any step (team decision, Nov 2026 — nothing waits
 * for the final weight). Once the final weight is saved, the load's total limits what can be sorted.
 */
export function SortLoadsStep({ receipts, canEdit, active, onChanged }: { receipts: RcnReceipt[]; canEdit: boolean; active: boolean; onChanged: () => void }) {
  const toSort = receipts.filter(stillToSort);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = receipts.find((r) => r.id === openId);

  const columns: Column<RcnReceipt>[] = [
    textCol("Load (BTM)", (r) => r.btmNo, { strong: true }),
    textCol("From bin", (r) => r.binCode, { mono: true }),
    { ...kgCol<RcnReceipt>("To sort", (r) => r.calibration?.toSilosKg), render: (r) => (r.calibration?.toSilosKg == null ? <span className="text-warmstone-500">After final weight</span> : formatKg(r.calibration.toSilosKg)) },
    kgCol("Sorted", (r) => r.calibration?.sizedKg ?? 0),
    { ...kgCol<RcnReceipt>("Left to sort", (r) => r.calibration?.leftKg), render: (r) => (!stillToSort(r) ? <Pill tone="entry" label="All sorted" /> : r.calibration?.leftKg == null ? "-" : formatKg(r.calibration.leftKg)) },
    {
      label: "",
      align: "right",
      nowrap: true,
      render: (r) => (
        canEdit && stillToSort(r)
          ? <Button variant={r.id === toSort.at(-1)?.id ? "primary" : "secondary"} onClick={() => setOpenId(r.id)}>Sort this load</Button>
          : <Button variant="secondary" onClick={() => setOpenId(r.id)}>View</Button>
      ),
    },
  ];

  return (
    <StepCard
      n={1} title="Sort loads into silos" active={active} done={receipts.length > 0 && toSort.length === 0}
      status={toSort.length > 0 ? `${toSort.length} load${toSort.length === 1 ? "" : "s"} to sort` : receipts.length > 0 ? "Every load is sorted" : "No load recorded yet"}
    >
      <DataTable pageSize={PRODUCTION_PAGE_SIZE} columns={columns} rows={receipts} keyFn={(r) => r.id} emptyTitle="No load recorded yet" emptyHint="Record a load in Intake, then sort it here." />
      {opened && <SortLoadDialog key={opened.id} receipt={opened} canEdit={canEdit} onClose={() => setOpenId(null)} onChanged={onChanged} />}
    </StepCard>
  );
}
