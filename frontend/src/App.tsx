import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth, homePathFor } from "./state/AuthContext";
import { RequireRole } from "./components/RequireRole";
import { LoginPage } from "./pages/LoginPage";
import { UsersPage } from "./pages/admin/UsersPage";
import { ApprovalsPage } from "./pages/warehouse/ApprovalsPage";
import { BatchEntryPage } from "./pages/warehouse/BatchEntryPage";
import { SupplierAssignmentPage } from "./pages/masters/SupplierAssignmentPage";
import { MySuppliersPage } from "./pages/MySuppliersPage";
import { MySubmissionsPage } from "./pages/MySubmissionsPage";
import type { Role } from "./data/roles";
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
import { DispatchesPage } from "./pages/warehouse/DispatchesPage";
import { IssuedToProductionPage } from "./pages/warehouse/IssuedToProductionPage";
import { IntakeWizardPage } from "./pages/warehouse/intake/IntakeWizardPage";
import { LegacyListRedirect, LegacyReceiptDetailRedirect, LegacyIntakeRedirect } from "./pages/LegacyRedirects";

import { JuteBagManagementLayout } from "./pages/jute/JuteBagManagementLayout";
import { WarehouseStockPage } from "./pages/jute/WarehouseStockPage";
import { SupplierMovementPage } from "./pages/jute/SupplierMovementPage";
import { ProductionIssuePage } from "./pages/jute/ProductionIssuePage";
import { WarehouseTransfersPage } from "./pages/jute/WarehouseTransfersPage";
import { WarehouseActivityLedgerPage } from "./pages/jute/WarehouseActivityLedgerPage";

import { SuppliersPage } from "./pages/masters/SuppliersPage";
import { WarehousesPage } from "./pages/masters/WarehousesPage";
import { BinsPage } from "./pages/masters/BinsPage";
import { BinDetailPage } from "./pages/masters/BinDetailPage";

/** Everything a Branch Manager / QFS Officer can't reach; the API refuses it for them too. */
const REVIEWERS: Role[] = ["admin", "warehouse_incharge"];

/** Dashboard for admin / Warehouse Incharge; everyone else lands on their own Reception. */
function HomeRoute() {
  const { me } = useAuth();
  if (!me) return null;
  return REVIEWERS.includes(me.role) ? <DashboardPage /> : <Navigate to={homePathFor(me)} replace />;
}

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

function AppRoutes() {
  return (
          <Routes>
            <Route path="/" element={<HomeRoute />} />

            {/* One /:site/* tree for both sections (see state/SiteContext.tsx) — "/unit/receipts"
                and "/central/receipts" render the exact same components, scoped by useSite(), not
                two literal duplicated route trees. SiteLayout 404s on an unrecognized :site rather
                than silently rendering garbage. */}
            <Route path="/:site" element={<SiteLayout />}>
              <Route path="receipts" element={<ReceiptsListPage />} />
              {/* NOT forked per site — one receipt record, one page; a receipt detail page can
                  legitimately show cross-site linked records by design (see ReceiptDetailPage's own
                  header comment and receiptLinks.ts, whose /links route deliberately never accepts
                  ?warehouse=). Only the breadcrumb reads useSite(). */}
              <Route path="receipts/:id" element={<ReceiptDetailPage />} />
              <Route element={<RequireRole roles={REVIEWERS} />}>
                {/* Static, so it wins over the open `receipts/:id` above — "batch" is never an id. */}
                <Route path="receipts/batch" element={<BatchEntryPage />} />
                <Route path="receipts/new/:id/:stageId" element={<IntakeWizardPage />} />
                <Route path="stock" element={<StockPage />} />
                <Route path="drying" element={<DryingJobsPage />} />
              {/* Not in nav.ts (see its own comment) — reached from Reception's Downstream chips
                  and a receipt's "Linked records" card, same as the legacy /procurement/* URLs
                  below are reachable without a sidebar entry. */}
                <Route path="dispatches" element={<DispatchesPage />} />
              </Route>
            </Route>

            <Route element={<RequireRole roles={REVIEWERS} />}>
              {/* No site dimension on this table at all (see IssuedToProductionPage's own header
                  comment) — deliberately outside the /:site/* tree, unlike dispatches above. */}
              <Route path="/issued-to-production" element={<IssuedToProductionPage />} />

              {/* Legacy /procurement/* URLs — see pages/LegacyRedirects.tsx for exactly how each one
                  resolves a site to redirect into. No "Receiving"/"Warehouse Receiving" legacy route
                  existed pre-split (that page didn't exist yet), so there's nothing to redirect for
                  it. */}
              <Route path="/procurement/receipts" element={<LegacyListRedirect leaf="receipts" />} />
              <Route path="/procurement/receipts/new/:id/:stageId" element={<LegacyIntakeRedirect />} />
              <Route path="/procurement/receipts/:id" element={<LegacyReceiptDetailRedirect />} />
              <Route path="/procurement/stock" element={<LegacyListRedirect leaf="stock" />} />
              <Route path="/procurement/drying" element={<LegacyListRedirect leaf="drying" />} />

              {/* One "Jute Bag Management" section (was five separate sidebar entries/pages) — shared
                  header + tab bar in JuteBagManagementLayout, each former page rendered via
                  <Outlet/>. Leaf paths are unchanged, so existing deep links elsewhere in the app
                  (ReceiptDetailPage, DashboardPage, WarehouseTransfersPage's own ?warehouse=) still
                  resolve exactly as before. */}
              <Route path="/jute" element={<JuteBagManagementLayout />}>
                <Route index element={<Navigate to="warehouse-stock" replace />} />
                <Route path="warehouse-stock" element={<WarehouseStockPage />} />
                <Route path="suppliers" element={<SupplierMovementPage />} />
                <Route path="production" element={<ProductionIssuePage />} />
                <Route path="transfers" element={<WarehouseTransfersPage />} />
                <Route path="warehouse-activity-ledger" element={<WarehouseActivityLedgerPage />} />
              </Route>

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
              <Route path="/approvals" element={<ApprovalsPage />} />
              <Route path="/supplier-assignment" element={<SupplierAssignmentPage />} />
            </Route>

            <Route element={<RequireRole roles={["branch_manager"]} />}>
              <Route path="/my-suppliers" element={<MySuppliersPage />} />
            </Route>
            <Route element={<RequireRole roles={["branch_manager", "qfs_officer"]} />}>
              <Route path="/my-submissions" element={<MySubmissionsPage />} />
            </Route>
            <Route element={<RequireRole roles={["admin"]} />}>
              <Route path="/admin/users" element={<UsersPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
  );
}

/** Signed-out → login form; signed-in → the app. TrackingProvider is keyed by user id so signing
 * out and back in as someone else can never show the previous user's loaded data. */
function AuthGate() {
  const { status, me } = useAuth();
  if (status === "loading") return <div className="min-h-screen bg-warmstone-50" aria-busy="true" />;
  if (status === "anonymous" || !me) return <LoginPage />;
  return (
    <TrackingProvider key={me.id}>
      <Layout>
        <LoadGate>
          <AppRoutes />
        </LoadGate>
      </Layout>
    </TrackingProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AuthGate />
      </BrowserRouter>
    </AuthProvider>
  );
}
