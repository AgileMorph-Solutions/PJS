import { useMemo } from "react";
import { useMe } from "./AuthContext";
import { useTracking } from "./TrackingContext";
import { listSites } from "@anagroci/contract/domain/siteType";

/**
 * Which warehouses this person can work with, in one place so no page keeps its own list. A warehouse is a ready row of
 * Masters › Warehouses (BOUAKE, YAKRO FACTORY): a category (Unit/Central) and an ID code, contract's listSites. Old
 * store rows under a warehouse are not offered — stores aren't a concept the app uses. Someone assigned to a warehouse
 * (User.warehouse) works in that one; someone who isn't chooses from them all. It goes by the assignment rather than the
 * role, so it follows whatever the user record says.
 */
export function useWarehouseChoices() {
  const own = useMe().warehouse ?? null;
  const { masters } = useTracking();
  const all = useMemo(() => listSites(masters.warehouses).map((w) => w.name), [masters.warehouses]);
  return { own, all, options: own ? [own] : all };
}
