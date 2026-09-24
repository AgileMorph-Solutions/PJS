import type { ProductionBranchOutcome } from "../types/production.js";

/**
 * Branch options for production's decision nodes — the production twin of decisions.ts.
 *
 * Unlike procurement's three decisions (n-qfs/n-drying/n-xferdec), which the Sept 2026
 * clarification spelled out explicitly, the production flow map (Production.html) marks eight
 * nodes `kind: "decision"` but records no branch-outcome data for most of them — they're quality
 * checkpoints, not places the map itself draws two diverging arrows. Two are different:
 *
 * - `n-qc8` (after the oven) is genuinely where the flow splits, backed by real data: the client's
 *   own `18. Borma Loss Tally Sheet.xlsx` has a `To` column with exactly two real values —
 *   Packing (6,242 rows) and Peeling (698 rows) — which IS the Phase 8a/Phase 7 fork.
 * - `n-qcount1` (Quantity Check-1) sits in a phase literally named "Uncut → repass" with a
 *   `n-repass` node right after it — the topology itself confirms a continue/repass fork even
 *   though no workbook column names it.
 *
 * The rest (n-qc1, n-qc2, n-qc5, n-qc6, n-qc7, w-qc11, p-qc11) get the same pass/fail affordance
 * procurement's n-qfs uses, because that is this repo's established shape for "a decision stage
 * with no other structure" — but their branch ids are UI structure, not transcribed data,  and
 * each says so in its own note so nothing here is mistaken for a real workbook value.
 */
export const PRODUCTION_DECISION_BRANCHES: Record<string, ProductionBranchOutcome[]> = {
  "n-qc1": [
    { id: "pass", label: "Within spec", note: "No workbook column records a pass/fail outcome for this cut — modelled as a checkpoint, like procurement's n-qfs, not transcribed from a real branch column." },
    { id: "fail", label: "Out of spec — hold for review", note: "Same caveat as \"Within spec\": UI structure, not a transcribed value." },
  ],
  "n-qc2": [
    { id: "pass", label: "Matches automatic calibration", note: "No workbook column records a pass/fail outcome — modelled as a checkpoint, not transcribed data." },
    { id: "fail", label: "Discrepancy — recheck screen", note: "Same caveat as \"Matches automatic calibration\"." },
  ],
  "n-qc5": [
    { id: "pass", label: "Machine within frequency spec", note: "No workbook column records a pass/fail outcome — modelled as a checkpoint, not transcribed data." },
    { id: "fail", label: "Machine mis-set — flag for maintenance", note: "Same caveat as \"Machine within frequency spec\"." },
  ],
  "n-qc6": [
    { id: "pass", label: "Kernel loss acceptable", note: "No workbook column records a pass/fail outcome — modelled as a checkpoint, not transcribed data." },
    { id: "fail", label: "Kernel loss high — investigate", note: "Same caveat as \"Kernel loss acceptable\"." },
  ],
  "n-qc7": [
    { id: "pass", label: "Sorter yield acceptable", note: "The Sampling Point column pairs before/after rows, but no column records a pass/fail outcome — modelled as a checkpoint, not transcribed data." },
    { id: "fail", label: "Sorter underperforming — recheck", note: "Same caveat as \"Sorter yield acceptable\"." },
  ],
  "n-qcount1": [
    { id: "continue", label: "Uncut quantity acceptable — continue", note: "Inferred from the flow topology (Phase 4c is named \"Uncut → repass\" and n-repass follows this node) — the fork itself is real, though no workbook column names the branch." },
    { id: "repass", label: "Uncut quantity high — repass into shelling", note: "See n-repass — the repass loop feeds straight back into Shelling Process." },
  ],
  "n-qc8": [
    { id: "packing", label: "To Packing — Wholes", note: "Real, transcribed: 18. Borma Loss Tally Sheet.xlsx's own `To` column, 6,242 of 6,940 routed rows." },
    { id: "peeling", label: "To Peeling — Pieces/Rejects", note: "Real, transcribed: 18. Borma Loss Tally Sheet.xlsx's own `To` column, 698 of 6,940 routed rows." },
  ],
  "w-qc11": [
    { id: "pass", label: "Meets final spec — release", note: "No workbook column records a pass/fail outcome — modelled as a checkpoint, not transcribed data." },
    { id: "fail", label: "Fails final spec — hold", note: "Same caveat as \"Meets final spec — release\"." },
  ],
  "p-qc11": [
    { id: "pass", label: "Meets final spec — release", note: "No workbook column records a pass/fail outcome — modelled as a checkpoint, not transcribed data." },
    { id: "fail", label: "Fails final spec — hold", note: "Same caveat as \"Meets final spec — release\"." },
  ],
};
