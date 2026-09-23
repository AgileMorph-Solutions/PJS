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
        lede="Bags issued to suppliers, and what comes back with their deliveries."
      />
      <LedgerSection ledger={ledger} />
    </div>
  );
}
