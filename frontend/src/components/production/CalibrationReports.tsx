import { formatKg } from "./batchUi";
import { StepCard } from "./StepCard";
import { DataTable, type Column } from "../ui/DataTable";
import { SILO_SIZES, type SiloDay } from "@anagroci/contract/domain/calibration";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import { isIntakeDone } from "@anagroci/contract/domain/rcnReceipt";
import { pctOfNet, weighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import type { BatchCalibration } from "@anagroci/contract/types/calibration";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

const kgOrDash = (kg: number) => (kg === 0 ? "-" : formatKg(kg));

/**
 * The two reports the client keeps by hand for this phase, worked out from what was entered, so nobody types them:
 * "4. Calibration Process report" (a load's weights) and "5. Calibrated RCN Silos Stock report" (the silos per day).
 * "24. Wholes Manual Calibration" is the list of checks in step 2. All three are in the Excel download on the Batches page.
 */
export function CalibrationReportsStep({ receipts, calibration }: { receipts: RcnReceipt[]; calibration: BatchCalibration }) {
  const loads = receipts.filter((r) => isIntakeDone(r.status)).map((r) => ({ r, t: weighingTotals(r.pallets, r.finalWeight ?? { emptyPallets: [] }) }));
  type Load = (typeof loads)[number];

  const loadColumns: Column<Load>[] = [
    { label: "Load (BTM)", nowrap: true, render: ({ r }) => <b className="font-semibold">{r.btmNo}</b> },
    { label: "From bin", nowrap: true, render: ({ r }) => r.binCode },
    { label: "Gross", align: "right", nowrap: true, render: ({ t }) => formatKg(t.grossKg) },
    { label: "Bags and pallets", align: "right", nowrap: true, render: ({ t }) => formatKg(t.bagsKg + t.palletKg) },
    { label: "Net", align: "right", nowrap: true, render: ({ t }) => formatKg(t.netKg) },
    { label: "Dust", align: "right", nowrap: true, render: ({ t }) => `${formatKg(t.dustKg)} · ${pctOfNet(t.dustKg, t.netKg).toFixed(2)} %` },
    { label: "Voids", align: "right", nowrap: true, render: ({ t }) => `${formatKg(t.voidsKg)} · ${pctOfNet(t.voidsKg, t.netKg).toFixed(3)} %` },
    { label: "To the silos", align: "right", nowrap: true, render: ({ t }) => <b className="font-semibold">{formatKg(t.toSilosKg)}</b> },
  ];

  const dayColumns: Column<SiloDay>[] = [
    { label: "Date", nowrap: true, render: (d) => formatDate(d.date) },
    { label: "Opening", align: "right", nowrap: true, render: (d) => formatKg(d.openingKg) },
    { label: "Sorted in", align: "right", nowrap: true, render: (d) => kgOrDash(d.sizedKg) },
    { label: "Cooked", align: "right", nowrap: true, render: (d) => kgOrDash(d.cookedKg) },
    // Ahead of the sizes: the table is wider than the page, and closing is what a reader comes for.
    { label: "Closing", align: "right", nowrap: true, render: (d) => <b className="font-semibold">{formatKg(d.closingKg)}</b> },
    { label: "Moved by hand", align: "right", nowrap: true, render: (d) => kgOrDash(d.movedKg) },
    ...SILO_SIZES.map((s): Column<SiloDay> => ({ label: s.code, align: "right", nowrap: true, render: (d) => kgOrDash(d.sizes[s.key]) })),
  ];

  return (
    <StepCard n={5} title="Reports" status="Worked out from what was entered · nothing to type" active={false} done={false}>
      <div className="space-y-5">
        <div>
          <h4 className="text-[13px] font-bold text-warmstone-900">Calibration process, load by load</h4>
          <p className="text-[12px] text-warmstone-500 mt-1 mb-2">This batch. To the silos = net − dust − voids.</p>
          <DataTable columns={loadColumns} rows={loads} keyFn={({ r }) => r.id} emptyTitle="No load is weighed yet" />
        </div>
        <div>
          <h4 className="text-[13px] font-bold text-warmstone-900">Silo stock, day by day</h4>
          <p className="text-[12px] text-warmstone-500 mt-1 mb-2">All batches, newest day first. Closing = opening + sorted in − cooked. A move by hand changes the sizes, never the total.</p>
          <DataTable columns={dayColumns} rows={[...calibration.daily].reverse()} keyFn={(d) => d.date} emptyTitle="Nothing has gone into the silos yet" />
        </div>
      </div>
    </StepCard>
  );
}
