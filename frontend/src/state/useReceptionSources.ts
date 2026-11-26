import { useMemo } from "react";
import { useTransfers } from "./TrackingContext";
import { useSite } from "./SiteContext";
import { useSiteReceipts } from "./useSiteReceipts";
import type { ReceptionSourceCounts } from "../components/receipt/ReceptionSourceTabs";

/**
 * A Central warehouse's Reception, split by where the trucks come from (24 Nov 2026): supplier trucks, trucks from the Unit
 * warehouse, and those still on the road (dispatched here, no reception started). One place for both tabs' pages.
 */
export function useReceptionSources() {
  const site = useSite();
  const all = useSiteReceipts();
  const { transfers, refetch } = useTransfers(site.type === "CENTRAL" ? site.warehouseName : undefined);
  return useMemo(() => {
    const suppliers = all.filter((r) => !r.transfer);
    const unit = all.filter((r) => r.transfer);
    const incoming = transfers.filter((t) => t.toWarehouse === site.warehouseName);
    const onTheRoad = incoming.filter((t) => t.status === "dispatched" && !t.lines.some((l) => l.receptionId));
    const counts: ReceptionSourceCounts = { suppliers: suppliers.length, unit: unit.length, onTheRoad: onTheRoad.length };
    const unitFrom = [...new Set(incoming.map((t) => t.fromWarehouse))].join(", ");
    return { suppliers, unit, onTheRoad, counts, unitFrom, refetchTransfers: refetch };
  }, [all, transfers, site.warehouseName, refetch]);
}
