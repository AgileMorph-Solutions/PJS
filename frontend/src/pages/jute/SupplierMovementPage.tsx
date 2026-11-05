import { SUPPLIER_PENDING_COLUMN, supplierPendingPreview } from "@anagroci/contract/domain/jute";
import { LedgerSection } from "../../components/LedgerSection";
import { juteLedgers } from "../../data/juteBags";
import { useWarehouseChoices } from "../../state/useWarehouseChoices";

const ledger = juteLedgers.find((l) => l.id === "supplier-movement")!;

const HINT = "Total bags issued minus total bags returned, worked out automatically. A minus means more came back than were issued.";

export function SupplierMovementPage() {
  const { own, all } = useWarehouseChoices();
  return <LedgerSection ledger={ledger} warehouse={{ column: "Warehouse", selected: own ?? undefined, options: all }} calculatedField={{ column: SUPPLIER_PENDING_COLUMN, preview: supplierPendingPreview, hint: HINT }} />;
}
