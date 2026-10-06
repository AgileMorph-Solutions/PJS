import type { Column } from "../../components/ui/DataTable";
import type { ReceiptRecord } from "../../types/receipt";
import type { SiteSlug } from "../../config/sites";
import type { DownstreamStatus } from "../../repository/api";
import { ReceiptStatusPill } from "../../components/ReceiptStatusPill";
import { DownstreamStatusChips } from "../../components/DownstreamStatusChips";
import { deriveStatus } from "../../domain/receiptStatus";

/** The real per-truck paperwork, straight from the OFFLOADINGS sheet's "Verify supplier documents"
 * / "Gate entry" stages — not top-level ReceiptRecord fields, so a small reader avoids repeating
 * the stageData path at every call site. */
const gateField = (r: ReceiptRecord, label: string) => r.stageData["n-gate"]?.[label] ?? "";
const verifyField = (r: ReceiptRecord, label: string) => r.stageData["n-verify"]?.[label] ?? "";
export const fiche = (r: ReceiptRecord) => verifyField(r, "FICHE");
/** The physical store (BKE-001/002/003 at Bouaké; ANAGROCI-01 at Yakro) — n-gate's "WH NO." column.
 * Distinct from ReceiptRecord.warehouse, which is always the SITE ("BOUAKE"/"YAKRO FACTORY"; see
 * backend/src/domain/imports/offloadings.ts — Receipt.warehouse is set from "WH LOCATION", never
 * "WH NO."). */
export const storeCode = (r: ReceiptRecord) => gateField(r, "WH NO.");

/** Two lines in one cell — the value, and a quieter companion under it. Merging related columns
 * (supplier + its LBA code, fiche + fiche code, vehicle + store, lot + bin) is what lets the whole
 * register fit a normal screen without sideways scrolling. */
const Stack = ({ main, sub, mono }: { main: string; sub?: string; mono?: boolean }) => (
  <div className="leading-snug">
    <div className={mono ? "font-mono text-[12.5px]" : "font-medium"}>{main || "-"}</div>
    {sub && <div className="font-mono text-[11px] text-warmstone-400">{sub}</div>}
  </div>
);

const idColumn: Column<ReceiptRecord> = { label: "Receipt ID", nowrap: true, render: (r) => <span className="font-mono text-[12.5px]">{r.id}</span> };
const arrivalColumn: Column<ReceiptRecord> = { label: "Arrived", nowrap: true, render: (r) => r.arrivalDate || "-" };
const supplierColumn: Column<ReceiptRecord> = { label: "Supplier", render: (r) => <Stack main={r.supplierName} sub={r.lbaCode} /> };
const ficheColumn: Column<ReceiptRecord> = {
  label: "Fiche",
  nowrap: true,
  render: (r) => <Stack mono main={fiche(r)} sub={[verifyField(r, "FICHE CODE"), verifyField(r, "REF.")].filter(Boolean).join(" · ")} />,
};
const vehicleColumn = (withStore: boolean): Column<ReceiptRecord> => ({
  label: withStore ? "Vehicle / Store" : "Vehicle",
  nowrap: true,
  render: (r) => <Stack main={r.vehicleNo} sub={withStore ? storeCode(r) : undefined} />,
});

/** One column per site, built with the current downstream-status map — everything that used to be
 * its own sidebar page (Dispatch to Central, Receiving from Unit, Issue to Production) is visible
 * here instead. A factory rather than a static column list because the map is only known at render
 * time (see DownstreamStatusChips's own header). */
const downstreamColumn = (status: Map<string, DownstreamStatus>): Column<ReceiptRecord> => ({
  label: "Downstream",
  render: (r) => <DownstreamStatusChips status={status.get(r.id)} />,
});

const sourceColumn: Column<ReceiptRecord> = {
  label: "Source",
  render: (r) => (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
        r.source === "imported" ? "bg-success-100 text-success-800" : "bg-ambernut-100 text-ambernut-800"
      }`}
    >
      {r.source === "imported" ? "imported" : "entered"}
    </span>
  ),
};

const tailColumns: Column<ReceiptRecord>[] = [
  { label: "Lot / Bin", nowrap: true, render: (r) => <Stack mono main={r.lotNo ?? ""} sub={r.binNo} /> },
  { label: "Status", nowrap: true, render: (r) => <ReceiptStatusPill status={deriveStatus(r)} /> },
];

/**
 * The one genuine per-site column difference in the Receipts table (see CLAUDE.md's "check this by
 * actually comparing which stage fields exist" rule — every OTHER stage field is identical across
 * both sites' receipts, since they share the same 16-stage `stages.ts` spec; that's why Stock and
 * Drying pages do NOT get their own columns.ts — there was nothing genuine to split there. This one
 * differs because of what's meaningful to show, not because the underlying field set differs):
 *
 * Bouaké genuinely has 3 physical stores (BKE-001/002/003) sharing the "BOUAKE" site value on
 * `r.warehouse`, so a "Store" column (from n-gate's "WH NO.") carries real information there. Yakro
 * Factory has exactly one (ANAGROCI-01) — showing the same column would be a constant, so central's
 * table doesn't get it.
 */
export function receiptColumns(siteSlug: SiteSlug, downstreamStatus: Map<string, DownstreamStatus>): Column<ReceiptRecord>[] {
  // Downstream comes right after Status — it is the reason that column exists (everything Dispatch
  // to Central / Receiving from Unit / Issue to Production used to show on their own pages).
  return [
    idColumn,
    arrivalColumn,
    supplierColumn,
    ficheColumn,
    vehicleColumn(siteSlug === "unit"),
    ...tailColumns,
    downstreamColumn(downstreamStatus),
    sourceColumn,
  ];
}
