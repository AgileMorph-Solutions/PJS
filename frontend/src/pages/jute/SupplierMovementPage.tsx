import { LedgerSection } from "../../components/LedgerSection";
import { juteLedgers } from "../../data/juteBags";

const ledger = juteLedgers.find((l) => l.id === "supplier-movement")!;

export function SupplierMovementPage() {
  return <LedgerSection ledger={ledger} />;
}
