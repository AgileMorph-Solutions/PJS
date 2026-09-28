import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { TrackingProvider, useTracking } from "./state/TrackingContext";
import { SiteLayout } from "./state/SiteContext";

import { DashboardPage } from "./pages/DashboardPage";
import { ProductionPage } from "./pages/ProductionPage";
import { BtmListPage } from "./pages/production/BtmListPage";
import { BtmDetailPage } from "./pages/production/BtmDetailPage";
import { ProductionBinsListPage } from "./pages/production/ProductionBinsListPage";
import { ProductionBinDetailPage } from "./pages/production/ProductionBinDetailPage";
import { LotsListPage } from "./pages/production/LotsListPage";
import { LotDetailPage } from "./pages/production/LotDetailPage";
import { StandaloneTablePage } from "./pages/production/StandaloneTablePage";

import { ReceiptsListPage } from "./pages/warehouse/ReceiptsListPage";
import { ReceiptDetailPage } from "./pages/warehouse/ReceiptDetailPage";
import { StockPage } from "./pages/warehouse/StockPage";
import { DryingJobsPage } from "./pages/warehouse/DryingJobsPage";
import { IntakeWizardPage } from "./pages/warehouse/intake/IntakeWizardPage";
import { LegacyListRedirect, LegacyReceiptDetailRedirect, LegacyIntakeRedirect } from "./pages/LegacyRedirects";

import { WarehouseStockPage } from "./pages/jute/WarehouseStockPage";
import { SupplierMovementPage } from "./pages/jute/SupplierMovementPage";
import { ProductionIssuePage } from "./pages/jute/ProductionIssuePage";
import { WarehouseTransfersPage } from "./pages/jute/WarehouseTransfersPage";

import { SuppliersPage } from "./pages/masters/SuppliersPage";
import { WarehousesPage } from "./pages/masters/WarehousesPage";
import { BinsPage } from "./pages/masters/BinsPage";
import { BinDetailPage } from "./pages/masters/BinDetailPage";

/** Holds the first render until the initial load finishes, so pages never flash an empty dataset.
 * /production/* is exempted: those pages fetch their own data independently (useBtmIntakes,
 * useProductionBins, ...), so a slow or erroring procurement load has no reason to block them. */
function LoadGate({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { loading, error, receipts } = useTracking();
  if (pathname.startsWith("/production")) return <>{children}</>;
  if (loading && receipts.length === 0) {
    return (
      <div className="p-10 space-y-4 animate-pulse">
        <div className="h-8 w-64 bg-warmstone-200 rounded-lg" />
        <div className="h-4 w-96 bg-warmstone-100 rounded-lg" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-warmstone-100 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }
  if (error && receipts.length === 0) {
    return (
      <div className="p-10 max-w-md">
        <div className="w-11 h-11 rounded-2xl bg-danger-100 text-danger-700 flex items-center justify-center mb-4">
          <span className="material-symbols-outlined">cloud_off</span>
        </div>
        <h2 className="text-lg font-bold text-warmstone-900 mb-1.5">Can't reach the server</h2>
        <p className="text-sm text-warmstone-500 leading-relaxed">{error}</p>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <TrackingProvider>
      <BrowserRouter>
        <Layout>
          <LoadGate>
          <Routes>
            <Route path="/" element={<DashboardPage />} />

            {/* One /:site/* tree for both sections (see state/SiteContext.tsx) — "/unit/receipts"
                and "/central/receipts" render the exact same components, scoped by useSite(), not
                two literal duplicated route trees. SiteLayout 404s on an unrecognized :site rather
                than silently rendering garbage. */}
            <Route path="/:site" element={<SiteLayout />}>
              <Route path="receipts" element={<ReceiptsListPage />} />
              <Route path="receipts/new/:id/:stageId" element={<IntakeWizardPage />} />
              {/* NOT forked per site — one receipt record, one page; a receipt detail page can
                  legitimately show cross-site linked records by design (see ReceiptDetailPage's own
                  header comment and receiptLinks.ts, whose /links route deliberately never accepts
                  ?warehouse=). Only the breadcrumb reads useSite(). */}
              <Route path="receipts/:id" element={<ReceiptDetailPage />} />
              <Route path="stock" element={<StockPage />} />
              <Route path="drying" element={<DryingJobsPage />} />
            </Route>

            {/* Legacy /procurement/* URLs — see pages/LegacyRedirects.tsx for exactly how each one
                resolves a site to redirect into. No "Receiving"/"Warehouse Receiving" legacy route
                existed pre-split (that page didn't exist yet), so there's nothing to redirect for
                it. */}
            <Route path="/procurement/receipts" element={<LegacyListRedirect leaf="receipts" />} />
            <Route path="/procurement/receipts/new/:id/:stageId" element={<LegacyIntakeRedirect />} />
            <Route path="/procurement/receipts/:id" element={<LegacyReceiptDetailRedirect />} />
            <Route path="/procurement/stock" element={<LegacyListRedirect leaf="stock" />} />
            <Route path="/procurement/drying" element={<LegacyListRedirect leaf="drying" />} />

            <Route path="/jute/warehouse-stock" element={<WarehouseStockPage />} />
            <Route path="/jute/suppliers" element={<SupplierMovementPage />} />
            <Route path="/jute/production" element={<ProductionIssuePage />} />
            <Route path="/jute/transfers" element={<WarehouseTransfersPage />} />

            <Route path="/production/btm" element={<BtmListPage />} />
            <Route path="/production/btm/:btmNo" element={<BtmDetailPage />} />
            <Route path="/production/bins" element={<ProductionBinsListPage />} />
            <Route path="/production/bins/:binNo" element={<ProductionBinDetailPage />} />
            <Route path="/production/lots" element={<LotsListPage />} />
            <Route path="/production/lots/:lotNo" element={<LotDetailPage />} />
            <Route path="/production/tables/:tableId" element={<StandaloneTablePage />} />
            {/* Not linked from nav right now (reverted to the "Soon" placeholder on request) — every
                route above still works if visited directly; only the sidebar entry point changed. */}
            <Route path="/production" element={<ProductionPage />} />

            <Route path="/masters/suppliers" element={<SuppliersPage />} />
            <Route path="/masters/warehouses" element={<WarehousesPage />} />
            <Route path="/masters/bins" element={<BinsPage />} />
            <Route path="/masters/bins/:binNo" element={<BinDetailPage />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </LoadGate>
        </Layout>
      </BrowserRouter>
    </TrackingProvider>
  );
}
