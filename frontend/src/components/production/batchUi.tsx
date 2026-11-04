import { Pill } from "../ui/Pill";
import { BATCH_STATUS_LABELS, type BatchStatus } from "@anagroci/contract/domain/productionBatch";
import { RCN_RECEIPT_STATUS_LABELS, type RcnReceiptStatus } from "@anagroci/contract/domain/rcnReceipt";
import { SITE_LIST } from "../../config/sites";

export const primaryButton =
  "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-[13px] font-bold shadow-sm transition-all";
export const secondaryButton =
  "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-warmstone-200 bg-white hover:bg-warmstone-50 text-warmstone-800 text-[13px] font-semibold transition-all";
export const inputCls =
  "w-full px-3 py-2 rounded-xl border border-warmstone-200 bg-white text-[13px] text-warmstone-900 placeholder-warmstone-400 outline-none focus:border-brand-700 focus:ring-1 focus:ring-brand-700";

/** Kg as the client reads batch sizes: tonnes, one decimal (4,172.9 t). */
export function formatTonnes(kg: number): string {
  return `${(kg / 1000).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`;
}

export function BatchStatusPill({ status }: { status: BatchStatus }) {
  return <Pill tone={status === "in_process" ? "term" : "system"} label={BATCH_STATUS_LABELS[status]} />;
}

/** Amber waits on someone, red went wrong (On hold), green is moving on or done. */
const RCN_TONE: Record<RcnReceiptStatus, string> = {
  waiting_for_moisture: "decision",
  moisture_pending: "decision",
  on_hold: "gap",
  waiting_for_weighing: "entry",
  weighing: "entry",
  intake_done: "term",
};

/** Kg as the tally sheet shows them: up to 2 decimals, thousands separated. */
export function formatKg(kg: number): string {
  return `${kg.toLocaleString("en-US", { maximumFractionDigits: 2 })} kg`;
}

export function RcnReceiptStatusPill({ status }: { status: RcnReceiptStatus }) {
  return <Pill tone={RCN_TONE[status]} label={RCN_RECEIPT_STATUS_LABELS[status]} />;
}

const siteSlugOf = (warehouse: string) =>
  (SITE_LIST.find((s) => s.warehouseName === warehouse || s.aliases.includes(warehouse)) ?? SITE_LIST.find((s) => s.slug === "central")!).slug;

/** Where a procurement receipt of `warehouse` opens, so a batch's Lots link back to their trucks. */
export function receiptHref(warehouse: string, receiptId: string): string {
  return `/${siteSlugOf(warehouse)}/receipts/${encodeURIComponent(receiptId)}`;
}

/** Where a BKT that brought a Lot to `warehouse` opens. */
export function transferHref(warehouse: string, transferId: string): string {
  return `/${siteSlugOf(warehouse)}/transfers/${encodeURIComponent(transferId)}`;
}

/** The phases a batch walks through (Production module doc). Only Created and Intake's RCN Receipt exist so far. */
export const BATCH_PHASES = ["Created", "Intake", "Calibration", "Cooking", "Shelling", "Colour sort", "Borma", "Peeling & grading", "Packing", "Closed"];

export function BatchPhaseStepper() {
  // Created is done the moment the batch exists; Intake is next.
  const current = 1;
  return (
    <ol className="flex items-start gap-0 overflow-x-auto pb-1">
      {BATCH_PHASES.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex-1 min-w-[78px] flex flex-col items-center relative">
            {i > 0 && <span className={`absolute top-3.5 right-1/2 w-full h-0.5 ${i <= current ? "bg-success-600" : "bg-warmstone-200"}`} />}
            <span
              className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 ${
                done ? "bg-success-600 border-success-600 text-white" : active ? "bg-white border-brand-700 text-brand-700" : "bg-warmstone-100 border-warmstone-200 text-warmstone-400"
              }`}
            >
              {done ? <span className="material-symbols-outlined text-[16px]">check</span> : active ? <span className="w-2 h-2 rounded-full bg-brand-700" /> : i}
            </span>
            <span className={`mt-1.5 text-[11px] text-center font-semibold ${active || done ? "text-warmstone-900" : "text-warmstone-400"}`}>{label}</span>
            {active && <span className="text-[10.5px] text-warmstone-500">next</span>}
          </li>
        );
      })}
    </ol>
  );
}
