import { useMemo } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { ImportPanel } from "../../components/ImportPanel";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import { useWarehouseDispatches } from "../../state/TrackingContext";
import type { WarehouseDispatchLine } from "../../repository/api";

/**
 * Unit-only page — CHARGEMENT-derived dispatches out of Bouaké towards the central warehouse (see
 * backend/src/services/warehouseDispatches.ts). One row per sheet LINE, not per dispatch: a single
 * voyage (`vyogeNumber`) can span several source bins across several lines, and 120/544 real lines
 * have no S.No at all — grouping or filtering on S.No would silently drop them, so this stays a
 * flat per-line table, same shape the backend already serves.
 */
export function DispatchPage() {
  const site = useSite();
  const switchSite = useSwitchSite();
  const { lines, refetch } = useWarehouseDispatches(site.warehouseName);

  const voyageCount = useMemo(() => new Set(lines.map((l) => l.vyogeNumber).filter(Boolean)).size, [lines]);

  const columns: Column<WarehouseDispatchLine>[] = [
    { label: "Date", render: (l) => l.chargeDate || l.chargeDateRaw || "—" },
    { label: "Voyage No", render: (l) => <span className="font-mono text-[12.5px]">{l.vyogeNumber || "—"}</span> },
    { label: "Store", render: (l) => l.warehouse || "—" },
    { label: "Bin", render: (l) => l.bin || "—" },
    { label: "Truck No", render: (l) => l.truckNo || "—" },
    { label: "Transporter", render: (l) => l.transporter || "—" },
    { label: "Driver", render: (l) => l.driver || "—" },
    { label: "WH Receipt No", render: (l) => <span className="font-mono text-[12.5px]">{l.whReceiptNo || "—"}</span> },
    { label: "Bags (this line)", render: (l) => l.binwiseLoadedBags ?? "—" },
    { label: "Total bags", render: (l) => l.totalBags ?? "—" },
    { label: "Gross wt", render: (l) => l.grossWt ?? "—" },
    { label: "Net wt", render: (l) => l.netWeight ?? "—" },
    { label: "Status", render: (l) => l.status || l.unloadingStatus || "—" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Dispatch to Central"
        lede={`${lines.length} line${lines.length === 1 ? "" : "s"} across ${voyageCount} voyage${voyageCount === 1 ? "" : "s"} — CHARGEMENT, unit dispatch towards the central warehouse.`}
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />

      <CollapsibleCard title="Import from workbook">
        <ImportPanel importerId="warehouseDispatches" onCommitted={() => void refetch()} />
      </CollapsibleCard>

      <DataTable
        columns={columns}
        rows={lines}
        keyFn={(l) => l.id}
        emptyTitle="No dispatch lines recorded yet"
        emptyHint="Import a CHARGEMENT workbook above to populate this table."
      />
    </div>
  );
}
