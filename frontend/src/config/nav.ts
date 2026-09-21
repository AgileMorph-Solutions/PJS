export interface NavLeaf {
  label: string;
  to: string;
}

export interface NavSection {
  label: string;
  basePath: string;
  items: NavLeaf[];
}

export type NavEntry = NavLeaf | NavSection;

export function isSection(e: NavEntry): e is NavSection {
  return "items" in e;
}

export const NAV: NavEntry[] = [
  { label: "Dashboard", to: "/" },
  {
    label: "Procurement",
    basePath: "/procurement",
    items: [
      { label: "RCN Receipts", to: "/procurement/receipts" },
      { label: "Delivery Plans", to: "/procurement/delivery-plans" },
      { label: "Lots & Bins", to: "/procurement/stock" },
      { label: "Drying Jobs", to: "/procurement/drying" },
    ],
  },
  {
    label: "Jute Management",
    basePath: "/jute",
    items: [
      { label: "Warehouse Stock", to: "/jute/warehouse-stock" },
      { label: "Supplier Movement", to: "/jute/suppliers" },
      { label: "Production Issue/Return", to: "/jute/production" },
      { label: "Warehouse Transfers", to: "/jute/transfers" },
    ],
  },
  { label: "Production", to: "/production" },
  {
    label: "Masters",
    basePath: "/masters",
    items: [
      { label: "Suppliers", to: "/masters/suppliers" },
      { label: "Warehouses", to: "/masters/warehouses" },
      { label: "Bins", to: "/masters/bins" },
    ],
  },
];
