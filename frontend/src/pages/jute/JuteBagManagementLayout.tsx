import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { Tabs, type TabItem } from "../../components/ui/Tabs";
import { ImportModal } from "../../components/ImportModal";
import { useTracking } from "../../state/TrackingContext";

/** Every workbook shape that lands on one of this section's five tabs — Warehouse Stock
 * (juteBagsMovement), Warehouse Transfers (juteWarehouseTransfer) and Warehouse Activity Ledger
 * (warehouseActivityLedger). Supplier Movement and Production Issue/Return have no importer of
 * their own yet (verified against backend/src/domain/imports/types.ts — nothing produces either
 * ledger from a workbook today), so they're not in this list. */
const JUTE_IMPORTER_IDS = ["juteBagsMovement", "juteWarehouseTransfer", "warehouseActivityLedger"];

const TABS: (TabItem & { lede: string })[] = [
  {
    to: "/jute/warehouse-stock",
    label: "Warehouse Stock",
    icon: "inventory_2",
    lede: "Running balance continues from the existing ledger.",
  },
  {
    to: "/jute/suppliers",
    label: "Supplier Movement",
    icon: "swap_horiz",
    lede: "Bags issued to suppliers, and what comes back with their deliveries.",
  },
  {
    to: "/jute/production",
    label: "Production Issue/Return",
    icon: "sync_alt",
    lede: "Bags issued to Production, and what's recovered — good, damaged, or repairable.",
  },
  {
    to: "/jute/transfers",
    label: "Warehouse Transfers",
    icon: "compare_arrows",
    lede: "Bag transfers between warehouses.",
  },
  {
    to: "/jute/warehouse-activity-ledger",
    label: "Warehouse Activity Ledger",
    icon: "receipt_long",
    lede: "Every logged warehouse activity — no site column in the source, so this list is unscoped.",
  },
];

/** The five jute/bag-ledger pages used to be five separate sidebar entries (see nav.ts); per
 * request they're now one "Jute Bag Management" section with a shared header + tab bar here and
 * each former page rendered through `<Outlet/>` — see App.tsx's nested /jute/* routes. URLs are
 * unchanged (still /jute/warehouse-stock, /jute/transfers, ...), so existing deep links (e.g.
 * ReceiptDetailPage's "Linked records" card, DashboardPage's balance tile, and
 * WarehouseTransfersPage's own ?warehouse= deep link from the Central nav) keep working as-is.
 *
 * Upload/Export also moved here from being three separate inline "Import from workbook" panels
 * (one each on Warehouse Stock, Warehouse Transfers, Warehouse Activity Ledger) — one global
 * entry point picking the workbook, same pattern as ReceiptsListPage's Upload/Export buttons,
 * rather than three near-identical panels scattered across tabs. */
export function JuteBagManagementLayout() {
  const { pathname } = useLocation();
  const { refresh } = useTracking();
  const [dialogMode, setDialogMode] = useState<"upload" | "export" | null>(null);
  // Bumped after a commit and used as the <Outlet/>'s key: the active tab's own data hook
  // (useJuteLedgerEntries / useWarehouseActivityLedger) only fetches on mount, and lives in
  // whichever tab component happens to be active — remounting it is simpler than threading a
  // refetch callback through every tab for a button that isn't tab-specific.
  const [refreshKey, setRefreshKey] = useState(0);
  const active = TABS.find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`)) ?? TABS[0];

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Jute Bag Management"
        title={active.label}
        lede={active.lede}
        actions={
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDialogMode("upload")}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-warmstone-200 text-warmstone-700 text-[13px] font-bold hover:bg-warmstone-50 transition-all shadow-xs"
            >
              <span className="material-symbols-outlined text-[17px]">upload</span>
              Upload
            </button>
            <button
              onClick={() => setDialogMode("export")}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-warmstone-200 text-warmstone-700 text-[13px] font-bold hover:bg-warmstone-50 transition-all shadow-xs"
              title="Pick a workbook to export or download a template for"
            >
              <span className="material-symbols-outlined text-[17px]">download</span>
              Export
            </button>
          </div>
        }
      />
      <Tabs items={TABS} />
      {dialogMode && (
        <ImportModal
          importerIds={JUTE_IMPORTER_IDS}
          mode={dialogMode}
          onClose={() => setDialogMode(null)}
          onCommitted={() => {
            void refresh();
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
      <Outlet key={refreshKey} />
    </div>
  );
}
