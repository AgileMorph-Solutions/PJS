import type { BranchOutcome, Stage } from "../types/stage.js";

// The three decisions in the flow don't share one shape, so their branch options are spelled
// out explicitly rather than generalised. Shared between the intake wizard and the truck
// detail page's decision controls.
export const DECISION_BRANCHES: Record<string, BranchOutcome[]> = {
  "n-qfs": [
    { id: "pass", label: "Pass — quality ok", note: "Issues the truck's Lot Number, then continue on to unloading." },
    {
      id: "fail",
      label: "Fail — reject truck",
      note: "Truck is rejected and held; procurement in charge is informed. Record is kept, per the Sept 2026 requirement.",
    },
  ],
  "n-drying": [
    {
      id: "direct",
      label: "Direct to drying",
      note: "Drying-yard space available → truck unloads straight to the drying yard, skipping the warehouse for now.",
    },
    {
      id: "indirect",
      label: "Warehouse → Drying",
      note: "Drying yard full → RCN unloaded to the warehouse first, issued to drying later once space frees up.",
    },
    {
      id: "none",
      label: "No — no drying needed",
      // Recorded as a decision only: it never creates the drying step, so the truck's status is untouched (receiptStatus.ts).
      note: "The Lot goes on without drying. Nothing else is recorded.",
    },
  ],
  "n-xferdec": [
    { id: "stays", label: "No — stays at this warehouse", note: "The Lot stays here and isn't offered on the Transfers page." },
    {
      id: "transfer",
      label: "Yes — transfers out",
      note: "The Lot is ready to send: it shows on the Transfers page, where its BKT is created.",
    },
    // Only offered at a Central warehouse: see decisionBranchesFor below.
    {
      id: "production",
      label: "Ready for production",
      note: "The Lot counts in its bin's stock, so that bin can go into a production batch.",
    },
  ],
};

/**
 * A Central warehouse never sends RCN back, so its last question isn't whether to transfer but whether
 * the Lot is for production. "stays" keeps its meaning (the Lot stays where it is) under a clearer name.
 */
const CENTRAL_LAST_DECISION: BranchOutcome[] = [
  { id: "stays", label: "Keep in warehouse", note: "The Lot stays in its bin and isn't counted for a production batch." },
  DECISION_BRANCHES["n-xferdec"]!.find((b) => b.id === "production")!,
];

/** The options a decision offers at a site of this Unit/Central type. Everything but the last decision is the same everywhere. */
export function decisionBranchesFor(stageId: string, siteType: string | null): BranchOutcome[] | undefined {
  if (stageId !== "n-xferdec") return DECISION_BRANCHES[stageId];
  return siteType === "CENTRAL" ? CENTRAL_LAST_DECISION : DECISION_BRANCHES["n-xferdec"]!.filter((b) => b.id !== "production");
}

/** The last decision as a Central warehouse reads it: its transfer fields ("Driven by space at warehouse") don't apply there. */
export function stageForSite(stage: Stage, siteType: string | null): Stage {
  if (stage.id !== "n-xferdec" || siteType !== "CENTRAL") return stage;
  return { ...stage, title: "Send to production?", fields: [] };
}
