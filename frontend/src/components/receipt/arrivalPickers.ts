import type { Masters } from "@anagroci/contract/types/receipt";
import { normalizeSupplierName } from "@anagroci/contract/domain/supplierCode";

/**
 * Arrival's lists that come from the masters (docs/procurement-field-rules.png): the supplier from the Supplier master
 * (its LBA code then fills itself on the server), and WH NO. from the stores of the chosen WH LOCATION. Active suppliers
 * only, as the batch grid offers them. A site with no stores in the master keeps WH NO. as a text box.
 * Origin is deliberately not here: an unplanned truck can come from a town nobody has added yet (originPicker.ts).
 */
export function arrivalFieldChoices(stageId: string, values: Record<string, string>, masters: Masters): Record<string, string[]> {
  if (stageId === "n-verify") {
    const names = masters.suppliers.filter((s) => s.active !== false).map((s) => normalizeSupplierName(s.name));
    return { "SUPPLIERS NAME": [...new Set(names)].sort() };
  }
  if (stageId === "n-gate") {
    const site = (values["WH LOCATION"] ?? "").trim();
    const stores = masters.warehouses.filter((w) => w.site && w.site === site).map((w) => w.name).sort();
    return stores.length ? { "WH NO.": stores } : {};
  }
  return {};
}
