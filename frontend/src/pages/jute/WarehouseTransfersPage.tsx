import { PageHeader } from "../../components/ui/PageHeader";
import { LedgerSection } from "../../components/LedgerSection";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { ImportPanel } from "../../components/ImportPanel";
import { juteLedgers } from "../../data/juteBags";
import { useTracking } from "../../state/TrackingContext";

const ledger = juteLedgers.find((l) => l.id === "warehouse-to-warehouse-movement")!;

export function WarehouseTransfersPage() {
  const { refresh } = useTracking();
  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Jute Bag Management"
        title="Warehouse Transfers"
        lede="Bag transfers between warehouses."
      />
      <CollapsibleCard title="Import from workbook">
        <ImportPanel importerId="juteWarehouseTransfer" onCommitted={() => void refresh()} />
      </CollapsibleCard>
      <LedgerSection ledger={ledger} />
    </div>
  );
}
