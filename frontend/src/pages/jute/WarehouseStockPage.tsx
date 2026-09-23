import { PageHeader } from "../../components/ui/PageHeader";
import { LedgerSection } from "../../components/LedgerSection";
import { CollapsibleCard } from "../../components/ui/CollapsibleCard";
import { ImportPanel } from "../../components/ImportPanel";
import { juteLedgers, juteReconciliationRule } from "../../data/juteBags";
import { useTracking } from "../../state/TrackingContext";

const ledger = juteLedgers.find((l) => l.id === "warehouse-stock")!;

export function WarehouseStockPage() {
  const { refresh } = useTracking();
  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Jute Bag Management"
        title="Warehouse Stock Ledger"
        lede="Running balance continues from the existing ledger."
      />
      <CollapsibleCard title="Import from workbook">
        <ImportPanel importerId="juteWarehouseStock" onCommitted={() => void refresh()} />
      </CollapsibleCard>
      <LedgerSection ledger={ledger} />
      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <h3 className="text-[17px] font-bold text-warmstone-900 mb-2">Reconciliation rule</h3>
        <p className="text-[13px] leading-relaxed text-warmstone-500">{juteReconciliationRule}</p>
      </div>
    </div>
  );
}
