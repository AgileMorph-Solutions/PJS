export interface NavLeaf {
  label: string;
  to: string;
  /** Material Symbols Outlined icon name (e.g. "dashboard"). */
  icon: string;
  /** Match this route exactly, not by prefix — only the root "/" needs this. */
  end?: boolean;
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
    label: "Cashew Procurement",
    items: [
      { label: "RCN Receipts", to: "/procurement/receipts", icon: "receipt_long" },
      { label: "Delivery Plans", to: "/procurement/delivery-plans", icon: "local_shipping" },
      { label: "Lots & Bins", to: "/procurement/stock", icon: "grid_view" },
      { label: "Drying Jobs", to: "/procurement/drying", icon: "wb_sunny" },
    ],
  },
  {
    label: "Bag Management",
    items: [
      { label: "Warehouse Stock", to: "/jute/warehouse-stock", icon: "inventory_2" },
      { label: "Supplier Movement", to: "/jute/suppliers", icon: "swap_horiz" },
      { label: "Production Issue/Return", to: "/jute/production", icon: "sync_alt" },
      { label: "Warehouse Transfers", to: "/jute/transfers", icon: "compare_arrows" },
    ],
  },
  {
    label: "Production",
    items: [{ label: "Production", to: "/production", icon: "precision_manufacturing" }],
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
