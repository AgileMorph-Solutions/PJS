/**
 * Transfer lots (24 Nov 2026). A Bin at the Unit warehouse holds hundreds of tonnes, so it is never sent whole: bags are
 * taken out of one or more Bins and weighed together, and that lot is what goes on trucks (BKTs) to the Central warehouse.
 * A lot can go on several trucks and a truck can carry several lots. The client's dispatch sheet has no lot column, so the
 * lot number is issued from the warehouse's own Lot numbers (LOT-<code>-<year>-NNNN) and may be changed.
 *
 * Pure: the forms show these problems as values are typed, and the server refuses the same hard ones. Two kinds, as agreed
 * with the user (24 Nov 2026): a HARD problem is a value that can't be right — letters in a number, a negative weight,
 * half a bag, a required value missing — and is never saved; a SOFT one is unusual but possible (a bag far from 80 kg, a
 * reading far from what was sent) and only warns.
 */
import { BAG_WEIGHT_KG, parseQty } from "./receiptMath.js";
import { BAG_KG_RANGE, numberProblem, type NumberRule } from "./fieldRules.js";
import { USUAL_RANGES as U } from "../data/fieldRanges.js";
import type { TransferLotStatus } from "../types/receipt.js";

/** What is wrong with a value: `soft` warns, otherwise it can't be saved. The shape ui/Input's Field shows. */
export interface FieldProblem {
  message: string;
  soft: boolean;
}

const hard = (message: string): FieldProblem => ({ message, soft: false });
const soft = (message: string): FieldProblem => ({ message, soft: true });

export const TRANSFER_LOT_STATUS_LABELS: Record<TransferLotStatus, string> = {
  waiting_weight: "Waiting for weight",
  waiting_quality: "Waiting for quality",
  ready: "Ready to load",
  part_loaded: "Partly loaded",
  loaded: "All loaded",
  put_back: "Put back in Bins",
  closed: "Loaded, rest put back",
};

/**
 * The numbers on transfer forms. Hard limits are only what can't be: moisture over 100 %, KOR over 80 lbs, part of a bag.
 * Each also has its usual range from the 2026 workbooks (26 Nov 2026, data/fieldRanges.ts: the Bouaké dispatch sheet for a
 * lot's bags and weight on a truck, the Yakro receiving sheet for what arrived); outside it only warns.
 */
export const TRANSFER_NUMBER_RULES = {
  /** Bags taken from a Bin, or put on a truck: at least one, never part of one. */
  bags: { integer: true, positive: true, unit: "bags", usual: U.lineBags },
  /** Bags counted off at arrival: 0 is a real count (everything missing), half a bag is not. */
  bagsCounted: { integer: true, min: 0, unit: "bags", usual: U.truckBags },
  damagedBags: { integer: true, min: 0, unit: "bags", usual: U.arrivalDamagedBags },
  lotWeightKg: { positive: true, unit: "kg", usual: U.lineKg },
  truckWeightKg: { positive: true, unit: "kg", usual: U.truckLoadKg },
  moisture: { min: 0, max: 100, unit: "%", usual: U.moisture },
  kor: { min: 0, max: 80, unit: "lbs", usual: U.kor },
  nutCount: { integer: true, positive: true, unit: "nuts per kg", usual: U.nutCount },
} satisfies Record<string, NumberRule>;

export type TransferNumberKind = keyof typeof TRANSFER_NUMBER_RULES;

/**
 * A typed number on a transfer form, or undefined when it is fine. `required` makes a blank a hard problem; otherwise blank
 * is "not entered", never wrong. A negative is said plainly before the rule's own range.
 */
export function transferNumberProblem(kind: TransferNumberKind, raw: string | number | null | undefined, required = false): FieldProblem | undefined {
  const value = String(raw ?? "").trim();
  if (!value) return required ? hard("Required.") : undefined;
  const n = parseQty(value);
  if (n !== undefined && n < 0) return hard("Can't be negative.");
  const p = numberProblem(TRANSFER_NUMBER_RULES[kind], value);
  return p ? { message: p.message, soft: p.soft } : undefined;
}

/** A number already checked by transferNumberProblem; null when blank. */
export const readNumber = (raw: string | number | null | undefined): number | null => {
  const value = String(raw ?? "").trim();
  return value ? parseQty(value) ?? null : null;
};

/**
 * How a Lot number may be written: letters and digits, with - or / between them, up to 40 characters (LOT-BKE-2026-0007,
 * or a warehouse's own "3"). Stored in capitals, so "lot-bke-…" and "LOT-BKE-…" can never be two different lots.
 */
const LOT_NO = /^[A-Z0-9](?:[A-Z0-9/-]{0,38}[A-Z0-9])?$/;

export const normalizeLotNo = (raw: string | number | null | undefined) => String(raw ?? "").trim().toUpperCase();

export function lotNoProblem(raw: string | number | null | undefined): FieldProblem | undefined {
  const v = normalizeLotNo(raw);
  if (!v) return hard("Enter the Lot number.");
  return LOT_NO.test(v) ? undefined : hard("Letters, numbers, - and / only (up to 40).");
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Net of a weighing: the scale reads RCN plus bags, 1 kg per jute bag (receiptMath's BAG_WEIGHT_KG). */
export const lotNetKg = (grossKg: number | null, bags: number): number | null => (grossKg === null ? null : round2(grossKg - bags * BAG_WEIGHT_KG));

/**
 * `totalKg` shared by bag counts: the lot is weighed once, so each Bin's share (or each truck's piece) is worked out from its
 * bags. The last share takes the rounding remainder, so the shares always add up to the total exactly.
 */
export function shareByBags(totalKg: number | null, bags: readonly number[]): (number | null)[] {
  const all = bags.reduce((a, b) => a + b, 0);
  if (totalKg === null || all <= 0) return bags.map(() => null);
  let given = 0;
  return bags.map((b, i) => {
    if (i === bags.length - 1) return round2(totalKg - given);
    const share = round2((totalKg * b) / all);
    given += share;
    return share;
  });
}

/** The net kg of `pieceBags` bags of a lot: the lot was weighed as one, so a piece of it is its share by bags. */
export const pieceNetKg = (lotNet: number | null, lotBags: number, pieceBags: number): number | null =>
  lotNet === null || lotBags <= 0 ? null : round2((lotNet * pieceBags) / lotBags);

/**
 * Bags and kg of a lot still to go on a truck. A piece on any BKT counts as sent, even a rejected one: the truck left. Bags put
 * back in a Bin (26 Nov 2026) are no longer the lot's to send either.
 */
export function lotLeft(bags: number, netKg: number | null, pieces: readonly { bags: number }[], returns: readonly { bags: number }[] = []): { leftBags: number; leftKg: number | null } {
  const leftBags = bags - pieces.reduce((a, p) => a + p.bags, 0) - returns.reduce((a, r) => a + r.bags, 0);
  return { leftBags, leftKg: pieceNetKg(netKg, bags, Math.max(leftBags, 0)) };
}

/**
 * Where a lot stands. Once nothing is left, it ended on trucks, back in Bins, or both. A weighed lot whose quality isn't recorded
 * yet (the QFS Officer's to measure, 26 Nov 2026) waits for it: its quality is what leaves with it on the truck.
 */
export function transferLotStatus(weighed: boolean, leftBags: number, pieces: number, returns = 0, hasQuality = true): TransferLotStatus {
  if (!weighed) return "waiting_weight";
  if (!hasQuality && pieces === 0 && returns === 0) return "waiting_quality";
  if (leftBags > 0) return pieces === 0 ? "ready" : "part_loaded";
  if (returns === 0) return "loaded";
  return pieces === 0 ? "put_back" : "closed";
}

/**
 * Putting bags of a lot back in a Bin (26 Nov 2026, user: half a lot went on the truck, the rest stays). Only bags not on a
 * truck, and only once the lot is weighed: before that its Bins haven't lost any kg, so nothing is to be given back — change the
 * lot's bags or delete it instead. A Bin of the lot's own warehouse is checked by the server.
 */
export function putBackProblems(d: { binCode: string; bags: string; date: string }, lot: { weighed: boolean; leftBags: number }, today: string): Record<string, FieldProblem> {
  const out: Record<string, FieldProblem> = {};
  if (!lot.weighed) out.bags = hard("Weigh the lot first. Until then its Bins haven't lost anything: change its bags or delete it instead.");
  if (!d.binCode.trim()) out.binCode = hard("Choose the Bin the bags go into.");
  const bags = transferNumberProblem("bags", d.bags, true);
  if (bags) out.bags ??= bags;
  else if (readNumber(d.bags)! > lot.leftBags) {
    out.bags ??= hard(lot.leftBags > 0 ? `Only ${lot.leftBags.toLocaleString("en-US")} bags of this lot aren't on a truck.` : "Every bag of this lot is on a truck or already put back.");
  }
  const date = d.date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) out.date = hard("Enter the date.");
  else if (date > today) out.date = hard("Can't be in the future.");
  return out;
}

// ── The forms ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** "Make a lot": the Bins and the bags taken from each. Weight comes after, once the bags have been weighed. */
export interface LotBinsDraft {
  lotNo: string;
  lotDate: string;
  bins: readonly { binCode: string; bags: string }[];
}

/**
 * Problems on the "make a lot" form, keyed by field: lotNo, lotDate, bins (the list as a whole), bin.<i>, bags.<i>. A Bin
 * twice is one Bin: its bags go on one line.
 */
export function lotBinsProblems(d: LotBinsDraft): Record<string, FieldProblem> {
  const out: Record<string, FieldProblem> = {};
  const set = (key: string, p: FieldProblem | undefined) => { if (p) out[key] = p; };
  set("lotNo", lotNoProblem(d.lotNo));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.lotDate.trim())) out.lotDate = hard("Enter the date.");
  if (!d.bins.length) out.bins = hard("Add at least one Bin.");
  const seen = new Set<string>();
  d.bins.forEach((b, i) => {
    const code = b.binCode.trim().toUpperCase();
    if (!code) out[`bin.${i}`] = hard("Choose the Bin.");
    else if (seen.has(code)) out[`bin.${i}`] = hard("This Bin is already on the lot.");
    seen.add(code);
    set(`bags.${i}`, transferNumberProblem("bags", b.bags, true));
  });
  return out;
}

/**
 * "Record weight": what the scale read once the bags were weighed, and the lot's quality. The weight is required; the quality
 * is the QFS Officer's to measure (26 Nov 2026), so it may be left for them — but all three together or none, and all three
 * before the lot goes on a truck.
 */
export interface LotWeighingDraft {
  grossWeightKg: string;
  moisture: string;
  kor: string;
  nutCount: string;
}

/** Problems on the weighing form, keyed by field. `bags` is the lot's, to judge the weight with. */
export function lotWeighingProblems(d: LotWeighingDraft, bags: number): Record<string, FieldProblem> {
  const out: Record<string, FieldProblem> = {};
  const set = (key: string, p: FieldProblem | undefined) => { if (p) out[key] = p; };
  set("grossWeightKg", transferNumberProblem("lotWeightKg", d.grossWeightKg, true) ?? weightPerBagProblem(readNumber(d.grossWeightKg), bags));
  const anyQuality = [d.moisture, d.kor, d.nutCount].some((v) => String(v ?? "").trim() !== "");
  set("moisture", transferNumberProblem("moisture", d.moisture, anyQuality));
  set("kor", transferNumberProblem("kor", d.kor, anyQuality));
  set("nutCount", transferNumberProblem("nutCount", d.nutCount, anyQuality));
  return out;
}

/** What a full bag weighs on the scale: about 80 kg of RCN (BAG_KG_RANGE's middle) and its 1 kg jute bag. */
export const SUGGESTED_KG_PER_BAG = (BAG_KG_RANGE.min + BAG_KG_RANGE.max) / 2 + BAG_WEIGHT_KG;

/** The weight the scale should read for `bags` full bags, offered on the form (user, 24 Nov 2026: suggest, don't warn). */
export const suggestedScaleWeightKg = (bags: number): number => bags * SUGGESTED_KG_PER_BAG;

/**
 * A scale's weight against the bags it holds. Any weight saves, with no warning (user, 24 Nov 2026: the per-bag warning was
 * misleading; the form suggests a weight instead). Only one that leaves no RCN at all — no more than the empty bags weigh —
 * is refused: its net would be negative and add stock to the Bins instead of taking it out.
 */
export function weightPerBagProblem(grossKg: number | null, bags: number): FieldProblem | undefined {
  if (grossKg === null || bags <= 0 || lotNetKg(grossKg, bags)! > 0) return undefined;
  const empty = (bags * BAG_WEIGHT_KG).toLocaleString("en-US");
  return hard(`Must be more than ${empty} kg: the empty bags alone weigh that.`);
}

/**
 * The bags of a lot put on one truck. More than is left of it is refused: it would send stock that isn't there (the same
 * rule a Lot split across trucks has, transfers.ts lotPieceProblem).
 */
export function lotPieceProblem(raw: string | number | null | undefined, leftBags: number): FieldProblem | undefined {
  const p = transferNumberProblem("bags", raw, true);
  if (p) return p;
  const n = readNumber(raw)!;
  if (leftBags <= 0) return hard("Nothing of this lot is left to load.");
  return n > leftBags ? hard(`Only ${leftBags.toLocaleString("en-US")} bags of this lot are left to load.`) : undefined;
}

/**
 * The net kg of a lot's piece on one truck. It starts as the piece's share of the lot's weighing (pieceNetKg) and may be
 * changed (user, 24 Nov 2026): a letter, a negative or 0 can't be right; more than 5 % from the share only warns, since the
 * lot was weighed and the truck will be.
 */
export const PIECE_WEIGHT_TOLERANCE = 0.05;

export function pieceWeightProblem(raw: string | number | null | undefined, byBagsKg: number | null): FieldProblem | undefined {
  const p = transferNumberProblem("lotWeightKg", raw, true);
  if (p) return p;
  const kg = readNumber(raw)!;
  if (byBagsKg === null || byBagsKg <= 0 || Math.abs(kg - byBagsKg) / byBagsKg <= PIECE_WEIGHT_TOLERANCE) return undefined;
  return soft(`By the lot's weighing these bags are ${byBagsKg.toLocaleString("en-US", { maximumFractionDigits: 2 })} kg. Please check.`);
}

/**
 * Taking more out of a Bin than its stock shows. A warning only: a Bin's stock is worked out from records that may be
 * incomplete (an imported Lot with no GRN weight), so the warehouse's own count decides.
 */
export function binDrawProblem(binKg: number, takenKg: number | null): FieldProblem | undefined {
  if (takenKg === null || takenKg <= binKg) return undefined;
  const kg = (x: number) => `${Math.round(x).toLocaleString("en-US")} kg`;
  return soft(`This Bin holds only ${kg(Math.max(binKg, 0))}, less than these bags weigh. Please check the bags.`);
}
