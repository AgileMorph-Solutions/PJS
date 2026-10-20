import { useMemo, useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { FilterBar } from "../../components/ui/FilterBar";
import { useTableSearch } from "../../components/ui/useTableSearch";
import { useDateRangeFilter } from "../../components/ui/useDateRangeFilter";
import { DateRangeInputs } from "../../components/ui/DateRangeInputs";
import { WorkbookModal } from "../../components/WorkbookModal";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { RecordDetailModal } from "../../components/ui/RecordDetailModal";
import { useTracking, useWarehouseDischarges } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import type { ReceiptRecord } from "../../types/receipt";
import type { WarehouseDischargeRow } from "../../repository/api";
import { normalizeSupplierName } from "@anagroci/contract/domain/supplierCode";
import { formatDate } from "@anagroci/contract/domain/dateFormat";

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
  const [dialogMode, setDialogMode] = useState<"upload" | "export" | null>(null);
  const withLot = useMemo(
    () => receipts.filter((r) => r.warehouse === site.warehouseName && (r.stageData["n-lot"] || r.stageData["n-bin"])),
    [receipts, site.warehouseName]
  );

  const dischargeColumns: Column<WarehouseDischargeRow>[] = [
    { label: "SN", filter: { value: (d) => d.sn, kind: "number" }, render: (d) => <span className="font-mono text-[12.5px]">{d.sn}</span> },
    { label: "Lot No", render: (d) => <span className="font-mono text-[12.5px]">{d.lotNo}</span> },
    { label: "Warehouse", filter: { value: (d) => d.warehouseSite }, render: (d) => d.warehouseSite },
    { label: "Fiche CCA", render: (d) => <span className="font-mono text-[12.5px]">{d.ficheCca}</span> },
    { label: "Arrival date", filter: { value: (d) => d.arrivalDate || d.arrivalDateRaw, kind: "date" }, render: (d) => formatDate(d.arrivalDate || d.arrivalDateRaw) || "-" },
    { label: "Discharge date", filter: { value: (d) => d.dischargeDate || d.dischargeDateRaw, kind: "date" }, render: (d) => formatDate(d.dischargeDate || d.dischargeDateRaw) || "-" },
    { label: "Total recd", filter: { value: (d) => d.totalRecd, kind: "number" }, render: (d) => d.totalRecd ?? "-" },
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
    { label: "Lot Number", render: (r) => <span className="font-mono text-[12.5px]">{r.stageData["n-lot"]?.["Lot Number"] || r.lotNo || "-"}</span> },
    { label: "Bin Number", render: (r) => <span className="font-mono text-[12.5px]">{r.stageData["n-bin"]?.["Bin Number"] || r.binNo || "-"}</span> },
    { label: "Vehicle", render: (r) => r.vehicleNo || "-" },
    { label: "Supplier", filter: { value: (r) => normalizeSupplierName(r.supplierName) }, render: (r) => normalizeSupplierName(r.supplierName) || "-" },
    { label: "Basis for Bin allocation", filter: { value: (r) => r.stageData["n-bin"]?.["Basis for allocation (moisture / quality / KOR / space)"] }, render: (r) => r.stageData["n-bin"]?.["Basis for allocation (moisture / quality / KOR / space)"] || "-" },
    { label: "Finalised", filter: { value: (r) => r.stageData["n-bin"]?.["Finalised (same day / next day)"] }, render: (r) => r.stageData["n-bin"]?.["Finalised (same day / next day)"] || "-" },
  ];

  const lotsSearch = useTableSearch(withLot, (r) => [
    r.stageData["n-lot"]?.["Lot Number"] || r.lotNo,
    r.stageData["n-bin"]?.["Bin Number"] || r.binNo,
    r.vehicleNo,
    r.supplierName,
  ]);
  const dischargeDateFilter = useDateRangeFilter(discharges, (d) => d.arrivalDate);
  const dischargeSearch = useTableSearch(dischargeDateFilter.filtered, (d) => [d.lotNo, d.ficheCca, d.warehouseSite]);

  return (
    <>
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Lots & Bins"
        lede="Lot = one truck. Bin = physical storage, and can hold several Lots."
        actions={
          <div className="flex items-center gap-3">
            <SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />
            <button
              onClick={() => setDialogMode("upload")}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-warmstone-200 text-warmstone-700 text-[13px] font-bold hover:bg-warmstone-50 transition-all shadow-xs"
            >
              <span className="material-symbols-outlined text-[17px]">upload</span>
              Upload
            </button>
            <button
              onClick={() => setDialogMode("export")}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-warmstone-200 text-warmstone-700 text-[13px] font-bold hover:bg-warmstone-50 transition-all shadow-xs"
              title="Download the ANAGROCI workbook for this warehouse"
            >
              <span className="material-symbols-outlined text-[17px]">download</span>
              Export
            </button>
          </div>
        }
      />

      {dialogMode && (
        <WorkbookModal
          mode={dialogMode}
          warehouse={site.warehouseName}
          sectionLabel={`${site.label} · ${site.sublabel}`}
          onClose={() => setDialogMode(null)}
          onCommitted={() => { void refresh(); void refetchDischarges(); }}
        />
      )}

      <FilterBar>
        <input
          placeholder="Search Lot No, Bin No, vehicle, supplier…"
          value={lotsSearch.q}
          onChange={(e) => lotsSearch.setQ(e.target.value)}
          className="w-full sm:w-64"
        />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={lotsSearch.filtered}
        keyFn={(r) => r.id}
        rowHref={(r) => `/${site.slug}/receipts/${r.id}`}
        emptyTitle="No Lots or Bins assigned yet"
      />

      <div className="mt-8">
        <h2 className="text-base font-bold text-warmstone-900 mb-1">Raw discharge / receiving rows</h2>
        <p className="text-[12.5px] text-warmstone-500 mb-3">
          Every real column DISCHARGEMENT/Warehouse Receiving stores, not just what's already
          written onto a receipt above - including the two quality-inspection panels.
        </p>
        <FilterBar>
          <input
            placeholder="Search Lot No, Fiche CCA, warehouse…"
            value={dischargeSearch.q}
            onChange={(e) => dischargeSearch.setQ(e.target.value)}
            className="w-full sm:w-64"
          />
          <DateRangeInputs value={dischargeDateFilter.range} onChange={dischargeDateFilter.setRange} />
        </FilterBar>
        <DataTable
          columns={dischargeColumns}
          rows={dischargeSearch.filtered}
          keyFn={(d) => d.id}
          emptyTitle="No discharge/receiving rows imported yet"
        />
      </div>

      {detail && (
        <RecordDetailModal title={`Discharge - Lot ${detail.lotNo}`} record={detail} onClose={() => setDetail(null)} />
      )}
    </>
  );
}
