import { PageHeader } from "../../components/ui/PageHeader";
import { LedgerSection } from "../../components/LedgerSection";
import { juteLedgers } from "../../data/juteBags";

const ledger = juteLedgers.find((l) => l.id === "warehouse-to-warehouse-movement")!;

export function WarehouseTransfersPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Jute Bag Management"
        title="Warehouse Transfers"
        lede="Bag transfers between warehouses."
      />
      <LedgerSection ledger={ledger} />
    </div>
  );
}
