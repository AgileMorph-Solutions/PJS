import type { ReactNode } from "react";
import { Pill } from "../ui/Pill";
import { RcnReceiptStatusPill } from "./batchUi";
import { MoistureCard } from "./MoistureCard";
import { WeighingCard } from "./WeighingCard";
import { SortLoadPanel } from "./CalibrationRunCard";
import { RCN_STAGES, rcnReceiptStages, type RcnStageId, type RcnStageState } from "@anagroci/contract/domain/rcnReceipt";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";

export interface LoadPermissions {
  /** Record, weigh and sort a load (Admin / Warehouse Incharge). */
  canReceive: boolean;
  /** Take a moisture check (the QFS Officer, or the Incharge / Admin directly). */
  canEnterMoisture: boolean;
  /** Approve or reject a submitted check, and enter directly without approval. */
  canReview: boolean;
}

const STATE_PILL: Record<RcnStageState, { tone: string; label: string }> = {
  done: { tone: "entry", label: "Done" },
  current: { tone: "term", label: "Next to do" },
  waiting: { tone: "decision", label: "Waiting for approval" },
  todo: { tone: "system", label: "Not yet" },
};

/** Every step of a load is done. */
export const loadDone = (r: RcnReceipt) => Object.values(rcnReceiptStages(r)).every((s) => s === "done");

/**
 * One load of the run, inside the run's Intake stage — never a page of its own, so a load reads as part of the run, not
 * a separate process. The header says which load it is and how far it has got; opened, every one of its forms is there
 * at once (moisture check, pallets, final weight, calibration), to be filled in any order.
 */
export function LoadCard({ receipt, open, onToggle, can, onChanged }: {
  receipt: RcnReceipt;
  open: boolean;
  onToggle: () => void;
  can: LoadPermissions;
  onChanged: () => void;
}) {
  const states = rcnReceiptStages(receipt);
  const doneCount = RCN_STAGES.filter((s) => states[s.id] === "done").length;

  return (
    <section id={`load-${receipt.id}`} className={`scroll-mt-24 bg-white rounded-2xl shadow-xs overflow-hidden ${open ? "border-2 border-brand-700" : "border border-warmstone-200"}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className={`w-full text-left px-5 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-2 transition-colors ${open ? "bg-brand-50/60" : "hover:bg-warmstone-50"}`}>
        <span className="material-symbols-outlined text-[20px] text-warmstone-500">{open ? "expand_less" : "expand_more"}</span>
        <span className="min-w-0">
          <span className="block font-mono text-[13px] font-bold text-warmstone-900">{receipt.id}</span>
          <span className="block text-[12px] text-warmstone-500">
            BTM {receipt.btmNo} · from <span className="font-mono">{receipt.binCode}</span> · {formatDate(receipt.date)}
          </span>
        </span>
        <span className="flex-1" />
        <StepDots states={states} />
        <span className="text-[12px] text-warmstone-500 tabular-nums">{doneCount} of {RCN_STAGES.length} steps</span>
        <RcnReceiptStatusPill status={receipt.status} />
      </button>

      {open && (
        <div className="border-t border-warmstone-100 bg-warmstone-50/40 p-4 grid xl:grid-cols-2 gap-4">
          <StepPanel id="moisture" state={states.moisture}>
            <MoistureCard receipt={receipt} canEnter={can.canEnterMoisture} canReview={can.canReview} direct={can.canReview} onChanged={onChanged} />
          </StepPanel>
          <StepPanel id="pallets" state={states.pallets}>
            <WeighingCard receipt={receipt} part="pallets" canEdit={can.canReceive} onChanged={onChanged} />
          </StepPanel>
          <StepPanel id="final_weight" state={states.final_weight}>
            <WeighingCard receipt={receipt} part="final" canEdit={can.canReceive} onChanged={onChanged} />
          </StepPanel>
          <StepPanel id="calibration" state={states.calibration}>
            <SortLoadPanel receipt={receipt} canEdit={can.canReceive} onChanged={onChanged} />
          </StepPanel>
        </div>
      )}
    </section>
  );
}

/** The load's steps as a row of small marks, so a closed card still shows where it stands. */
function StepDots({ states }: { states: Record<RcnStageId, RcnStageState> }) {
  const tone: Record<RcnStageState, string> = {
    done: "bg-success-600",
    current: "bg-brand-700",
    waiting: "bg-ambernut-400",
    todo: "bg-warmstone-200",
  };
  return (
    <span className="hidden sm:flex items-center gap-1" aria-hidden="true">
      {RCN_STAGES.map((s) => <span key={s.id} title={`${s.label}: ${STATE_PILL[states[s.id]].label}`} className={`w-2.5 h-2.5 rounded-full ${tone[states[s.id]]}`} />)}
    </span>
  );
}

/** One step's form inside an open load: its name, what it is, where it stands, then the form — always shown. */
function StepPanel({ id, state, children }: { id: RcnStageId; state: RcnStageState; children: ReactNode }) {
  const def = RCN_STAGES.find((s) => s.id === id)!;
  const pill = STATE_PILL[state];
  return (
    <div className="bg-white border border-warmstone-200 rounded-xl min-w-0">
      <div className="px-4 pt-3 pb-2.5 flex items-start justify-between gap-3 border-b border-warmstone-100">
        <div className="min-w-0">
          <h4 className="text-[13px] font-bold text-warmstone-900">{def.label}</h4>
          <p className="text-[12px] text-warmstone-500">{def.hint}</p>
        </div>
        <Pill tone={pill.tone} label={pill.label} />
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
