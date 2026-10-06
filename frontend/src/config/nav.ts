import type { Role } from "../data/roles";

export interface NavLeaf {
  label: string;
  /** Literal path — used for leaves that don't depend on which site is active. Exactly one of
   * `to`/`sitePath` should be set. */
  to?: string;
  /** A path segment resolved against whichever site is currently active (e.g. `"receipts"` becomes
   * `/unit/receipts` or `/central/receipts`) — see `AppNav.tsx` and `state/SiteContext.tsx`'s
   * `useActiveSite()`. Lets one nav leaf serve both sections instead of listing each one twice. */
  sitePath?: string;
  /** Material Symbols Outlined icon name (e.g. "dashboard"). */
  icon: string;
  /** Match this route exactly, not by prefix — only the root "/" needs this. */
  end?: boolean;
  /** Short pill shown after the label, e.g. "Soon" for a page that's an intentional placeholder
   * (see ProductionPage.tsx) — so clicking into it isn't mistaken for a broken link. */
  badge?: string;
  /** Who sees this item. Omitted = every signed-in role. The API is the real gate (see
   * backend/src/auth/policy.ts); this only keeps people from seeing links that would 403. */
  roles?: Role[];
}

export interface NavSection {
  label: string;
  items: NavLeaf[];
}

export const NAV: NavSection[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", to: "/", icon: "dashboard", end: true, roles: ["admin", "warehouse_incharge"] }],
  },
  {
    // One section for both sites — which warehouse a `sitePath` leaf actually points at is
    // resolved per-render against the currently active site (see AppNav.tsx), switched from a
    // control on the page itself (components/SiteSwitcher.tsx). Dispatch to Central, Receiving from
    // Unit and Issue to Production used to be separate pages here; their data is now viewable from
    // Reception instead (a status column plus upload panels for each of those workbooks — see
    // ReceiptsListPage.tsx) so they no longer need their own sidebar entries. Delivery plans and
    // Transfers (Oct 2026) are the two new ones: planning before a truck arrives, and moving Lots on.
    //
    // Lots & Bins, Drying and Transfers (/:site/stock, /drying, /transfers) are deliberately not
    // linked any more (Oct 2026): a Lot's bin, drying and movement are all on its Reception detail
    // page. The routes and pages still exist — to bring one back, add its leaf here again.
    label: "Warehouse",
    items: [
      { label: "Delivery plans", sitePath: "delivery-plans", icon: "event_upcoming", roles: ["admin", "warehouse_incharge"] },
      { label: "Reception", sitePath: "receipts", icon: "receipt_long" },
    ],
  },
  {
    // Matches every page in this section's own kicker ("Jute Bag Management") — the old label
    // ("Bag Management") didn't say jute, and this section sits right below the RCN/cashew
    // stock pages, which is exactly where that ambiguity bit. Stays top-level (not site-scoped)
    // because ledger 4 genuinely spans both sites for a single row — see
    // WarehouseTransfersPage's own in-page SiteSwitcher instead.
    //
    // A single leaf now, not five: Warehouse Stock / Supplier Movement / Production Issue-Return
    // / Warehouse Transfers / Warehouse Activity Ledger used to be five separate sidebar entries
    // and pages, which read as unrelated sections even though they're all views over the same
    // four jute ledgers + one activity log. They're one page now (JuteBagManagementLayout, with a
    // tab bar) at the same leaf URLs, so one nav entry (`to: "/jute"`, not `end`) lights up for
    // all five — see AppNav.tsx's isItemActive prefix match.
    label: "Jute Bag Management",
    items: [{ label: "Jute Bag Management", to: "/jute", icon: "inventory_2", roles: ["admin", "warehouse_incharge"] }],
  },
  {
    // Reverted to the single placeholder entry on request — the BTM/Bin/Lot pages, backend
    // services, and seeded real data behind this section all still exist and work (see
    // frontend/src/pages/production/, backend/src/routes/production.ts); they're just not linked
    // from the sidebar while this is revisited. Un-reverting is: swap this one item back for the
    // list that was here (git history has it), no other code changes needed.
    label: "Production",
    items: [
      { label: "Production", to: "/production", icon: "precision_manufacturing", badge: "Soon", roles: ["admin", "warehouse_incharge"] },
    ],
  },
  {
    label: "Masters",
    items: [
      { label: "Suppliers", to: "/masters/suppliers", icon: "groups", roles: ["admin", "warehouse_incharge"] },
      { label: "Warehouses", to: "/masters/warehouses", icon: "domain", roles: ["admin", "warehouse_incharge"] },
      { label: "Bins", to: "/masters/bins", icon: "inventory", roles: ["admin", "warehouse_incharge"] },
    ],
  },
  {
    // Where the approval flow lives. Warehouse Incharge approves BM/QFS submissions and assigns
    // suppliers; a Branch Manager sees their own suppliers and can request new ones.
    label: "Approvals",
    items: [
      { label: "Approvals", to: "/approvals", icon: "approval", roles: ["admin", "warehouse_incharge"] },
      { label: "Supplier assignment", to: "/supplier-assignment", icon: "assignment_ind", roles: ["admin", "warehouse_incharge"] },
      { label: "My suppliers", to: "/my-suppliers", icon: "groups", roles: ["branch_manager"] },
      { label: "My submissions", to: "/my-submissions", icon: "outbox", roles: ["branch_manager", "qfs_officer"] },
    ],
  },
  {
    label: "Administration",
    items: [{ label: "Users", to: "/admin/users", icon: "manage_accounts", roles: ["admin"] }],
  },
];
