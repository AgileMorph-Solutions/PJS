import type { Column } from "../../components/ui/DataTable";
import type { ReceiptRecord } from "../../types/receipt";
import type { SiteSlug } from "../../config/sites";
import { ReceiptStatusPill } from "../../components/ReceiptStatusPill";
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

const baseColumns: Column<ReceiptRecord>[] = [
  { label: "Receipt ID", render: (r) => <span className="font-mono text-[12.5px]">{r.id}</span> },
  { label: "Arrival date", render: (r) => r.arrivalDate || "—" },
  { label: "Supplier", render: (r) => r.supplierName || "—" },
  { label: "LBA code", render: (r) => <span className="font-mono text-[12.5px]">{r.lbaCode || "—"}</span> },
  { label: "Fiche", render: (r) => <span className="font-mono text-[12.5px]">{fiche(r) || "—"}</span> },
  { label: "Fiche code", render: (r) => <span className="font-mono text-[12.5px]">{verifyField(r, "FICHE CODE") || "—"}</span> },
  { label: "Ref.", render: (r) => <span className="font-mono text-[12.5px]">{verifyField(r, "REF.") || "—"}</span> },
  { label: "Vehicle", render: (r) => r.vehicleNo || "—" },
];

const tailColumns: Column<ReceiptRecord>[] = [
  { label: "Lot / Bin", render: (r) => `${r.lotNo || "—"} / ${r.binNo || "—"}` },
  { label: "Status", render: (r) => <ReceiptStatusPill status={deriveStatus(r)} /> },
  {
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
  },
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
export const RECEIPT_COLUMNS: Record<SiteSlug, Column<ReceiptRecord>[]> = {
  unit: [
    ...baseColumns,
    { label: "Store", render: (r) => <span className="font-mono text-[12.5px]">{storeCode(r) || "—"}</span> },
    ...tailColumns,
  ],
  central: [...baseColumns, ...tailColumns],
};
