import { SUPPLIER_PENDING_COLUMN, supplierPendingPreview } from "@anagroci/contract/domain/jute";
import { LedgerSection } from "../../components/LedgerSection";
import { juteLedgers } from "../../data/juteBags";

const ledger = juteLedgers.find((l) => l.id === "supplier-movement")!;

const HINT = "Total bags issued minus total bags returned, worked out automatically. A minus means more came back than were issued.";

export function SupplierMovementPage() {
  return <LedgerSection ledger={ledger} calculatedField={{ column: SUPPLIER_PENDING_COLUMN, preview: supplierPendingPreview, hint: HINT }} />;
}
