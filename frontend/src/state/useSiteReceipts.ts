import { useMemo } from "react";
import { useTracking } from "./TrackingContext";
import { useSite } from "./SiteContext";

/**
 * Every truck of this section's warehouse: filed under its name, an alias of it, or an old store row under it — so
 * nothing a database already holds drops out of a list.
 */
export function useSiteReceipts() {
  const { receipts } = useTracking();
  const site = useSite();
  return useMemo(() => {
    const names = new Set([site.warehouseName, ...site.aliases, ...site.stores]);
    return receipts.filter((r) => names.has(r.warehouse));
  }, [receipts, site]);
}
