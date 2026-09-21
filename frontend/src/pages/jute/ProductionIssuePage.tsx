import { PageHeader } from "../../components/ui/PageHeader";
import { LedgerSection } from "../../components/LedgerSection";
import { juteLedgers } from "../../data/juteBags";

const ledger = juteLedgers.find((l) => l.id === "factory-production-tracking")!;

export function ProductionIssuePage() {
  return (
    <>
      <PageHeader
        kicker="Jute Bag Management"
        title="Production Issue / Return"
        lede="Bags the Factory Warehouse issues to Production for processing, and what's recovered — good, damaged, and repairable."
      />
      <LedgerSection ledger={ledger} />
    </>
  );
}
