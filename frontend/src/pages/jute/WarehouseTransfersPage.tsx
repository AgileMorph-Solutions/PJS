import { PageHeader } from "../../components/ui/PageHeader";
import { LedgerSection } from "../../components/LedgerSection";
import { juteLedgers } from "../../data/juteBags";

const ledger = juteLedgers.find((l) => l.id === "warehouse-to-warehouse-movement")!;

export function WarehouseTransfersPage() {
  return (
    <>
      <PageHeader
        kicker="Jute Bag Management"
        title="Warehouse Transfers"
        lede="A transfer reduces the source warehouse's stock and increases the destination's. The Warehouse Stock ledger already shows these leaving Bouaké as 'TRANSFFER TO YAMOUSSOUKRO' rows — nothing shows the matching receipt yet, so record it here."
      />
      <LedgerSection ledger={ledger} />
    </>
  );
}
