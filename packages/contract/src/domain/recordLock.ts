/**
 * Record locking (client review, Oct 2026): once a truck's reception record is complete it stops being editable, so
 * what was recorded is what stays recorded. Before this, only calculated fields were read-only.
 *
 * "Complete" is the GRN being complete: the quantity officially recognised into stock AND the price. They are entered
 * by different people (Warehouse Incharge, Branch Manager), in either order, so locking on the quantity alone could
 * shut the price out. Admin can reopen a locked record, with a written reason that goes on the record's timeline.
 * Records that already exist are not locked retroactively; the rule applies as each one next reaches a complete GRN.
 */
import { GRN_QUANTITY_LABEL } from "./receiptStatus.js";
import { OFFLOADING_STAGES, RECEPTION_STAGES } from "../data/modules.js";

const PRICE_LABEL = "PRICE";

const filled = (v: string | undefined) => (v ?? "").trim() !== "";

/** Both the GRN quantity and the price are recorded. */
export function isGrnComplete(stageData: Record<string, Record<string, string>>): boolean {
  const grn = stageData["n-grn"];
  return filled(grn?.[GRN_QUANTITY_LABEL]) && filled(grn?.[PRICE_LABEL]);
}

/**
 * What a lock closes: the reception record itself, from the gate to the GRN. The steps that legitimately come after the
 * GRN (the system's stock update, drying, other warehouse activities, the transfer decision) stay open.
 */
export const LOCKED_STAGES: ReadonlySet<string> = new Set([...RECEPTION_STAGES, ...OFFLOADING_STAGES].filter((s) => s !== "n-stock"));

/** The only decision inside the locked record; the drying and transfer decisions come after the GRN. */
export const LOCKED_DECISIONS: ReadonlySet<string> = new Set(["n-qfs"]);

export const LOCKED_MESSAGE =
  "This record is locked: its GRN is complete, so it can no longer be changed. An Admin can reopen it with a reason.";

/** Bin allocation, once finalised, is closed to changes as well, until an Admin reopens it. */
export const BIN_FINALISED_MESSAGE =
  "The bin allocation has been finalised and can no longer be changed. An Admin can reopen it with a reason.";
