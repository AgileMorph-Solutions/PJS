import { PageHeader } from "../../components/ui/PageHeader";
import { LedgerSection } from "../../components/LedgerSection";
import { juteLedgers } from "../../data/juteBags";

const ledger = juteLedgers.find((l) => l.id === "factory-production-tracking")!;

export function ProductionIssuePage() {
  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Jute Bag Management"
        title="Production Issue / Return"
        lede="Bags issued to Production, and what's recovered — good, damaged, or repairable."
      />
      <LedgerSection ledger={ledger} />
    </div>
  );
}
