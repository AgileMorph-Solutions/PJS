import { formatKg } from "./batchUi";
import { StepCard } from "./StepCard";
import { DataTable, type Column } from "../ui/DataTable";
import type { SiloDay } from "@anagroci/contract/domain/calibration";
import { isIntakeDone } from "@anagroci/contract/domain/rcnReceipt";
import { pctOfNet, weighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import type { BatchCalibration } from "@anagroci/contract/types/calibration";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";
import { PRODUCTION_PAGE_SIZE, dateCol, kgCol, textCol } from "./columns";


/**
 * The two reports the client keeps by hand for this phase, worked out from what was entered, so nobody types them:
 * "4. Calibration Process report" (a load's weights) and "5. Calibrated RCN Silos Stock report" (the silos per day, as
 * one total: no kg per size is recorded). "24. Wholes Manual Calibration" is the list of checks above. All three are in
 * the Excel download on the Batches page.
 */
export function CalibrationReportsStep({ n, receipts, calibration }: { n: number; receipts: RcnReceipt[]; calibration: BatchCalibration }) {
  const loads = receipts.filter((r) => isIntakeDone(r.status)).map((r) => ({ r, t: weighingTotals(r.pallets, r.finalWeight ?? { emptyPallets: [] }) }));
  type Load = (typeof loads)[number];

  const loadColumns: Column<Load>[] = [
    textCol("Load (BTM)", ({ r }) => r.btmNo, { strong: true }),
    textCol("From bin", ({ r }) => r.binCode, { mono: true }),
    kgCol("Gross", ({ t }) => t.grossKg),
    kgCol("Bags and pallets", ({ t }) => t.bagsKg + t.palletKg),
    kgCol("Net", ({ t }) => t.netKg),
    { ...kgCol("Dust", ({ t }) => t.dustKg), render: ({ t }) => `${formatKg(t.dustKg)} · ${pctOfNet(t.dustKg, t.netKg).toFixed(2)} %` },
    { ...kgCol("Voids", ({ t }) => t.voidsKg), render: ({ t }) => `${formatKg(t.voidsKg)} · ${pctOfNet(t.voidsKg, t.netKg).toFixed(3)} %` },
    kgCol("To the silos", ({ t }) => t.toSilosKg, { strong: true }),
  ];

  const dayColumns: Column<SiloDay>[] = [
    dateCol("Date", (d) => d.date),
    kgCol("Opening", (d) => d.openingKg),
    kgCol("Calibrated in", (d) => d.inKg, { zeroAsDash: true }),
    kgCol("Cooked", (d) => d.cookedKg, { zeroAsDash: true }),
    kgCol("Closing", (d) => d.closingKg, { strong: true }),
    kgCol("Moved by hand", (d) => d.movedKg, { zeroAsDash: true }),
  ];

  return (
    <StepCard n={n} title="Reports" status="Worked out from what was entered · nothing to type" active={false} done={false}>
      <div className="space-y-5">
        <div>
          <h4 className="text-[13px] font-bold text-warmstone-900">Calibration process, load by load</h4>
          <p className="text-[12px] text-warmstone-500 mt-1 mb-2">This production run. To the silos = net − dust − voids.</p>
          <DataTable pageSize={PRODUCTION_PAGE_SIZE} columns={loadColumns} rows={loads} keyFn={({ r }) => r.id} emptyTitle="No load is weighed yet" />
        </div>
        <div>
          <h4 className="text-[13px] font-bold text-warmstone-900">Silo stock, day by day</h4>
          <p className="text-[12px] text-warmstone-500 mt-1 mb-2">This production run, newest day first. Closing = opening + calibrated in − cooked. A move by hand changes no total.</p>
          <DataTable pageSize={PRODUCTION_PAGE_SIZE} columns={dayColumns} rows={[...calibration.daily].reverse()} keyFn={(d) => d.date} emptyTitle="Nothing has gone into the silos yet" />
        </div>
      </div>
    </StepCard>
  );
}
