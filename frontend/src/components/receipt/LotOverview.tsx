import { Link } from "react-router-dom";
import type { ReceiptRecord } from "../../types/receipt";
import type { ReceiptLinks } from "../../repository/api";
import { deriveStatus } from "../../domain/receiptStatus";
import { InfoCard, InfoRow } from "../ui/InfoCard";
import { ReceiptStatusPill } from "../ReceiptStatusPill";
import { Pill } from "../ui/Pill";

const v = (r: ReceiptRecord, stage: string, label: string) => {
  const x = r.stageData[stage]?.[label];
  return x && x.trim() ? x.trim() : undefined;
};
const kg = (x?: string | number | null) => (x === undefined || x === null || x === "" ? undefined : `${Number(x).toLocaleString()} kg`);
const pct = (x?: string | number | null) => (x === undefined || x === null || x === "" ? undefined : `${x}%`);

/** What to say about drying, and in what tone — from the drying batch row when one exists, else from
 * the drying stage on the receipt itself, else "not sent". */
function dryingSummary(r: ReceiptRecord, links: ReceiptLinks | null) {
  const batch = links?.dryingBatches[links.dryingBatches.length - 1];
  const stage = r.stageData["n-drying"];
  const decision = r.branches["n-drying"];
  if (!batch && !stage && !decision) return { label: "Not sent to drying", tone: "system" as const, batch, stage };
  const done = /complete|done|finish/i.test(batch?.status ?? "") || Boolean(stage?.["Moisture % — after drying"]);
  return { label: done ? "Drying completed" : "Drying in progress", tone: done ? ("entry" as const) : ("decision" as const), batch, stage };
}

/**
 * Everything about this one Lot, gathered from the receipt's own stages and the other workbooks'
 * rows that carry its Lot number — so the page answers "where is it, what shape is it in, where has
 * it been" without a trip to another sidebar page.
 */
export function LotOverview({
  receipt,
  links,
  othersInBin,
  siteSlug,
}: {
  receipt: ReceiptRecord;
  links: ReceiptLinks | null;
  othersInBin: ReceiptRecord[];
  siteSlug: string;
}) {
  const dry = dryingSummary(receipt, links);
  const qfs = receipt.branches["n-qfs"];
  const plan = receipt.deliveryPlanId;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <InfoCard
        icon="grid_view"
        title="Lot & storage"
        footer={
          receipt.binNo && othersInBin.length > 0 ? (
            <p className="text-[12px] text-warmstone-500">
              Also in Bin {receipt.binNo}:{" "}
              {othersInBin.slice(0, 4).map((o, i) => (
                <span key={o.id}>
                  {i > 0 && ", "}
                  <Link to={`/${siteSlug}/receipts/${o.id}`} className="font-semibold text-brand-700 hover:text-brand-800">
                    {o.lotNo || o.id}
                  </Link>
                </span>
              ))}
              {othersInBin.length > 4 && ` +${othersInBin.length - 4} more`}
            </p>
          ) : undefined
        }
      >
        <InfoRow label="Lot number" value={receipt.lotNo} strong />
        <InfoRow label="Receipt ID" value={receipt.id} />
        <InfoRow
          label="Bin"
          strong
          value={receipt.binNo ? <Link to={`/masters/bins/${receipt.binNo}`} className="text-brand-700 hover:text-brand-800">{receipt.binNo}</Link> : undefined}
        />
        <InfoRow label="Bin allocated for" value={v(receipt, "n-bin", "Basis for allocation (moisture / quality / KOR / space)")} />
        <InfoRow label="Warehouse" value={receipt.warehouse} />
        <InfoRow label="Lot issued" value={v(receipt, "n-lot", "Date/time assigned")?.slice(0, 10)} />
      </InfoCard>

      <InfoCard
        icon="light_mode"
        title="Drying"
        badge={<Pill tone={dry.tone} label={dry.label} />}
        footer={
          dry.batch?.remarks ? <p className="text-[12px] text-warmstone-500">{dry.batch.remarks}</p> : undefined
        }
      >
        <InfoRow label="Decision" value={v(receipt, "n-drying", "Decision (Direct to drying / Warehouse → Drying)")} />
        <InfoRow label="Batch status" value={dry.batch?.status} />
        <InfoRow label="Method" value={dry.batch?.dryType} />
        <InfoRow label="Moisture before" value={pct(dry.batch?.inputMoisturePct ?? v(receipt, "n-drying", "Moisture % — before drying"))} />
        <InfoRow label="Moisture after" value={pct(dry.batch?.outputMoisturePct ?? v(receipt, "n-drying", "Moisture % — after drying"))} />
        <InfoRow label="Bags in → out" value={dry.batch && (dry.batch.inputBags != null || dry.batch.outputBags != null) ? `${dry.batch.inputBags ?? "—"} → ${dry.batch.outputBags ?? "—"}` : undefined} />
        <InfoRow label="Bin in → out" value={dry.batch && (dry.batch.sourceBinNo || dry.batch.destinationBinNo) ? `${dry.batch.sourceBinNo || "—"} → ${dry.batch.destinationBinNo || "—"}` : undefined} />
        <InfoRow label="Weight loss" value={kg(dry.batch?.dryingLossKg)} />
      </InfoCard>

      <InfoCard
        icon="science"
        title="Quality"
        badge={
          qfs ? <Pill tone={qfs === "pass" ? "entry" : "gap"} label={qfs === "pass" ? "Passed" : "Rejected"} /> : <Pill tone="decision" label="Pending" />
        }
      >
        <InfoRow label="Moisture" value={pct(v(receipt, "n-qfs", "MOIS. (moisture)"))} />
        <InfoRow label="Nut count" value={v(receipt, "n-qfs", "NUT COUNT")} />
        <InfoRow label="KOR" value={v(receipt, "n-qfs", "KOR")} />
        <InfoRow label="Final KOR" value={v(receipt, "n-qfs", "FINAL KOR")} strong />
        {qfs === "fail" && <InfoRow label="Reason" value={v(receipt, "n-reject", "Reason for rejection")} />}
      </InfoCard>

      <InfoCard icon="scale" title="Weights & bags">
        <InfoRow label="Loaded truck" value={kg(v(receipt, "n-gross", "Loaded truck weight (kg)"))} />
        <InfoRow label="Empty truck" value={kg(v(receipt, "n-tare", "Tare / empty truck weight (kg)"))} />
        <InfoRow label="Gross" value={kg(v(receipt, "n-gross", "GROSS WT KGS"))} />
        <InfoRow label="Net" value={kg(v(receipt, "n-netwt", "NET WT KGS"))} strong />
        <InfoRow label="Paid weight" value={kg(v(receipt, "n-netwt", "PAID WT"))} />
        <InfoRow label="Bags (good / damp / torn)" value={v(receipt, "n-unload", "SACS (bags)") ? `${v(receipt, "n-unload", "SACS (bags)")} (${v(receipt, "n-unload", "BON SACS (good bags)") ?? 0} / ${v(receipt, "n-unload", "HUMID SACS (damp bags)") ?? 0} / ${v(receipt, "n-unload", "Sacs déchirés (torn bags)") ?? 0})` : undefined} />
        <InfoRow label="Price / kg" value={v(receipt, "n-grn", "PRICE")} />
        <InfoRow label="GRN amount" value={v(receipt, "n-grn", "AMOUNT") ? `${Number(v(receipt, "n-grn", "AMOUNT")).toLocaleString()} XOF` : undefined} strong />
      </InfoCard>

      <InfoCard icon="local_shipping" title="Supplier & delivery">
        <InfoRow label="Supplier" value={receipt.supplierName} strong />
        <InfoRow label="Supplier code" value={receipt.lbaCode} />
        <InfoRow label="Origin" value={receipt.origin} />
        <InfoRow label="Vehicle" value={receipt.vehicleNo} />
        <InfoRow label="Arrived" value={receipt.arrivalDate} />
        <InfoRow label="Fiche" value={links?.fiche ?? v(receipt, "n-verify", "FICHE")} />
        <InfoRow
          label="Delivery plan"
          value={plan ? <Link to={`/${siteSlug}/delivery-plans`} className="text-brand-700 hover:text-brand-800">{plan}</Link> : "Arrived without a plan"}
        />
      </InfoCard>

      <InfoCard
        icon="swap_horiz"
        title="Movement"
        badge={<ReceiptStatusPill status={deriveStatus(receipt)} />}
      >
        <InfoRow label="Dispatched" value={links?.dispatches[0]?.chargeDate} />
        <InfoRow label="Dispatch no." value={links?.dispatches[0]?.vyogeNumber} />
        <InfoRow label="Received at factory" value={links?.warehouseReceiving.find((w) => !/bouak/i.test(w.warehouseSite))?.arrivalDate} />
        <InfoRow label="Transfer to" value={links?.transfers[0]?.destinationWarehouse} />
        <InfoRow label="Production BTM" value={links?.btmIntakes[0]?.btmNo} />
        <InfoRow label="Issued to production" value={links?.issuedToProduction[0]?.date} />
      </InfoCard>
    </div>
  );
}
