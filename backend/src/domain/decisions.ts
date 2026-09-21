// Ported from frontend/src/domain/decisions.ts — used server-side to validate that a posted
// branch id is actually a legal outcome for that decision stage before accepting it.
export interface BranchOutcome {
  id: string;
  label: string;
  note: string;
}

export const DECISION_BRANCHES: Record<string, BranchOutcome[]> = {
  "n-qfs": [
    { id: "pass", label: "Pass — quality ok", note: "Continue on to Weight truck (Gross weight)." },
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
