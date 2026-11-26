/**
 * Production Phase 0 (Batch): the rules both sides need.
 * Source: the client's "Production module" and "Phase 1 — Batch & Intake" documents (Oct 2026).
 *
 * A batch is a PLAN: a group of the factory's warehouse bins to be processed together, about one
 * month of work. Creating one moves no nuts and changes no stock.
 */
import type { ReceiptRecord, TransferLot, TransferRequest } from "../types/receipt.js";
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
  /**
   * The Lot's latest quality (lotReading): after drying when it was dried, else the final reading at reception, else the
   * truck's sample. What production plans by (26 Nov 2026, user: show moisture and KOR, not the trucks). Absent when none.
   */
  moisture?: number;
  kor?: number;
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
  /** Its quality as received here: the BKT's arrival readings, else what the Unit warehouse sent it with. */
  moisture?: number;
  kor?: number;
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
          ...reading(t.moistureReceived ?? l.moisture, t.korReceived ?? l.kor),
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
  /** Everything ever put into the Bin or taken out of it, most recent first (binHistory below). */
  history: BinHistoryEntry[];
}

/**
 * One entry of a Bin's history (25 Nov 2026: "what has been put inside a Bin", not only what is in it now). Every Lot ever
 * put in stays listed with what it brought, even once it has left; what left is its own entry. `kg` is signed: positive
 * came in, negative went out; undefined when no weight was recorded (`state` says why).
 */
export type BinHistoryKind = "lot_in" | "lot_arrived" | "lot_sent" | "production" | BinMovementKind;

export interface BinHistoryEntry {
  kind: BinHistoryKind;
  /** ISO date; "" when the record had none. */
  date: string;
  kg?: number;
  lotNo?: string;
  /** The truck's receipt, for a Lot. */
  receiptId?: string;
  /** The BKT, drying round, transfer lot or production load. */
  ref?: string;
  /** Why a Lot put in has no kg (as LotInBin). */
  state?: LotBinState;
  /** Put in after sun drying straight off the truck: the dried quantity. */
  dried?: boolean;
  kgShared?: boolean;
}

/**
 * RCN moved in or out of a Bin as a whole, not as a Lot. Once RCN is in a Bin its Lots can't be told apart (Sameer,
 * 18 Nov 2026: "once the bin is created, lot is gone"), so drying from a Bin and a truck loaded from a Bin move kg of the
 * Bin. `kg` is signed: negative leaves the Bin, positive comes into it.
 */
export type BinMovementKind = "drying_out" | "drying_back" | "transfer_out" | "transfer_in" | "lot_out" | "lot_back";

export interface BinMovement {
  binCode: string;
  kg: number;
  kind: BinMovementKind;
  /** The drying round, BKT or transfer lot it belongs to. */
  ref: string;
  /** ISO date, for listing; "" when the record had none. */
  date: string;
  /** The Lot it is: the transfer lot taken out, or the lot an arriving truck's piece became here. */
  lotNo?: string;
}

export const BIN_MOVEMENT_LABELS: Record<BinMovementKind, string> = {
  drying_out: "Taken for sun drying",
  drying_back: "Back from sun drying",
  transfer_out: "Sent on a transfer",
  transfer_in: "Arrived on a transfer",
  lot_out: "Made into a lot to send",
  lot_back: "Put back from a lot to send",
};

export const BIN_HISTORY_LABELS: Record<BinHistoryKind, string> = {
  lot_in: "Lot put in",
  lot_arrived: "Lot arrived on a transfer",
  lot_sent: "Lot sent on a transfer",
  production: "Taken by production",
  ...BIN_MOVEMENT_LABELS,
};

/**
 * What making transfer lots took out of Bins (24 Nov 2026). The bags leave their Bins when they are taken, but the kg is only
 * known once the lot is weighed: from then each Bin goes down by its share of the lot's net, by bags. On a truck the lot is in
 * no Bin, so loading it moves nothing more here; it arrives in the receiving Bin through binTransferMovements.
 */
export function binLotMovements(lots: readonly Pick<TransferLot, "lotNo" | "lotDate" | "bins" | "returns">[]): BinMovement[] {
  return lots.flatMap((l) => [
    ...l.bins.flatMap((b) => (b.netKg === null ? [] : [{ binCode: b.binCode.trim().toUpperCase(), kg: -b.netKg, kind: "lot_out" as const, ref: l.lotNo, date: l.lotDate, lotNo: l.lotNo }])),
    // Bags put back (26 Nov 2026): their share of the lot's net comes back, into whichever Bin they were put in.
    ...(l.returns ?? []).flatMap((r) => (r.netKg === null ? [] : [{ binCode: r.binCode.trim().toUpperCase(), kg: r.netKg, kind: "lot_back" as const, ref: l.lotNo, date: r.date, lotNo: l.lotNo }])),
  ]);
}

/** One sun-drying round started from a Bin (a DryingBatch row with a source Bin and no Lot). */
export interface BinDryingRoundFacts {
  id: string;
  /** The round's S.No at its warehouse: how people name a drying ("Drying #12"), never the database id. */
  sn: number;
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
    // Named by round 1's S.No, as the drying list numbers it, with the round it came back from when there were several. The
    // database id was shown here until 26 Nov 2026 (user: "primary key is appearing").
    const name = `Drying #${first.sn}`;
    const from = (first.sourceBinNo ?? "").trim().toUpperCase();
    if (from && first.issuedNetWeightKg !== null) {
      out.push({ binCode: from, kg: -first.issuedNetWeightKg, kind: "drying_out", ref: name, date: first.date });
    }
    const to = (last.destinationBinNo ?? "").trim().toUpperCase();
    if (dryingPhase(last.status) === "passed" && to && last.receivedNetWeightKg !== null) {
      const rounds = (last.round ?? 1) > 1 ? ` · after round ${last.round}` : "";
      out.push({ binCode: to, kg: last.receivedNetWeightKg, kind: "drying_back", ref: `${name}${rounds}`, date: last.date });
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
        out.push({ binCode: to, kg: share.kg, kind: "transfer_in", ref: t.id, date: (t.receivedAt ?? "").slice(0, 10), ...(l.receivedLotNo ? { lotNo: l.receivedLotNo } : {}) });
      }
    });
  }
  return out;
}

/**
 * A load production may not take: more than its Bin holds (25 Nov 2026, the team: "it can't be allowed"), not even by a
 * kilo. The Bin's stock is the one every page shows (warehouseBinStock); until it is corrected, the load waits.
 */
export function productionLoadStockProblem(binCode: string, binKg: number, loadKg: number): string | null {
  if (loadKg <= binKg) return null;
  const kg = (x: number) => `${x.toLocaleString("en-US", { maximumFractionDigits: 2 })} kg`;
  return `Bin ${binCode} holds ${kg(Math.max(binKg, 0))}${binKg < 0 ? ` (its stock is already ${kg(binKg)})` : ""}, less than this load's ${kg(loadKg)}. It can't be accepted until the Bin's stock is corrected: check its Lots' GRN weights and what was taken out of it.`;
}

/** A load production accepted out of a warehouse bin: its net weight (pallets and bags off) has left the bin. */
export interface IssuedLoad {
  binCode: string;
  netKg: number;
  /** For the Bin's history: the day production accepted it, and its load (RCN receipt) number. */
  date?: string;
  ref?: string;
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
  return r.source === "imported" ? Boolean(r.stageData["n-grn"]) : isGrnComplete(r.stageData, !r.transfer);
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
  for (const l of lotLinesSentOnBkts(transfers, site)) {
    const was = out.get(l.receiptId) ?? { kg: 0, unknown: false };
    out.set(l.receiptId, l.kg === null ? { ...was, unknown: true } : { ...was, kg: was.kg + l.kg });
  }
  return out;
}

/** One Lot line that left this site on a dispatched BKT: what lotsSentOnBkts adds up, kept line by line for a Bin's history. */
export interface LotSentLine { receiptId: string; kg: number | null; ref: string; date: string }

export function lotLinesSentOnBkts(transfers: readonly TransferRequest[], site: readonly string[]): LotSentLine[] {
  return transfers
    .filter((t) => t.status !== "requested" && site.includes(t.fromWarehouse))
    .flatMap((t) => t.lines.filter((l) => l.receiptId).map((l) => ({
      receiptId: l.receiptId!, kg: l.netWeightKg, ref: t.id, date: (t.dispatchedAt ?? t.transferDate ?? "").slice(0, 10),
    })));
}

/** The facts of one drying round (a DryingBatch row) that say whether, and where, a Lot came back from drying. */
export interface DryingRoundFacts {
  sn: number;
  status: string | null;
  /** "entered": sun drying done in the app. Imported workbook rows are left to the receipt's own Drying fields. */
  source: string | null;
  receivedNetWeightKg: number | null;
  destinationBinNo: string | null;
  /** The quality check after the round, when it was recorded: the dried RCN's quality (lotReading). */
  outputMoisturePct?: number | null;
  outputKor?: number | null;
}

const DRIED_KG = "Dried quantity returned to warehouse";

/** Only the readings there are: an absent one is left out, never shown as 0. */
const reading = (moisture: number | null | undefined, kor: number | null | undefined) => ({
  ...(moisture !== null && moisture !== undefined && Number.isFinite(moisture) ? { moisture } : {}),
  ...(kor !== null && kor !== undefined && Number.isFinite(kor) ? { kor } : {}),
});
const typed = (sd: ReceiptRecord["stageData"], stage: string, ...labels: string[]) =>
  labels.map((l) => parseQty(sd[stage]?.[l])).find((v) => v !== undefined);

/**
 * A Lot's latest moisture and KOR (26 Nov 2026, user: production plans by them). Dried RCN is what drying made it: the last
 * in-app round's check, else the imported Drying step's moisture after; the rest is the reception's — the final readings
 * after unloading, else the truck sample's. KOR isn't measured again by an imported drying, so it falls back the same way.
 */
export function lotReading(r: Pick<ReceiptRecord, "stageData">, rounds: readonly DryingRoundFacts[] = [], dried = false): { moisture?: number; kor?: number } {
  const sd = r.stageData;
  const reception = { moisture: typed(sd, "n-qfs", "Final moisture (%)", "Sample moisture (%)"), kor: typed(sd, "n-qfs", "FINAL KOR", "KOR") };
  if (!dried) return reading(reception.moisture, reception.kor);
  const last = rounds.filter((b) => b.source === "entered").sort((a, b) => a.sn - b.sn).at(-1);
  if (last) return reading(last.outputMoisturePct ?? reception.moisture, last.outputKor ?? reception.kor);
  return reading(typed(sd, "n-drying", "Moisture % — after drying") ?? reception.moisture, reception.kor);
}

/** A Bin's quality: its Lots' readings averaged by their kg (a Lot whose kg isn't known counts once, like a 1 kg Lot never would). */
export interface BinQuality {
  moisture: number | null;
  kor: number | null;
  /** The lowest and highest Lot reading: a Bin mixes Lots, so the spread matters as much as the average. */
  moistureRange: [number, number] | null;
  korRange: [number, number] | null;
  /** How many of the Bin's Lots have a reading, of how many. */
  measured: number;
  lots: number;
}

export function binQuality(lots: readonly Pick<LotInBin, "kg" | "moisture" | "kor">[]): BinQuality {
  const of = (key: "moisture" | "kor") => {
    const known = lots.filter((l) => l[key] !== undefined);
    if (!known.length) return { avg: null, range: null };
    // Weighted by kg where every measured Lot has its kg; otherwise a plain average (a Lot with no kg can't be weighed in).
    const weighted = known.every((l) => (l.kg ?? 0) > 0);
    const w = (l: (typeof known)[number]) => (weighted ? l.kg! : 1);
    const total = known.reduce((a, l) => a + w(l), 0);
    const avg = Math.round((known.reduce((a, l) => a + l[key]! * w(l), 0) / total) * 100) / 100;
    const values = known.map((l) => l[key]!);
    return { avg, range: [Math.min(...values), Math.max(...values)] as [number, number] };
  };
  const m = of("moisture");
  const k = of("kor");
  return { moisture: m.avg, kor: k.avg, moistureRange: m.range, korRange: k.range, measured: lots.filter((l) => l.moisture !== undefined || l.kor !== undefined).length, lots: lots.length };
}
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
  r: Pick<ReceiptRecord, "branches" | "stageData" | "binNo" | "source" | "transfer">,
  /** This Lot's drying rounds: sun drying done in the app records what came back there, not on the Drying step. */
  rounds: readonly DryingRoundFacts[] = [],
): string[] {
  const drying = r.stageData["n-drying"];
  const dried = !drying || driedReturn(r, rounds) !== undefined;
  return [
    r.branches["n-qfs"] !== "pass" && "pass Quality",
    binsOfLot(r, rounds).length === 0 && "allocate a Bin",
    !(r.source === "imported" ? Boolean(r.stageData["n-grn"]) : isGrnComplete(r.stageData, !r.transfer)) && (r.transfer ? "complete the GRN (quantity)" : "complete the GRN (quantity and price)"),
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
  /** The same, line by line (lotLinesSentOnBkts): only for the Bins' history, never for their kg. */
  sentLines: readonly LotSentLine[] = [],
): Map<string, WarehouseBinStock> {
  const bins = new Map<string, WarehouseBinStock>();
  const binOf = (binCode: string) => {
    const bin = bins.get(binCode) ?? { binCode, kg: 0, issuedKg: 0, lots: [], movements: [], history: [] };
    bins.set(binCode, bin);
    return bin;
  };
  const record = (binCode: string, entry: BinHistoryEntry) => binOf(binCode).history.push(entry);
  const sentByReceipt = new Map<string, LotSentLine[]>();
  for (const l of sentLines) sentByReceipt.set(l.receiptId, [...(sentByReceipt.get(l.receiptId) ?? []), l]);
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
    // The history keeps every Lot ever put in, with all it brought, before anything that left is taken off below. Its day is
    // the day the truck was unloaded (the bags go into the Bin then), else its arrival. Not the Bin allocation date: that is
    // when the allocation was finalised in the app — 24 Nov 2026 on trucks unloaded months before.
    const putIn = { kind: "lot_in" as const, date: (r.stageData["n-unload"]?.["DATE OF OFFLOADING"] ?? "").trim() || r.arrivalDate, lotNo: base.lotNo, receiptId: r.id, ...(dried ? { dried } : {}) };
    if (binCodes.length > 1) for (const code of binCodes) record(code, { ...putIn, state: "split_across_bins" });
    else {
      record(binCodes[0]!, kg === undefined ? { ...putIn, state: "weight_not_recorded" } : { ...putIn, kg });
      for (const l of sentByReceipt.get(r.id) ?? []) {
        record(binCodes[0]!, { kind: "lot_sent", date: l.date, lotNo: base.lotNo, receiptId: r.id, ref: l.ref, ...(l.kg !== null ? { kg: -l.kg } : {}) });
      }
    }
    // Left on a dispatched BKT: gone when all of it went (or a piece went with no weight, which can't be subtracted);
    // otherwise only what went is taken off and the rest is still in the Bin.
    const left = sent.get(r.id);
    let sentKg: number | undefined;
    if (left) {
      if (left.unknown || kg === undefined || left.kg >= kg) continue;
      kg -= left.kg;
      sentKg = left.kg;
    }

    const lot = { ...base, ...lotReading(r, roundsByLot.get(base.lotNo), dried) };
    if (binCodes.length > 1) {
      for (const code of binCodes) add(code, { ...lot, state: "split_across_bins", dried });
    } else if (kg === undefined) {
      add(binCodes[0]!, { ...lot, state: "weight_not_recorded", dried });
    } else {
      add(binCodes[0]!, { ...lot, kg, state: "in_bin", dried, ...(sentKg !== undefined ? { sentKg } : {}) });
    }
  }
  // At the sending site a Lot leaves its Bin as its BKTs are dispatched (lotsSentOnBkts above); it counts here once it has
  // arrived. On the road it is in neither site's Bins, and never in both.
  for (const a of arrivals) {
    const lot = { receiptId: a.receiptId, lotNo: a.lotNo, supplierName: a.supplierName, arrivalDate: a.arrivalDate, dried: false, transferId: a.transferId, warehouse: a.toWarehouse, fromWarehouse: a.fromWarehouse, ...reading(a.moisture, a.kor) };
    record(a.binCode, { kind: "lot_arrived", date: a.arrivalDate, lotNo: a.lotNo, receiptId: a.receiptId, ref: a.transferId, ...(a.kg === undefined ? { state: "weighed_with_other_lots" as const } : { kg: a.kg }), ...(a.kgShared ? { kgShared: true } : {}) });
    add(a.binCode, a.kg === undefined ? { ...lot, state: "weighed_with_other_lots" } : { ...lot, kg: a.kg, state: "in_bin", ...(a.kgShared ? { kgShared: true } : {}) });
  }
  for (const load of issued) {
    const bin = binOf(load.binCode);
    bin.issuedKg += load.netKg;
    bin.kg -= load.netKg;
    record(load.binCode, { kind: "production", date: load.date ?? "", kg: -load.netKg, ...(load.ref ? { ref: load.ref } : {}) });
  }
  // May take a Bin below zero (its Lots' GRN and a scale's net are different weighings): shown, never clamped.
  for (const m of movements) {
    const bin = binOf(m.binCode);
    bin.movements.push(m);
    bin.kg += m.kg;
    record(m.binCode, { kind: m.kind, date: m.date, kg: m.kg, ref: m.ref, ...(m.lotNo ? { lotNo: m.lotNo } : {}) });
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  for (const bin of bins.values()) {
    Object.assign(bin, { kg: round(bin.kg), issuedKg: round(bin.issuedKg) });
    // Most recent first; an entry with no date last. Stable, so one day's entries keep the order they happened in.
    bin.history.sort((a, b) => (!a.date ? 1 : !b.date ? -1 : b.date.localeCompare(a.date)));
  }
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
