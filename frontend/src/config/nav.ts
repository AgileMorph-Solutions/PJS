import type { SiteSlug } from "./sites";

export interface NavLeaf {
  label: string;
  /** Literal path — used for leaves that don't depend on which site is active. Exactly one of
   * `to`/`sitePath` should be set. */
  to?: string;
  /** A path segment resolved against whichever site is currently active (e.g. `"receipts"` becomes
   * `/unit/receipts` or `/central/receipts`) — see `AppNav.tsx` and `state/SiteContext.tsx`'s
   * `useActiveSite()`. Lets one nav leaf serve both sections instead of listing each one twice. */
  sitePath?: string;
  /** Only rendered while this site is the active one (e.g. "Dispatch to Central" only makes sense
   * at "unit") — so there's never a leaf you can click and get turned away from. */
  onlyForSite?: SiteSlug;
  /** Material Symbols Outlined icon name (e.g. "dashboard"). */
  icon: string;
  /** Match this route exactly, not by prefix — only the root "/" needs this. */
  end?: boolean;
  /** Short pill shown after the label, e.g. "Soon" for a page that's an intentional placeholder
   * (see ProductionPage.tsx) — so clicking into it isn't mistaken for a broken link. */
  badge?: string;
}

export interface NavSection {
  label: string;
  items: NavLeaf[];
}

export const NAV: NavSection[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", to: "/", icon: "dashboard", end: true }],
  },
  {
    // One section for both sites — which warehouse a `sitePath` leaf actually points at is
    // resolved per-render against the currently active site (see AppNav.tsx), switched from a
    // control on the page itself (components/SiteSwitcher.tsx), not by picking a different section
    // here. `onlyForSite` leaves (real at exactly one site) appear only while that site is active.
    label: "Warehouse",
    items: [
      { label: "Truck Reception", sitePath: "receipts", icon: "receipt_long" },
      { label: "Lots & Bins", sitePath: "stock", icon: "grid_view" },
      { label: "Drying", sitePath: "drying", icon: "wb_sunny" },
      { label: "Dispatch to Central", to: "/unit/dispatch", onlyForSite: "unit", icon: "local_shipping" },
      // Deliberately points at ledger 4 (Warehouse Transfers, already real, already
      // ?warehouse=-scopeable) rather than a new page — see App.tsx's routing comment.
      { label: "Receiving from Unit", to: "/jute/transfers?warehouse=YAKRO+FACTORY", onlyForSite: "central", icon: "call_received" },
      { label: "Issue to Production", to: "/central/issue-to-production", onlyForSite: "central", icon: "sync_alt" },
    ],
  },
  {
    // Matches every page in this section's own kicker ("Jute Bag Management") — the old label
    // ("Bag Management") didn't say jute, and this section sits right below the RCN/cashew
    // stock pages, which is exactly where that ambiguity bit. Stays top-level (not site-scoped)
    // because ledger 4 genuinely spans both sites for a single row — see
    // WarehouseTransfersPage's own in-page SiteSwitcher instead.
    label: "Jute Bag Management",
    items: [
      { label: "Warehouse Stock", to: "/jute/warehouse-stock", icon: "inventory_2" },
      { label: "Supplier Movement", to: "/jute/suppliers", icon: "swap_horiz" },
      { label: "Production Issue/Return", to: "/jute/production", icon: "sync_alt" },
      { label: "Warehouse Transfers", to: "/jute/transfers", icon: "compare_arrows" },
    ],
  },
  {
    // Reverted to the single placeholder entry on request — the BTM/Bin/Lot pages, backend
    // services, and seeded real data behind this section all still exist and work (see
    // frontend/src/pages/production/, backend/src/routes/production.ts); they're just not linked
    // from the sidebar while this is revisited. Un-reverting is: swap this one item back for the
    // list that was here (git history has it), no other code changes needed.
    label: "Production",
    items: [
      { label: "Production", to: "/production", icon: "precision_manufacturing", badge: "Soon" },
    ],
  },
  {
    label: "Masters",
    items: [
      { label: "Suppliers", to: "/masters/suppliers", icon: "groups" },
      { label: "Warehouses", to: "/masters/warehouses", icon: "domain" },
      { label: "Bins", to: "/masters/bins", icon: "inventory" },
    ],
  },
];
