import { useMemo, useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { ImportPanel } from "../../components/ImportPanel";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { RecordDetailModal } from "../../components/ui/RecordDetailModal";
import { useTracking, useWarehouseDischarges } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import type { ReceiptRecord } from "../../types/receipt";
import type { WarehouseDischargeRow } from "../../repository/api";

/**
 * Lots & Bins is identical field-for-field at both sites (n-lot / n-bin are the same two stages in
 * stages.ts regardless of warehouse) — so unlike Receipts, there's no columns.ts split here; the
 * only per-site difference is which receipts are in scope.
 */
export function StockPage() {
  const { receipts, refresh } = useTracking();
  const site = useSite();
  const switchSite = useSwitchSite();
  const { rows: discharges, refetch: refetchDischarges } = useWarehouseDischarges(site.warehouseName);
  const [detail, setDetail] = useState<WarehouseDischargeRow | null>(null);
  const withLot = useMemo(
    () => receipts.filter((r) => r.warehouse === site.warehouseName && (r.stageData["n-lot"] || r.stageData["n-bin"])),
    [receipts, site.warehouseName]
  );

  const dischargeColumns: Column<WarehouseDischargeRow>[] = [
    { label: "SN", render: (d) => <span className="font-mono text-[12.5px]">{d.sn}</span> },
    { label: "Lot No", render: (d) => <span className="font-mono text-[12.5px]">{d.lotNo}</span> },
    { label: "Warehouse", render: (d) => d.warehouseSite },
    { label: "Fiche CCA", render: (d) => <span className="font-mono text-[12.5px]">{d.ficheCca}</span> },
    { label: "Arrival date", render: (d) => d.arrivalDate || d.arrivalDateRaw || "—" },
    { label: "Discharge date", render: (d) => d.dischargeDate || d.dischargeDateRaw || "—" },
    { label: "Total recd", render: (d) => d.totalRecd ?? "—" },
    {
      label: "",
      render: (d) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDetail(d); }}
          className="text-[11.5px] font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap"
        >
          View all fields
        </button>
      ),
    },
  ];

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
            <ImportPanel
              importerId="warehouseDischarges"
              onCommitted={() => { void refresh(); void refetchDischarges(); }}
            />
          ) : (
            <>
              <ImportPanel
                importerId="warehouseReceiving"
                onCommitted={() => { void refresh(); void refetchDischarges(); }}
              />
              <p className="text-[12px] text-warmstone-400 mt-2.5">
                Stored verbatim for the record — unlike DISCHARGEMENT, this import does not assign a
                Lot onto a receipt, so committing it won't change the Lots/Bins table below (it DOES
                add rows to the raw discharge/receiving table further down).
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

      <div className="mt-8">
        <h2 className="text-base font-bold text-warmstone-900 mb-1">Raw discharge / receiving rows</h2>
        <p className="text-[12.5px] text-warmstone-500 mb-3">
          Every real column DISCHARGEMENT/Warehouse Receiving stores, not just what's already
          written onto a receipt above — including the two quality-inspection panels.
        </p>
        <DataTable
          columns={dischargeColumns}
          rows={discharges}
          keyFn={(d) => d.id}
          emptyTitle="No discharge/receiving rows imported yet"
        />
      </div>

      {detail && (
        <RecordDetailModal title={`Discharge — Lot ${detail.lotNo}`} record={detail} onClose={() => setDetail(null)} />
      )}
    </>
  );
}
