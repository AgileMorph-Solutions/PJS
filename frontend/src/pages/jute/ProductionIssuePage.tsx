import { LedgerSection } from "../../components/LedgerSection";
import { juteLedgers } from "../../data/juteBags";

const ledger = juteLedgers.find((l) => l.id === "factory-production-tracking")!;

export function ProductionIssuePage() {
  return <LedgerSection ledger={ledger} />;
}
