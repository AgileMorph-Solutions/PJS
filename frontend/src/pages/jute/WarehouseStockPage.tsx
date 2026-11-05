import { useState } from "react";
import { LedgerSection } from "../../components/LedgerSection";
import { OpeningStockField } from "../../components/jute/OpeningStockField";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { juteLedgers, juteReconciliationRule } from "../../data/juteBags";
import { useHasRole } from "../../state/AuthContext";
import { useActiveSite } from "../../state/SiteContext";
import { useJuteLedgerEntries, useTracking } from "../../state/TrackingContext";
import { SITES, SITE_LIST, type SiteSlug } from "../../config/sites";

const ledger = juteLedgers.find((l) => l.id === "warehouse-stock")!;

/** This ledger is 298 real rows (JUTE BAGS ISSUED), all "BOUAKE" today (Yakro has no
 * warehouse-stock ledger of its own — see the `transfer_in_has_no_ledger1_counterpart` finding),
 * but the filter still applies generically rather than being hardcoded to one site: a site column
 * genuinely exists on this ledger's own rows (WH location), unlike ledgers 2/3 below which have no
 * per-row site data at all yet (still a hand-tallied summary — see juteBags.ts's own flag text). */
export function WarehouseStockPage() {
  const [site, setSite] = useState<SiteSlug | "">("");
  const warehouseName = site ? SITES[site].warehouseName : undefined;
  const filtered = useJuteLedgerEntries(ledger.id, warehouseName);
  const activeSite = useActiveSite();
  const { refresh } = useTracking();
  // Only an Admin has the "All warehouses" view; everyone else is pinned to their own warehouse.
  const canSeeAll = useHasRole("admin");
  const selectedWarehouse = warehouseName ?? (canSeeAll ? undefined : activeSite.warehouseName);

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <SiteSwitcher value={site} onChange={setSite} allowAll />
      </div>
      <LedgerSection
        ledger={ledger}
        rows={site ? filtered.rows : undefined}
        onEntryAdded={() => site && filtered.refetch()}
        warehouse={{ column: "WH location", selected: selectedWarehouse, options: SITE_LIST.map((s) => s.warehouseName) }}
        aboveEntry={(
          <OpeningStockField
            warehouse={selectedWarehouse}
            onSelectWarehouse={setSite}
            onSaved={() => { void refresh(); if (site) void filtered.refetch(); }}
          />
        )}
      />
      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <h3 className="text-[17px] font-bold text-warmstone-900 mb-2">Reconciliation rule</h3>
        <p className="text-[13px] leading-relaxed text-warmstone-500">{juteReconciliationRule}</p>
      </div>
    </div>
  );
}
