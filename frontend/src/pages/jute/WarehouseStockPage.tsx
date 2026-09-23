import { PageHeader } from "../../components/ui/PageHeader";
import { LedgerSection } from "../../components/LedgerSection";
import { juteLedgers, juteReconciliationRule } from "../../data/juteBags";

const ledger = juteLedgers.find((l) => l.id === "warehouse-stock")!;

export function WarehouseStockPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Jute Bag Management"
        title="Warehouse Stock Ledger"
        lede="Running balance continues from the existing ledger."
      />
      <LedgerSection ledger={ledger} />
      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <h3 className="text-[17px] font-bold text-warmstone-900 mb-2">Reconciliation rule</h3>
        <p className="text-[13px] leading-relaxed text-warmstone-500">{juteReconciliationRule}</p>
      </div>
    </div>
  );
}
