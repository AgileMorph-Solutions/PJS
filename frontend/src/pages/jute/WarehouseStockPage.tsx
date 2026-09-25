import { useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { LedgerSection } from "../../components/LedgerSection";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { ImportPanel } from "../../components/ImportPanel";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { juteLedgers, juteReconciliationRule } from "../../data/juteBags";
import { useTracking, useJuteLedgerEntries } from "../../state/TrackingContext";
import { SITES, type SiteSlug } from "../../config/sites";

const ledger = juteLedgers.find((l) => l.id === "warehouse-stock")!;

/** This ledger is 298 real rows (JUTE BAGS ISSUED), all "BOUAKE" today (Yakro has no
 * warehouse-stock ledger of its own — see the `transfer_in_has_no_ledger1_counterpart` finding),
 * but the filter still applies generically rather than being hardcoded to one site: a site column
 * genuinely exists on this ledger's own rows (WH location), unlike ledgers 2/3 below which have no
 * per-row site data at all yet (still a hand-tallied summary — see juteBags.ts's own flag text). */
export function WarehouseStockPage() {
  const { refresh } = useTracking();
  const [site, setSite] = useState<SiteSlug | "">("");
  const warehouseName = site ? SITES[site].warehouseName : undefined;
  const filtered = useJuteLedgerEntries(ledger.id, warehouseName);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Jute Bag Management"
        title="Warehouse Stock Ledger"
        lede="Running balance continues from the existing ledger."
        actions={<SiteSwitcher value={site} onChange={setSite} allowAll />}
      />
      <CollapsibleCard title="Import from workbook">
        <ImportPanel importerId="juteBagsMovement" onCommitted={() => void refresh()} />
      </CollapsibleCard>
      <LedgerSection ledger={ledger} rows={site ? filtered.rows : undefined} onEntryAdded={() => site && filtered.refetch()} />
      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <h3 className="text-[17px] font-bold text-warmstone-900 mb-2">Reconciliation rule</h3>
        <p className="text-[13px] leading-relaxed text-warmstone-500">{juteReconciliationRule}</p>
      </div>
    </div>
  );
}
