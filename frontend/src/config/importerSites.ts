import type { SiteSlug } from "./sites";

/**
 * Which site(s) each registered importer's data actually belongs to — measured directly against
 * the real sheets and their Prisma models (see each importer's own header comment in
 * backend/src/domain/imports/*.ts and docs/UPLOAD_GUIDE.md's mapping table), not guessed from the
 * label. "both" covers two different real cases: a sheet that's naturally split row-by-row across
 * both sites (truckReception, dryingBatch, warehouseReceiving), and a sheet with no site dimension
 * at all (suppliersMaster, warehouseActivityLedger) — either way, it belongs in both sites' Upload
 * pickers.
 */
export const IMPORTER_SITE: Record<string, SiteSlug | "both"> = {
  truckReception: "both",
  juteBagsMovement: "unit",
  dryingSorting: "unit",
  suppliersMaster: "both",
  juteWarehouseTransfer: "both",
  warehouseDischarges: "unit",
  warehouseDispatches: "unit",
  dryingBatch: "both",
  issuedToProduction: "central",
  warehouseReceiving: "both",
  warehouseActivityLedger: "both",
};

export function importerBelongsToSite(importerId: string, siteSlug: SiteSlug): boolean {
  const site = IMPORTER_SITE[importerId];
  return site === undefined || site === "both" || site === siteSlug;
}
