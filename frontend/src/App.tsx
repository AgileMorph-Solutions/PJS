import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { TrackingProvider, useTracking } from "./state/TrackingContext";

import { DashboardPage } from "./pages/DashboardPage";
import { ProductionPage } from "./pages/ProductionPage";

import { ReceiptsListPage } from "./pages/procurement/ReceiptsListPage";
import { ReceiptDetailPage } from "./pages/procurement/ReceiptDetailPage";
import { DeliveryPlansPage } from "./pages/procurement/DeliveryPlansPage";
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

/** Holds the first render until the initial load finishes, so pages never flash an empty dataset. */
function LoadGate({ children }: { children: React.ReactNode }) {
  const { loading, error, receipts } = useTracking();
  if (loading && receipts.length === 0) {
    return <div style={{ padding: 32, color: "var(--ink-soft)" }}>Loading…</div>;
  }
  if (error && receipts.length === 0) {
    return (
      <div style={{ padding: 32 }}>
        <h2 style={{ marginBottom: 8 }}>Can't reach the server</h2>
        <p className="stage-note">{error}</p>
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
            <Route path="/procurement/delivery-plans" element={<DeliveryPlansPage />} />
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

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </LoadGate>
        </Layout>
      </BrowserRouter>
    </TrackingProvider>
  );
}
