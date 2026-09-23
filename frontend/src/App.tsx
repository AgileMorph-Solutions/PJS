import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { TrackingProvider, useTracking } from "./state/TrackingContext";

import { DashboardPage } from "./pages/DashboardPage";
import { ProductionPage } from "./pages/ProductionPage";

import { ReceiptsListPage } from "./pages/procurement/ReceiptsListPage";
import { ReceiptDetailPage } from "./pages/procurement/ReceiptDetailPage";
import { StockPage } from "./pages/procurement/StockPage";
import { DryingJobsPage } from "./pages/procurement/DryingJobsPage";
import { IntakeWizardPage } from "./pages/procurement/intake/IntakeWizardPage";

import { WarehouseStockPage } from "./pages/jute/WarehouseStockPage";
import { SupplierMovementPage } from "./pages/jute/SupplierMovementPage";
import { ProductionIssuePage } from "./pages/jute/ProductionIssuePage";
import { WarehouseTransfersPage } from "./pages/jute/WarehouseTransfersPage";

import { SuppliersPage } from "./pages/masters/SuppliersPage";
import { WarehousesPage } from "./pages/masters/WarehousesPage";
import { BinsPage } from "./pages/masters/BinsPage";
import { BinDetailPage } from "./pages/masters/BinDetailPage";

/** Holds the first render until the initial load finishes, so pages never flash an empty dataset. */
function LoadGate({ children }: { children: React.ReactNode }) {
  const { loading, error, receipts } = useTracking();
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

            <Route path="/procurement/receipts" element={<ReceiptsListPage />} />
            <Route path="/procurement/receipts/new/:id/:stageId" element={<IntakeWizardPage />} />
            <Route path="/procurement/receipts/:id" element={<ReceiptDetailPage />} />
            <Route path="/procurement/stock" element={<StockPage />} />
            <Route path="/procurement/drying" element={<DryingJobsPage />} />

            <Route path="/jute/warehouse-stock" element={<WarehouseStockPage />} />
            <Route path="/jute/suppliers" element={<SupplierMovementPage />} />
            <Route path="/jute/production" element={<ProductionIssuePage />} />
            <Route path="/jute/transfers" element={<WarehouseTransfersPage />} />

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
