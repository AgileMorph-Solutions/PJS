import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { TrackingProvider } from "./state/TrackingContext";

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

export default function App() {
  return (
    <TrackingProvider>
      <BrowserRouter>
        <Layout>
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
        </Layout>
      </BrowserRouter>
    </TrackingProvider>
  );
}
