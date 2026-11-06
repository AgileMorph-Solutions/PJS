import { useState } from "react";
import { formatKg } from "./batchUi";
import { SortLoadDialog } from "./CalibrationRunCard";
import { StepCard } from "./StepCard";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { Pill } from "../ui/Pill";
import { canCalibrate, isIntakeDone } from "@anagroci/contract/domain/rcnReceipt";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

/** Step 1: a load appears here once its final weight is saved, because that is what gives it a kg to sort. */
export function SortLoadsStep({ receipts, canEdit, active, onChanged }: { receipts: RcnReceipt[]; canEdit: boolean; active: boolean; onChanged: () => void }) {
  const ready = receipts.filter((r) => isIntakeDone(r.status));
  const toSort = ready.filter((r) => canCalibrate(r.status));
  const inIntake = receipts.length - ready.length;
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = ready.find((r) => r.id === openId);

  const columns: Column<RcnReceipt>[] = [
    { label: "Load (BTM)", nowrap: true, render: (r) => <b className="font-semibold">{r.btmNo}</b> },
    { label: "From bin", nowrap: true, render: (r) => r.binCode },
    { label: "Left to sort", align: "right", nowrap: true, render: (r) => (canCalibrate(r.status) ? formatKg(r.calibration?.leftKg ?? 0) : <Pill tone="entry" label="All sorted" />) },
    {
      label: "",
      align: "right",
      nowrap: true,
      render: (r) => (
        canEdit && canCalibrate(r.status)
          ? <Button variant={r.id === toSort.at(-1)?.id ? "primary" : "secondary"} onClick={() => setOpenId(r.id)}>Sort this load</Button>
          : <Button variant="secondary" onClick={() => setOpenId(r.id)}>View</Button>
      ),
    },
  ];

  return (
    <StepCard
      n={1} title="Sort loads into silos" active={active} done={ready.length > 0 && toSort.length === 0}
      status={toSort.length > 0 ? `${toSort.length} load${toSort.length === 1 ? "" : "s"} to sort` : ready.length > 0 ? "All weighed loads are sorted" : "No load is ready yet"}
    >
      <DataTable columns={columns} rows={ready} keyFn={(r) => r.id} emptyTitle="No load is ready yet" emptyHint="A load comes here after its final weight is saved in Intake." />
      {inIntake > 0 && <p className="mt-2 text-[12px] text-warmstone-500">{inIntake} more load{inIntake === 1 ? " is" : "s are"} still being weighed in Intake.</p>}
      {opened && <SortLoadDialog key={opened.id} receipt={opened} canEdit={canEdit} onClose={() => setOpenId(null)} onChanged={onChanged} />}
    </StepCard>
  );
}
