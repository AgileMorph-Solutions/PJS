import { useMemo } from "react";
import { useMe } from "./AuthContext";
import { useTracking } from "./TrackingContext";
import { listSites } from "@anagroci/contract/domain/siteType";

/**
 * Which warehouses this person can work with, in one place so no page keeps its own list. A warehouse is a row of the
 * Warehouses master that sits in a category (UNIT WAREHOUSE in BOUAKE): the categories themselves (BOUAKE, YAKRO
 * FACTORY) only group warehouses and are never offered. Someone assigned to a warehouse (User.warehouse) works in that
 * one; someone who isn't chooses from them all. It goes by the assignment rather than the role, so it follows whatever
 * the user record says.
 */
export function useWarehouseChoices() {
  const own = useMe().warehouse ?? null;
  const { masters } = useTracking();
  const all = useMemo(() => {
    const categories = new Set(listSites(masters.warehouses).map((c) => c.name));
    return masters.warehouses.filter((w) => w.site && categories.has(w.site)).map((w) => w.name).sort((a, b) => a.localeCompare(b));
  }, [masters.warehouses]);
  return { own, all, options: own ? [own] : all };
}
