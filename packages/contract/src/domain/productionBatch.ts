/**
 * Production Phase 0 (Batch): the rules both sides need.
 * Source: the client's "Production module" and "Phase 1 — Batch & Intake" documents (Oct 2026).
 *
 * A batch is a PLAN: a group of the factory's warehouse bins to be processed together, about one
 * month of work. Creating one moves no nuts and changes no stock.
 */
import type { ReceiptRecord, TransferRequest } from "../types/receipt.js";
import { GRN_QUANTITY_LABEL } from "./receiptStatus.js";
import { isGrnComplete } from "./recordLock.js";
import { parseQty } from "./receiptMath.js";
import { lineNetAtArrival } from "./transfers.js";
import { dryingPhase, isOpenRound } from "./sunDrying.js";

/** The client's settings: about 150 t a day, so a month is 3,700–4,500 t (150 t × ~26 working days). */
export const DAILY_CAPACITY_KG = 150_000;
export const MONTHLY_GUIDE_KG = { min: 3_700_000, max: 4_500_000 } as const;

// ── Warehouse bin stock, as procurement left it ────────────────────────────────────────────────

/** Where one procurement Lot stands, as far as production is concerned. */
export type LotBinState =
  /** In the bin, procurement finished: counts toward the bin's stock. */
  | "in_bin"
  /** In the bin, but its GRN weight is blank (an imported row from a sheet with no GRN column): counted as a Lot, not as kg. */
  | "weight_not_recorded"
  /** The n-bin step names several bins ("BIN-01/BIN-02"): which share went where was never recorded, so no kg is attributed. */
  | "split_across_bins"
  /** Came on a BKT carrying several Lots, received before bags were counted per Lot: the truck was weighed as one, so no kg is attributed. */
  | "weighed_with_other_lots";

export interface LotInBin {
  receiptId: string;
  lotNo: string;
  supplierName: string;
  arrivalDate: string;
  /** undefined unless state is "in_bin". */
  kg?: number;
  state: LotBinState;
  /** True when the Lot came back from sun drying into this bin (its dried quantity is what counts). */
  dried: boolean;
  /** True when kg is this Lot's share of a truck carrying several Lots, by the bags counted off per Lot — not weighed alone. */
  kgShared?: boolean;
  /** Set when the Lot reached this site on a transfer (BKT): its receipt belongs to the sending site. */
  transferId?: string;
  /** The warehouse the Lot is in now: its truck's own warehouse, or the BKT's receiving one. */
  warehouse: string;
  /** For a Lot that came on a BKT, the warehouse that sent it. */
  fromWarehouse?: string;
  /** Part of this Lot already left on a dispatched BKT: kg shows what is still here, this what went (lotsSentOnBkts). */
  sentKg?: number;
}

/**
 * A Lot another site sent here on a BKT, unloaded into one of this site's bins. The client's own sheets
 * chain it: "Bouake RCN Receiving at Factory" records the Yakro BIN NO. per Lot, and the bins in
 * "Issued to Production" (Source Bin) are those same bins.
 */
export interface ArrivedLot {
  transferId: string;
  receiptId: string;
  lotNo: string;
  supplierName: string;
  /** The day it arrived HERE (the BKT's receipt), not the supplier truck's arrival at the sending site. */
  arrivalDate: string;
  binCode: string;
  /** Net at arrival, from this site's scale; with several Lots on the truck, this Lot's share by bags (kgShared). */
  kg?: number;
  kgShared?: boolean;
  fromWarehouse: string;
  toWarehouse: string;
}

/**
 * The Lots received into a bin on these transfers. The net at arrival is weighed per truck: a Lot alone on it
 * gets all of it, and Lots sharing a truck get their share by the bags counted off per Lot (lineNetAtArrival).
 * A Lot split across trucks arrives once per BKT, each piece with its own figure.
 */
export function arrivedLots(transfers: TransferRequest[]): ArrivedLot[] {
  return transfers
    .filter((t) => t.status === "received")
    .flatMap((t) => {
      const net = lineNetAtArrival(t);
      return t.lines
        .map((l, i) => ({ l, share: net[i] }))
        // A Bin line carries no Lot: what it brought is a Bin movement (binTransferMovements), not an arrived Lot.
        .filter(({ l }) => l.receivedBinCode && l.receiptId)
        .map(({ l, share }) => ({
          transferId: t.id,
          receiptId: l.receiptId!,
          lotNo: l.lotNumber ?? "",
          supplierName: l.supplierName,
          arrivalDate: (t.receivedAt ?? "").slice(0, 10),
          binCode: l.receivedBinCode!.trim().toUpperCase(),
          kg: share?.kg,
          ...(share?.shared ? { kgShared: true } : {}),
          fromWarehouse: t.fromWarehouse,
          toWarehouse: t.toWarehouse,
        }));
    });
}

export interface WarehouseBinStock {
  binCode: string;
  /** What is in the bin now: its Lots' kg, plus what came in and less what went out (movements), less issuedKg. */
  kg: number;
  /** The net kg production accepted out of the bin (IssuedLoad), already taken off kg. */
  issuedKg: number;
  lots: LotInBin[];
  /** RCN moved in or out of the bin as a whole — drying, transfers — already counted in kg. */
  movements: BinMovement[];
}

/**
 * RCN moved in or out of a Bin as a whole, not as a Lot. Once RCN is in a Bin its Lots can't be told apart (Sameer,
 * 18 Nov 2026: "once the bin is created, lot is gone"), so drying from a Bin and a truck loaded from a Bin move kg of the
 * Bin. `kg` is signed: negative leaves the Bin, positive comes into it.
 */
export type BinMovementKind = "drying_out" | "drying_back" | "transfer_out" | "transfer_in";

export interface BinMovement {
  binCode: string;
  kg: number;
  kind: BinMovementKind;
  /** The drying round or BKT it belongs to. */
  ref: string;
  /** ISO date, for listing; "" when the record had none. */
  date: string;
}

export const BIN_MOVEMENT_LABELS: Record<BinMovementKind, string> = {
  drying_out: "Taken for sun drying",
  drying_back: "Back from sun drying",
  transfer_out: "Sent on a transfer",
  transfer_in: "Arrived on a transfer",
};

/** One sun-drying round started from a Bin (a DryingBatch row with a source Bin and no Lot). */
export interface BinDryingRoundFacts {
  id: string;
  /** Rounds 2, 3 … point at round 1; null on round 1 itself. */
  firstBatchId: string | null;
  round: number | null;
  status: string | null;
  sourceBinNo: string | null;
  destinationBinNo: string | null;
  issuedNetWeightKg: number | null;
  receivedNetWeightKg: number | null;
  /** ISO date the round was issued. */
  date: string;
}

/**
 * What drying from Bins moved. A drying is a chain of rounds (round 1, then a re-dry is round 2 …): what round 1 took out
 * leaves its source Bin the day it is issued, and comes back only when the LAST round passed, at what came back, into the
 * Bin it was put in. A chain still out, or sent straight to production, never comes back to a Bin.
 */
export function binDryingMovements(rounds: readonly BinDryingRoundFacts[]): BinMovement[] {
  const chains = new Map<string, BinDryingRoundFacts[]>();
  for (const r of rounds) {
    const key = r.firstBatchId ?? r.id;
    chains.set(key, [...(chains.get(key) ?? []), r]);
  }
  const out: BinMovement[] = [];
  for (const [key, chain] of chains) {
    chain.sort((a, b) => (a.round ?? 1) - (b.round ?? 1));
    const first = chain.find((r) => r.id === key) ?? chain[0]!;
    const last = chain[chain.length - 1]!;
    const from = (first.sourceBinNo ?? "").trim().toUpperCase();
    if (from && first.issuedNetWeightKg !== null) {
      out.push({ binCode: from, kg: -first.issuedNetWeightKg, kind: "drying_out", ref: key, date: first.date });
    }
    const to = (last.destinationBinNo ?? "").trim().toUpperCase();
    if (dryingPhase(last.status) === "passed" && to && last.receivedNetWeightKg !== null) {
      out.push({ binCode: to, kg: last.receivedNetWeightKg, kind: "drying_back", ref: key, date: last.date });
    }
  }
  return out;
}

/**
 * What trucks loaded from Bins moved, as seen from `site` (its warehouse names). A Bin line leaves its Bin when the truck is
 * dispatched — not when the BKT is created, since stock must not move before a complete dispatch (Sameer, 18 Nov 2026) —
 * at the net weight sent on it. It arrives in the receiving Bin when the truck is received, at its share of the net weighed
 * on arrival (lineNetAtArrival). Lines made per Lot are left to arrivedLots, as before.
 */
export function binTransferMovements(transfers: readonly TransferRequest[], site: readonly string[]): BinMovement[] {
  const out: BinMovement[] = [];
  for (const t of transfers) {
    if (t.status === "requested") continue;
    const net = lineNetAtArrival(t);
    t.lines.forEach((l, i) => {
      if (l.receiptId) return;
      const from = (l.binCode ?? "").trim().toUpperCase();
      if (site.includes(t.fromWarehouse) && from && l.netWeightKg !== null) {
        out.push({ binCode: from, kg: -l.netWeightKg, kind: "transfer_out", ref: t.id, date: (t.dispatchedAt ?? t.transferDate).slice(0, 10) });
      }
      const to = (l.receivedBinCode ?? "").trim().toUpperCase();
      const share = net[i];
      if (t.status === "received" && site.includes(t.toWarehouse) && to && share) {
        out.push({ binCode: to, kg: share.kg, kind: "transfer_in", ref: t.id, date: (t.receivedAt ?? "").slice(0, 10) });
      }
    });
  }
  return out;
}

/** A load production accepted out of a warehouse bin: its net weight (pallets and bags off) has left the bin. */
export interface IssuedLoad {
  binCode: string;
  netKg: number;
}

const filled = (v: string | undefined) => (v ?? "").trim() !== "";

/** The n-bin step reads several bins separated by "/" or "," (see masters' createBin). */
export function splitBinCodes(raw: string | undefined): string[] {
  return (raw ?? "").split(/[/,]/).map((s) => s.trim().toUpperCase()).filter(Boolean);
}

/**
 * A Lot is in its Bin's stock once reception is finished for it: quality passed and the GRN complete (quantity and price,
 * the rule that locks the record, recordLock.ts). An imported receipt only needs a GRN row: its sheet had no GRN quantity
 * column, the same exception deriveStatus makes.
 *
 * Until 22 Nov 2026 a Lot also had to be marked "Ready for production" and have its drying answered, Lot by Lot. Those
 * questions moved to the Bin (Sameer, 18 Nov 2026: once the Bin is created the Lot is gone; drying and transfers go from
 * Bins), so they no longer hold a Lot out of its Bin. What a Lot already recorded the old way still counts: a Lot put on
 * a BKT per Lot ("Yes — transfers out") left this site and is counted where it arrived (arrivedLots); a Lot dried per Lot
 * is counted where its drying left it (driedReturn, below).
 */
function procurementComplete(r: ReceiptRecord): boolean {
  if (r.branches["n-qfs"] !== "pass") return false;
  return r.source === "imported" ? Boolean(r.stageData["n-grn"]) : isGrnComplete(r.stageData);
}

/** What of one Lot has left its site on BKTs: kg dispatched, and whether a piece went with no weight on its line. */
export interface LotSent { kg: number; unknown: boolean }

/**
 * What of each Lot has physically left this site: its lines on BKTs that were dispatched (or have since arrived). A Lot on a
 * BKT still only requested is still in its Bin — the truck hasn't left (23 Nov 2026: marking "Yes — transfers out", or a
 * requested BKT, emptied the Bin at once, and a Lot split across trucks vanished whole when its first piece went). Bin lines
 * are binTransferMovements'; this is the Lot lines', keyed by receipt.
 */
export function lotsSentOnBkts(transfers: readonly TransferRequest[], site: readonly string[]): Map<string, LotSent> {
  const out = new Map<string, LotSent>();
  for (const t of transfers) {
    if (t.status === "requested" || !site.includes(t.fromWarehouse)) continue;
    for (const l of t.lines) {
      if (!l.receiptId) continue;
      const was = out.get(l.receiptId) ?? { kg: 0, unknown: false };
      out.set(l.receiptId, l.netWeightKg === null ? { ...was, unknown: true } : { ...was, kg: was.kg + l.netWeightKg });
    }
  }
  return out;
}

/** The facts of one drying round (a DryingBatch row) that say whether, and where, a Lot came back from drying. */
export interface DryingRoundFacts {
  sn: number;
  status: string | null;
  /** "entered": sun drying done in the app. Imported workbook rows are left to the receipt's own Drying fields. */
  source: string | null;
  receivedNetWeightKg: number | null;
  destinationBinNo: string | null;
}

const DRIED_KG = "Dried quantity returned to warehouse";
const DRIED_BIN = 'New/assigned Bin (marked "dried stock")';

/**
 * What came back from drying, and to which bins; undefined while the Lot is still out (or never went). Sun drying done in the
 * app records this on its rounds, never on the Drying step's own fields, so the rounds are read first: the Lot is back once its
 * latest round passed with a quantity and a bin, and out while any round is open. Only a Lot with no in-app round (an imported
 * one) falls back to the Drying step's "Dried quantity returned" and "New/assigned Bin".
 */
export function driedReturn(r: Pick<ReceiptRecord, "stageData">, rounds: readonly DryingRoundFacts[] = []): { kg: number; bins: string[] } | undefined {
  const app = rounds.filter((b) => b.source === "entered").sort((a, b) => a.sn - b.sn);
  if (app.length) {
    const last = app[app.length - 1]!;
    if (app.some((b) => isOpenRound(b.status)) || dryingPhase(last.status) !== "passed" || last.receivedNetWeightKg === null) return undefined;
    const bins = splitBinCodes(last.destinationBinNo ?? undefined);
    return bins.length ? { kg: last.receivedNetWeightKg, bins } : undefined;
  }
  const kg = parseQty(r.stageData["n-drying"]?.[DRIED_KG]);
  const bins = splitBinCodes(r.stageData["n-drying"]?.[DRIED_BIN]);
  return kg !== undefined && bins.length ? { kg, bins } : undefined;
}

/** The bins a Lot sits in now: the one it came back to from drying, otherwise the one it was allocated. */
export function binsOfLot(r: Pick<ReceiptRecord, "stageData" | "binNo">, rounds: readonly DryingRoundFacts[] = []): string[] {
  const back = driedReturn(r, rounds)?.bins ?? splitBinCodes(r.stageData["n-drying"]?.[DRIED_BIN]);
  return back.length ? back : splitBinCodes(r.stageData["n-bin"]?.["Bin Number"] || r.binNo);
}

/**
 * What still stands between a Lot and "Ready for production", in the warehouse's words. Empty means it
 * can be marked. The same facts procurementComplete reads, so a Lot marked ready is one a batch can count.
 */
export function productionReadinessGaps(
  r: Pick<ReceiptRecord, "branches" | "stageData" | "binNo" | "source">,
  /** This Lot's drying rounds: sun drying done in the app records what came back there, not on the Drying step. */
  rounds: readonly DryingRoundFacts[] = [],
): string[] {
  const drying = r.stageData["n-drying"];
  const dried = !drying || driedReturn(r, rounds) !== undefined;
  return [
    r.branches["n-qfs"] !== "pass" && "pass Quality",
    binsOfLot(r, rounds).length === 0 && "allocate a Bin",
    !(r.source === "imported" ? Boolean(r.stageData["n-grn"]) : isGrnComplete(r.stageData)) && "complete the GRN (quantity and price)",
    !drying && r.branches["n-drying"] !== "none" && "answer the Drying step",
    !dried && "record the dried quantity returned to a Bin",
  ].filter((gap): gap is string => Boolean(gap));
}

/** What the "Ready for production" option needs to say while it can't be chosen. */
export function productionReadinessNotice(gaps: string[]): string | undefined {
  return gaps.length ? `Before this Lot can be marked ready for production: ${gaps.join(", ")}.` : undefined;
}

/** Lots marked "Keep in warehouse", per bin: physically there, but not in the stock a batch plans from. */
export function keptLotsByBin(receipts: ReceiptRecord[]): Map<string, number> {
  const kept = new Map<string, number>();
  for (const r of receipts) {
    if (r.branches["n-xferdec"] !== "stays") continue;
    for (const code of binsOfLot(r)) kept.set(code, (kept.get(code) ?? 0) + 1);
  }
  return kept;
}

/**
 * The stock of each warehouse bin, worked out from the procurement receipts — never stored, so it
 * can't drift from the Lots it is made of.
 *
 * - Only Lots whose procurement is finished (procurementComplete above) are in a bin at all; rejected and
 *   transferred-out trucks never are.
 * - The quantity is the GRN Weight: the quantity officially recognised into stock (recordLock.ts).
 *   Net, GRN and Paid are kept apart on purpose (client, Oct 2026), so Net is never substituted.
 * - A Lot sent to sun drying is out of its bin until it is back (driedReturn: its last drying round passed,
 *   or for an imported Lot "Dried quantity returned to warehouse" + "New/assigned Bin"); from then it counts
 *   there, at the dried quantity.
 * - RCN taken out of a Bin as a whole — for drying, or on a truck — and what came back into one (movements) is
 *   added to or taken from it.
 * - A load production accepted has left the bin (Lokesh, 16 Nov 2026: "Once it is confirmed ... stock of RCN should be
 *   debited from warehouse stock"), at its net weight: the RCN that came out, before the factory's dust and voids. A
 *   bin is debited as a whole, not Lot by Lot: a load's slip names the bin, never the Lots on its pallets. The result
 *   may go below zero (GRN and the factory's scale are different weighings); that is shown, never clamped.
 */
export function warehouseBinStock(
  receipts: ReceiptRecord[],
  arrivals: ArrivedLot[] = [],
  /** Drying rounds by Lot number (driedReturn): where an in-app sun drying left each Lot. */
  roundsByLot: ReadonlyMap<string, readonly DryingRoundFacts[]> = new Map(),
  issued: readonly IssuedLoad[] = [],
  /** RCN moved in or out of Bins as a whole: binDryingMovements and binTransferMovements. */
  movements: readonly BinMovement[] = [],
  /** What of each Lot left on a dispatched BKT (lotsSentOnBkts): taken off its Bin, the rest stays. */
  sent: ReadonlyMap<string, LotSent> = new Map(),
): Map<string, WarehouseBinStock> {
  const bins = new Map<string, WarehouseBinStock>();
  const binOf = (binCode: string) => {
    const bin = bins.get(binCode) ?? { binCode, kg: 0, issuedKg: 0, lots: [], movements: [] };
    bins.set(binCode, bin);
    return bin;
  };
  const add = (binCode: string, lot: LotInBin) => {
    const bin = binOf(binCode);
    bin.lots.push(lot);
    if (lot.kg !== undefined) bin.kg += lot.kg;
  };

  for (const r of receipts) {
    if (!procurementComplete(r)) continue;

    const base = {
      receiptId: r.id,
      lotNo: r.lotNo || r.stageData["n-lot"]?.["Lot Number"] || "",
      supplierName: r.supplierName,
      arrivalDate: r.arrivalDate,
      warehouse: r.warehouse,
    };

    const drying = r.stageData["n-drying"];
    let binCodes: string[];
    let kg: number | undefined;
    let dried = false;
    if (drying) {
      const back = driedReturn(r, roundsByLot.get(base.lotNo));
      if (!back) continue; // still out for drying
      binCodes = back.bins;
      kg = back.kg;
      dried = true;
    } else {
      binCodes = splitBinCodes(r.stageData["n-bin"]?.["Bin Number"] || r.binNo);
      kg = filled(r.stageData["n-grn"]?.[GRN_QUANTITY_LABEL]) ? parseQty(r.stageData["n-grn"]![GRN_QUANTITY_LABEL]) : undefined;
    }
    if (binCodes.length === 0) continue;
    // Left on a dispatched BKT: gone when all of it went (or a piece went with no weight, which can't be subtracted);
    // otherwise only what went is taken off and the rest is still in the Bin.
    const left = sent.get(r.id);
    let sentKg: number | undefined;
    if (left) {
      if (left.unknown || kg === undefined || left.kg >= kg) continue;
      kg -= left.kg;
      sentKg = left.kg;
    }

    if (binCodes.length > 1) {
      for (const code of binCodes) add(code, { ...base, state: "split_across_bins", dried });
    } else if (kg === undefined) {
      add(binCodes[0]!, { ...base, state: "weight_not_recorded", dried });
    } else {
      add(binCodes[0]!, { ...base, kg, state: "in_bin", dried, ...(sentKg !== undefined ? { sentKg } : {}) });
    }
  }
  // At the sending site a Lot leaves its Bin as its BKTs are dispatched (lotsSentOnBkts above); it counts here once it has
  // arrived. On the road it is in neither site's Bins, and never in both.
  for (const a of arrivals) {
    const lot = { receiptId: a.receiptId, lotNo: a.lotNo, supplierName: a.supplierName, arrivalDate: a.arrivalDate, dried: false, transferId: a.transferId, warehouse: a.toWarehouse, fromWarehouse: a.fromWarehouse };
    add(a.binCode, a.kg === undefined ? { ...lot, state: "weighed_with_other_lots" } : { ...lot, kg: a.kg, state: "in_bin", ...(a.kgShared ? { kgShared: true } : {}) });
  }
  for (const load of issued) {
    const bin = binOf(load.binCode);
    bin.issuedKg += load.netKg;
    bin.kg -= load.netKg;
  }
  // May take a Bin below zero (its Lots' GRN and a scale's net are different weighings): shown, never clamped.
  for (const m of movements) {
    const bin = binOf(m.binCode);
    bin.movements.push(m);
    bin.kg += m.kg;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  for (const bin of bins.values()) Object.assign(bin, { kg: round(bin.kg), issuedKg: round(bin.issuedKg) });
  return bins;
}

// ── The batch plan ───────────────────────────────────────────────────────────────────────────

export interface BatchPlan {
  plannedKg: number;
  /** Days at the daily capacity, rounded: 4,172.9 t ÷ 150 t ≈ 28. */
  days: number;
  /** ISO date: start + days. Undefined while the start date isn't a real date. */
  endDate?: string;
  /** Outside 3,700–4,500 t is a warning only; creating is never blocked. */
  withinMonthlyGuide: boolean;
}

export function addDays(isoDate: string, days: number): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function planBatch(binKgs: number[], startDate: string): BatchPlan {
  const plannedKg = Math.round(binKgs.reduce((a, b) => a + b, 0) * 100) / 100;
  const days = Math.round(plannedKg / DAILY_CAPACITY_KG);
  return {
    plannedKg,
    days,
    endDate: addDays(startDate, days),
    withinMonthlyGuide: plannedKg >= MONTHLY_GUIDE_KG.min && plannedKg <= MONTHLY_GUIDE_KG.max,
  };
}

/** "ANA-" + the largest bin's own suffix: BIN-03B → ANA-03B, as the client names its batches. */
export function suggestBatchCode(bins: { binCode: string; kg: number }[]): string {
  if (bins.length === 0) return "";
  const largest = bins.reduce((a, b) => (b.kg > a.kg ? b : a));
  return `ANA-${largest.binCode.replace(/^BIN-?/i, "")}`;
}

/** Same shape as a Bin code: letters, digits and - _ . only. */
export const BATCH_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;

// ── Status ──────────────────────────────────────────────────────────────────────────────────

/**
 * Open → In process (first load received) → Closed. Derived from the batch's RCN Receipts, never
 * typed. Closed doesn't exist until closing is built.
 */
export type BatchStatus = "open" | "in_process";

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = { open: "Waiting for first load", in_process: "In production" };

export function batchStatus(rcnReceiptCount: number): BatchStatus {
  return rcnReceiptCount > 0 ? "in_process" : "open";
}
