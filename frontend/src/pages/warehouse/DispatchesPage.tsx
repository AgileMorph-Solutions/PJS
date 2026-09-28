import { useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { RecordDetailModal } from "../../components/ui/RecordDetailModal";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { useWarehouseDispatches } from "../../state/TrackingContext";
import { useSite, useSwitchSite } from "../../state/SiteContext";
import type { WarehouseDispatchLine } from "../../repository/api";

/**
 * CHARGEMENT — unit-warehouse dispatch OUT, one row per sheet LINE (a voyage may span several
 * lines; see WarehouseDispatchLine's own schema comment). Reachable from Reception's Downstream
 * "Dispatched" chip and a receipt's "Linked records" card, deliberately not a sidebar item — see
 * config/nav.ts's header comment on why Dispatch/Receiving/Issue-to-Production stay out of the
 * Warehouse section now that their data shows on Reception instead.
 */
export function DispatchesPage() {
  const site = useSite();
  const switchSite = useSwitchSite();
  const { lines } = useWarehouseDispatches(site.warehouseName);
  const [detail, setDetail] = useState<WarehouseDispatchLine | null>(null);

  const columns: Column<WarehouseDispatchLine>[] = [
    { label: "SN", render: (l) => <span className="font-mono text-[12.5px]">{l.sn ?? "—"}</span> },
    { label: "Charge date", render: (l) => l.chargeDate || l.chargeDateRaw || "—" },
    { label: "Voyage no.", render: (l) => l.vyogeNumber || "—" },
    { label: "Bin", render: (l) => l.bin || "—" },
    { label: "Truck no.", render: (l) => l.truckNo || "—" },
    { label: "Fiche CCA", render: (l) => <span className="font-mono text-[12.5px]">{l.ficheCca || "—"}</span> },
    { label: "Total bags", render: (l) => l.totalBags ?? "—" },
    { label: "Status", render: (l) => l.status || "—" },
    {
      label: "",
      render: (l) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDetail(l); }}
          className="text-[11.5px] font-semibold text-brand-700 hover:text-brand-800 whitespace-nowrap"
        >
          View all fields
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        kicker={`${site.label} · ${site.sublabel}`}
        title="Dispatches"
        lede="CHARGEMENT — every unit-warehouse dispatch line, one row per sheet line."
        actions={<SiteSwitcher value={site.slug} onChange={(s) => s && switchSite(s)} />}
      />
      <DataTable
        columns={columns}
        rows={lines}
        keyFn={(l) => l.id}
        emptyTitle="No dispatch lines at this site"
        emptyHint="CHARGEMENT is a unit-warehouse (Bouaké) sheet — the central section has none."
      />
      {detail && (
        <RecordDetailModal title={`Dispatch — SN ${detail.sn ?? "—"}`} record={detail} onClose={() => setDetail(null)} />
      )}
    </>
  );
}
