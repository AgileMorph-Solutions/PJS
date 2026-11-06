import { LedgerSection } from "../../components/LedgerSection";
import { juteLedgers } from "../../data/juteBags";
import { useWarehouseChoices } from "../../state/useWarehouseChoices";

const ledger = juteLedgers.find((l) => l.id === "factory-production-tracking")!;

export function ProductionIssuePage() {
  const { own, all } = useWarehouseChoices();
  return <LedgerSection ledger={ledger} warehouse={{ column: "Warehouse", selected: own ?? undefined, options: all }} />;
}
