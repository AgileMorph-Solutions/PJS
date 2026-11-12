import { useState } from "react";
import { LedgerSection } from "../../components/LedgerSection";
import { OpeningStockField } from "../../components/jute/OpeningStockField";
import { StockRegisterTable } from "../../components/jute/StockRegisterTable";
import { StockSummary } from "../../components/jute/StockSummary";
import { WarehouseFilter } from "../../components/jute/WarehouseFilter";
import { juteLedgers, juteReconciliationRule } from "../../data/juteBags";
import { useJuteLedgerEntries, useTracking } from "../../state/TrackingContext";
import { useWarehouseChoices } from "../../state/useWarehouseChoices";

const ledger = juteLedgers.find((l) => l.id === "warehouse-stock")!;

/** The warehouses come from the master (useWarehouseChoices): someone assigned to one sees that one, anyone else can filter
 * by any of them or see them all. */
export function WarehouseStockPage() {
  const { own, all } = useWarehouseChoices();
  const [picked, setPicked] = useState("");
  const selectedWarehouse = own ?? (picked || undefined);
  const filtered = useJuteLedgerEntries(ledger.id, selectedWarehouse);
  const { refresh } = useTracking();

  return (
    <div className="space-y-5">
      {!own && (
        <div className="flex justify-end">
          <WarehouseFilter value={picked} onChange={setPicked} warehouses={all} />
        </div>
      )}
      <LedgerSection
        ledger={ledger}
        rows={selectedWarehouse ? filtered.rows : undefined}
        onEntryAdded={() => selectedWarehouse && filtered.refetch()}
        warehouse={{ column: "WH location", selected: selectedWarehouse, options: all }}
        newestFirst
        renderTable={({ pageRows, allRows, emptyText }) => (
          <StockRegisterTable rows={pageRows} allRows={allRows} emptyText={emptyText} showWarehouse={!selectedWarehouse} />
        )}
        aboveEntry={(
          <>
          {selectedWarehouse && <StockSummary warehouse={selectedWarehouse} rows={filtered.rows} />}
          <OpeningStockField
            warehouse={selectedWarehouse}
            warehouses={all}
            onSelectWarehouse={setPicked}
            onSaved={() => { void refresh(); if (selectedWarehouse) void filtered.refetch(); }}
          />
          </>
        )}
      />
      <div className="bg-white border border-warmstone-200 rounded-2xl p-5 shadow-xs">
        <h3 className="text-[17px] font-bold text-warmstone-900 mb-2">Reconciliation rule</h3>
        <p className="text-[13px] leading-relaxed text-warmstone-500">{juteReconciliationRule}</p>
      </div>
    </div>
  );
}
