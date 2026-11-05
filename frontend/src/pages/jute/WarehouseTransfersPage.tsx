import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LedgerSection } from "../../components/LedgerSection";
import { WarehouseFilter } from "../../components/jute/WarehouseFilter";
import { juteLedgers } from "../../data/juteBags";
import { useJuteLedgerEntries } from "../../state/TrackingContext";
import { useWarehouseChoices } from "../../state/useWarehouseChoices";

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
  const [params] = useSearchParams();
  const { own, all } = useWarehouseChoices();
  const [picked, setPicked] = useState(() => params.get("warehouse") ?? "");
  const filtered = useJuteLedgerEntries(ledger.id, picked || undefined);

  return (
    <div className="space-y-5">
      {!own && (
        <div className="flex justify-end">
          <WarehouseFilter value={picked} onChange={setPicked} warehouses={all} />
        </div>
      )}
      {/* Always a choice, never filled from the selected warehouse: the warehouse selected may be the one receiving this transfer. */}
      <LedgerSection
        ledger={ledger}
        rows={picked ? filtered.rows : undefined}
        onEntryAdded={() => picked && filtered.refetch()}
        warehouse={{ column: "Transfer -Bouake", options: all }}
      />
    </div>
  );
}
