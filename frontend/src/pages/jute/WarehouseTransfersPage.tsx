import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { LedgerSection } from "../../components/LedgerSection";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { ImportPanel } from "../../components/ImportPanel";
import { SiteSwitcher } from "../../components/SiteSwitcher";
import { juteLedgers } from "../../data/juteBags";
import { useTracking, useJuteLedgerEntries } from "../../state/TrackingContext";
import { SITES, siteSlugForWarehouse, type SiteSlug } from "../../config/sites";

const ledger = juteLedgers.find((l) => l.id === "warehouse-to-warehouse-movement")!;

/** Ledger 4 genuinely spans both sites for a single row (source warehouse dispatches, destination
 * warehouse receives — see backend/src/domain/site.ts and the "Receiving from Unit" nav item under
 * Central Warehouse, which deep-links here with ?warehouse=YAKRO+FACTORY pre-filled). That's why
 * this stays one top-level page with its own site selector rather than being forked into the
 * /:site/* tree — a transfer TO central genuinely belongs to both sections at once, and the
 * backend's resolveSite()-backed filter already matches "if EITHER side is in scope", which a
 * client-side filter over the already-loaded rows can't reproduce (this ledger doesn't even expose
 * a warehouse column to the client — see api.ts's listLedgerEntries comment). */
export function WarehouseTransfersPage() {
  const { refresh } = useTracking();
  const [params] = useSearchParams();
  const [site, setSite] = useState<SiteSlug | "">(() => siteSlugForWarehouse(params.get("warehouse") ?? "") ?? "");
  const warehouseName = site ? SITES[site].warehouseName : undefined;
  const filtered = useJuteLedgerEntries(ledger.id, warehouseName);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Jute Bag Management"
        title="Warehouse Transfers"
        lede="Bag transfers between warehouses."
        actions={<SiteSwitcher value={site} onChange={setSite} allowAll />}
      />
      <CollapsibleCard title="Import from workbook">
        <ImportPanel importerId="juteWarehouseTransfer" onCommitted={() => void refresh()} />
      </CollapsibleCard>
      <LedgerSection ledger={ledger} rows={site ? filtered.rows : undefined} onEntryAdded={() => site && filtered.refetch()} />
    </div>
  );
}
