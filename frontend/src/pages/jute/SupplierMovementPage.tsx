import { SUPPLIER_CURRENT_COLUMN, SUPPLIER_PENDING_COLUMN, supplierCurrentBalance, supplierPendingPreview } from "@anagroci/contract/domain/jute";
import { LedgerSection } from "../../components/LedgerSection";
import { juteLedgers } from "../../data/juteBags";
import { useWarehouseChoices } from "../../state/useWarehouseChoices";

const ledger = juteLedgers.find((l) => l.id === "supplier-movement")!;

const HINT = "Filled in for you: all bags issued to this supplier so far, including this entry, minus all bags returned. A minus means more came back than were issued. If a count shows a different number, type it here and later entries continue from it.";

const CALCULATED_FIELD = {
  column: SUPPLIER_PENDING_COLUMN,
  preview: supplierPendingPreview,
  hint: HINT,
  // Each row holds the balance as it stood after that entry, so "still with supplier" read as today's figure on older rows.
  tableHeader: "Balance after this entry",
  current: { header: SUPPLIER_CURRENT_COLUMN, read: supplierCurrentBalance },
};

export function SupplierMovementPage() {
  const { own, all } = useWarehouseChoices();
  return <LedgerSection ledger={ledger} warehouse={{ column: "Warehouse", selected: own ?? undefined, options: all }} calculatedField={CALCULATED_FIELD} />;
}
