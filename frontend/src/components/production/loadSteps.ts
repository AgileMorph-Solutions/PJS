/**
 * What the Intake table and a load's own page both need to know about a load's steps: who may do what, the steps as the
 * page shows them, and how a step's state reads. The rules for each part are the contract's (rcnReceiptStages).
 *
 * The page shows ONE STEP PER CLIENT EXCEL FILE (team decision, Nov 2026): people know the sheets, so the app follows
 * them, field for field. A step is named by what is done in it and shows the file beside it. The tally sheet holds both the pallets and the closing weighing (empty pallets, dust, voids),
 * so its two parts are one step (Weighing) here, as they are one sheet there. There is no calibration step: production's
 * acceptance puts the load into the silos as one total (decision, Nov 2026: no kg per silo is weighed). Acceptance is the
 * one step no client file has: it is where the warehouse's load becomes the factory's (Lokesh, 16 Nov 2026).
 */
import { rcnReceiptStages, type RcnStageId, type RcnStageState } from "@anagroci/contract/domain/rcnReceipt";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

export interface LoadPermissions {
  /** Record and weigh a load (Admin / Warehouse Incharge), until production accepts it. */
  canReceive: boolean;
  /** Take a moisture check (the QFS Officer, or the Warehouse Incharge / Admin directly). */
  canEnterMoisture: boolean;
  /** Approve or reject a submitted moisture check, and enter one directly without approval. */
  canReview: boolean;
  /** Accept the warehouse's load for production (Admin / Production Incharge). */
  canAccept: boolean;
}

export type LoadStepId = "receipt" | "moisture" | "weighing" | "acceptance";

export interface LoadStep {
  id: LoadStepId;
  label: string;
  hint: string;
  /** The client's workbook this step replaces; absent for a step none of their files has. */
  sheet?: string;
  /** The contract's parts of a load this step records. */
  parts: RcnStageId[];
}

export const LOAD_STEPS: LoadStep[] = [
  { id: "receipt", label: "RCN receipt", hint: "The load and the BTM slip that came with it.", sheet: "1. RCN Receipts", parts: ["receipt"] },
  { id: "moisture", label: "Quality check", hint: "Nut count, moisture and the cut test of a 1 kg sample. OK lets the load go on.", sheet: "2. Input RCN Quality report", parts: ["moisture"] },
  { id: "weighing", label: "Weighing", hint: "Each pallet on the scale, then the empty pallets, dust and voids. The final weight gives the net and what goes into the silos.", sheet: "19. RCN Receipts Tally Sheet", parts: ["pallets", "final_weight"] },
  { id: "acceptance", label: "Accepted by production", hint: "Production accepts the warehouse's load: its net leaves the warehouse bin and net − dust − voids goes into the silos.", parts: ["acceptance"] },
];

/** What a step shows under its name: the client's file it replaces, or that it is new. */
export const stepSource = (s: LoadStep) => (s.sheet ? `${s.sheet}.xlsx` : "New: no Excel file has it");

/** A step's state as its pill says it. */
export const STEP_PILL: Record<RcnStageState, { tone: string; label: string }> = {
  done: { tone: "entry", label: "Done" },
  current: { tone: "term", label: "Next to do" },
  waiting: { tone: "decision", label: "Waiting for approval" },
  todo: { tone: "system", label: "Not yet" },
};

/** Each step's state from its parts': done when all are, waiting when one waits on someone, next when one is due now. */
export function loadStepStates(r: RcnReceipt): Record<LoadStepId, RcnStageState> {
  const parts = rcnReceiptStages(r);
  const of = (s: LoadStep): RcnStageState => {
    const states = s.parts.map((p) => parts[p]);
    if (states.every((x) => x === "done")) return "done";
    if (states.includes("waiting")) return "waiting";
    if (states.includes("current")) return "current";
    return "todo";
  };
  return Object.fromEntries(LOAD_STEPS.map((s) => [s.id, of(s)])) as Record<LoadStepId, RcnStageState>;
}

/** Every step of a load is done. */
export const loadDone = (r: RcnReceipt) => Object.values(loadStepStates(r)).every((s) => s === "done");

/** How many of the load's steps are done, for "2 of 3 steps". */
export const stepsDone = (r: RcnReceipt) => Object.values(loadStepStates(r)).filter((s) => s === "done").length;

/** The step to open first on a load's page: the one due now, else the first. */
export const firstStepToDo = (r: RcnReceipt): LoadStepId => {
  const states = loadStepStates(r);
  return LOAD_STEPS.find((s) => states[s.id] === "current" || states[s.id] === "waiting")?.id ?? LOAD_STEPS[0]!.id;
};

/** What accepting a load does, in one line: shared by the load's own page and the Approvals page. */
export function acceptApplies(receipt: Pick<RcnReceipt, "binCode">): string {
  return `the warehouse's figures are taken as they are — the net leaves ${receipt.binCode}, the rest goes into the silos, and the warehouse can't change them after.`;
}
