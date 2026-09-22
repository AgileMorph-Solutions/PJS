import { PageHeader } from "../../components/ui/PageHeader";
import { LedgerSection } from "../../components/LedgerSection";
import { juteLedgers } from "../../data/juteBags";

const ledger = juteLedgers.find((l) => l.id === "supplier-movement")!;

export function SupplierMovementPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Jute Bag Management"
        title="Supplier Movement"
        lede="Bags issued to suppliers in advance, and what comes back with their RCN deliveries. Not yet rolled up automatically from the Warehouse Stock ledger's supplier-issue rows — track it here for now."
      />
      <LedgerSection ledger={ledger} />
    </div>
  );
}
