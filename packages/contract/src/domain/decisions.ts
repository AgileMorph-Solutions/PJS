import type { BranchOutcome } from "../types/stage.js";

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
  ],
  "n-xferdec": [
    { id: "stays", label: "No — stays at this warehouse", note: "Nothing further happens until a transfer is decided on later." },
    {
      id: "transfer",
      label: "Yes — transfers out",
      note: "Continues in Inter-Warehouse Stock Transfer — a separate process, not built yet.",
    },
  ],
};
