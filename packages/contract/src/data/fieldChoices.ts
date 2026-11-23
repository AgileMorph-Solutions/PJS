import { WAREHOUSE_KINDS } from "./warehouseKinds.js";
import { FINALISED_NEXT_DAY, FINALISED_SAME_DAY, FINALISED_WHEN_LABEL } from "../domain/binFinalise.js";

/**
 * Stage fields whose answer is one of a fixed list, picked from a dropdown instead of typed (client, Nov 2026: "if required
 * add a dropdown instead of a simple text field"). Only lists that are fixed in the spec, named by the field's own label.
 * Lists that come from a master (WH LOCATION's warehouses) are passed by the page that has the master. A value already stored that isn't in the list (an older
 * or imported record) is still shown and kept; it is never rewritten to fit.
 */
export const STAGE_FIELD_CHOICES: Record<string, Record<string, readonly string[]>> = {
  "n-gate": {
    // The only two values the 2026 Truck Reception sheet holds (832 rows).
    "CREDIT/CASH": ["CREDIT", "CASH"],
    "RM/FG": ["RM", "FG"],
    // Filled from WH LOCATION's master row, but a person may override it (Nov 2026): the master's own vocabulary.
    "Warehouse type (Village/Regional/Factory)": WAREHOUSE_KINDS.map((k) => k.label),
  },
  "n-bin": {
    // The four bases the label itself names (Sept 2026 clarification: "moisture, quality, KOR, available space").
    "Basis for allocation (moisture / quality / KOR / space)": ["Moisture", "Quality", "KOR", "Space"],
    // The two answers the label and the client's process notes name; picked by the person before finalising (Nov 2026).
    [FINALISED_WHEN_LABEL]: [FINALISED_SAME_DAY, FINALISED_NEXT_DAY],
  },
  "n-stock": {
    // Same label and same master vocabulary as the arrival step's (n-gate) — one list, not two that could drift.
    "Warehouse type (Village/Regional/Factory)": WAREHOUSE_KINDS.map((k) => k.label),
  },
  "n-xferdec": {
    // The label names space; production need and other cover a Central warehouse sending to the factory floor.
    "Driven by (space at warehouse)": ["Space at warehouse", "Production need", "Other"],
  },
  "n-ledger": {
    // The seven activities the label itself lists (doc §7), in its order.
    "Activity type (discharge, weight, reconditioning, destacking, drying, triage, sèches)": [
      "Discharge", "Weight", "Reconditioning", "Destacking", "Drying", "Triage", "Sèches",
    ],
  },
};

export const fieldChoices = (stageId: string, label: string): readonly string[] | undefined => STAGE_FIELD_CHOICES[stageId]?.[label];

/**
 * Whether `value` is one of the field's fixed answers, matched without regard to case or surrounding spaces ("cash" is
 * CASH). `value` is the answer as the list spells it, ready to store; undefined when the field has no list or the value
 * isn't on it. A blank is not an answer: nothing is chosen yet, and the caller decides whether that is allowed.
 */
export function resolveChoice(stageId: string, label: string, value: string): { options: readonly string[]; value?: string } | undefined {
  const options = fieldChoices(stageId, label);
  if (!options) return undefined;
  const wanted = value.trim().toLowerCase();
  return { options, value: options.find((o) => o.toLowerCase() === wanted) };
}
