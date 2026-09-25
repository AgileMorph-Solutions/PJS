import { useMemo } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { ImportPanel } from "../../components/ImportPanel";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { useTracking } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import type { ReceiptRecord } from "../../types/receipt";

/**
 * Lots & Bins is identical field-for-field at both sites (n-lot / n-bin are the same two stages in
 * stages.ts regardless of warehouse) — so unlike Receipts, there's no columns.ts split here; the
 * only per-site difference is which receipts are in scope.
 */
export function StockPage() {
  const { receipts, refresh } = useTracking();
  const site = useSite();
  const switchSite = useSwitchSite();
  const withLot = useMemo(
    () => receipts.filter((r) => r.warehouse === site.warehouseName && (r.stageData["n-lot"] || r.stageData["n-bin"])),
    [receipts, site.warehouseName]
  );

  const columns: Column<ReceiptRecord>[] = [
    { label: "Lot Number", render: (r) => <span className="font-mono text-[12.5px]">{r.stageData["n-lot"]?.["Lot Number"] || r.lotNo || "—"}</span> },
    { label: "Bin Number", render: (r) => <span className="font-mono text-[12.5px]">{r.stageData["n-bin"]?.["Bin Number"] || r.binNo || "—"}</span> },
    { label: "Vehicle", render: (r) => r.vehicleNo || "—" },
    { label: "Supplier", render: (r) => r.supplierName || "—" },
    { label: "Basis for Bin allocation", render: (r) => r.stageData["n-bin"]?.["Basis for allocation (moisture / quality / KOR / space)"] || "—" },
    { label: "Finalised", render: (r) => r.stageData["n-bin"]?.["Finalised (same day / next day)"] || "—" },
  ];

  return (
    <>
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Lots & Bins"
        lede="Lot = one truck. Bin = physical storage, and can hold several Lots."
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />

      <div className="mb-5">
        <CollapsibleCard title="Import from workbook">
          {site.slug === "unit" ? (
            // DISCHARGEMENT is where a Lot Number is actually ASSIGNED — this is the only import
            // that writes a real Lot onto a receipt (see the Lot write-back in
            // backend/src/services/imports.ts), so it lives on the one page that shows Lots.
            <ImportPanel importerId="warehouseDischarges" onCommitted={() => void refresh()} />
          ) : (
            <>
              <ImportPanel importerId="warehouseReceiving" onCommitted={() => void refresh()} />
              <p className="text-[12px] text-warmstone-400 mt-2.5">
                Stored verbatim for the record — unlike DISCHARGEMENT, this import does not assign a
                Lot onto a receipt, so committing it won't change the rows below.
              </p>
            </>
          )}
        </CollapsibleCard>
      </div>

      <DataTable
        columns={columns}
        rows={withLot}
        keyFn={(r) => r.id}
        rowHref={(r) => `/${site.slug}/receipts/${r.id}`}
        emptyTitle="No Lots or Bins assigned yet"
      />
    </>
  );
}
