import { PageHeader } from "../../components/ui/PageHeader";
import { LedgerSection } from "../../components/LedgerSection";
import { juteLedgers, juteReconciliationRule, juteFlowTouchpoints } from "../../data/juteBags";

const ledger = juteLedgers.find((l) => l.id === "warehouse-stock")!;

export function WarehouseStockPage() {
  return (
    <>
      <PageHeader
        kicker="Jute Bag Management"
        title="Warehouse Stock Ledger"
        lede="Backed by a real workbook. Add an entry and its running balance continues from the real sheet's own numbers."
      />
      <div className="callout">{juteFlowTouchpoints}</div>
      <LedgerSection ledger={ledger} />
      <div className="card">
        <h3 style={{ marginBottom: 10 }}>Reconciliation rule</h3>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink-soft)" }}>{juteReconciliationRule}</p>
      </div>
    </>
  );
}
