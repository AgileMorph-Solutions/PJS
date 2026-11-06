/**
 * Production Phase 1, steps 3–4 (Weigh pallets, Final weight), from the client's "RCN Receipts Tally Sheet"
 * (docs/Production/19.RCN Receipts Tally Sheet.xlsx, form ANGR-PG-FRM-025). Its "Online" sheet is one row per
 * pallet of a BTM (gross kg, no. of bags, factory bin); its "Print" form closes the load with the empty
 * pallets' weight, dust and voids. Every total here is calculated from those, never stored.
 */

/** The sheet's own bags-weight formula on every row: `=J*0.65` (one jute bag = 0.65 kg). */
export const JUTE_BAG_KG = 0.65;

const num = (v: string | undefined): number | null => {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

const isWhole = (n: number) => Number.isInteger(n);

/** Kg to 2 decimals, so summed floats (the sheet's own pivot shows 98009.69999999998) read as the scale did. */
const kg2 = (n: number) => Math.round(n * 100) / 100;

export interface PalletValues {
  grossKg?: string;
  bags?: string;
  /**
   * The factory bin the pallet goes into. Per pallet, not per load: in the sheet one BTM from BIN-16 went to
   * both ANA-16 and ANA-03B (BTM 121).
   */
  factoryBin?: string;
}

/** One pallet row's checks; the first problem found, or null. Values are kept exactly as typed. */
export function palletError(v: PalletValues): string | null {
  const gross = num(v.grossKg);
  if (gross === null) return "Enter the pallet's gross weight.";
  if (Number.isNaN(gross) || gross <= 0) return "Gross weight must be a number of kg above 0.";
  const bags = num(v.bags);
  if (bags === null) return "Enter the number of bags on the pallet.";
  if (Number.isNaN(bags) || bags <= 0 || !isWhole(bags)) return "Number of bags must be a whole number above 0.";
  if (!(v.factoryBin ?? "").trim()) return "Enter the factory bin the pallet goes into.";
  return null;
}

/**
 * One weighing of empty pallets. The Print form's "Empty pallets weight (kg) / NO of pallets" table: pallets
 * are weighed in stacks (BTM 130's 3,159.2 kg is ten weighings, 374.3 + 211.2 + …). The Online sheet keeps
 * no count, so the count is optional.
 */
export interface EmptyPalletStackValues {
  weightKg?: string;
  count?: string;
}

export interface FinalWeightValues {
  emptyPallets?: EmptyPalletStackValues[];
  /** Optional: the sheet has dust and voids for BTM 109–130, none after. Blank is "not recorded", not 0. */
  dustKg?: string;
  voidsKg?: string;
}

/** The Final weight form's checks, given how many pallets were weighed. */
export function finalWeightError(v: FinalWeightValues, palletCount: number): string | null {
  if (palletCount === 0) return "Weigh at least one pallet before the final weight.";
  const stacks = (v.emptyPallets ?? []).filter((s) => (s.weightKg ?? "").trim() !== "" || (s.count ?? "").trim() !== "");
  // Every load in the sheet has a pallet weight, so the net is never left including the pallets.
  if (stacks.length === 0) return "Enter the empty pallets' weight.";
  for (const s of stacks) {
    const w = num(s.weightKg);
    if (w === null || Number.isNaN(w) || w <= 0) return "Each empty-pallet weight must be a number of kg above 0.";
    const c = num(s.count);
    if (c !== null && (Number.isNaN(c) || c <= 0 || !isWhole(c))) return "Number of pallets must be a whole number above 0.";
  }
  for (const [key, label] of [["dustKg", "Dust"], ["voidsKg", "Voids"]] as const) {
    const n = num(v[key]);
    if (n !== null && (Number.isNaN(n) || n < 0)) return `${label} must be a number of kg, 0 or more.`;
  }
  return null;
}

export interface WeighingTotals {
  pallets: number;
  bags: number;
  grossKg: number;
  /** bags × JUTE_BAG_KG */
  bagsKg: number;
  /** The empty pallets' weight, summed over the stacks. */
  palletKg: number;
  /** "Total Net Weight Received" = gross − bags − pallets (the sheet's `=I-K-L`). */
  netKg: number;
  dustKg: number;
  voidsKg: number;
  /** "Net Weight Transferred to Silos" = net − dust − voids (the sheet's `=R10-R11-R12`). */
  toSilosKg: number;
}

/**
 * The Print form's summary box. Works on a load still being weighed too (no empty pallets yet → palletKg 0),
 * so the screen can show a running total. Real check: BTM 130 → net 98,009.7 kg, as the client's pivot.
 */
export function weighingTotals(
  pallets: { grossKg: string; bags: string }[],
  final: { emptyPallets: { weightKg: string }[]; dustKg?: string; voidsKg?: string } = { emptyPallets: [] },
): WeighingTotals {
  const sum = (xs: (string | undefined)[]) => xs.reduce((n, x) => n + (num(x) || 0), 0);
  const bags = sum(pallets.map((p) => p.bags));
  const grossKg = kg2(sum(pallets.map((p) => p.grossKg)));
  const bagsKg = kg2(bags * JUTE_BAG_KG);
  const palletKg = kg2(sum(final.emptyPallets.map((s) => s.weightKg)));
  const netKg = kg2(grossKg - bagsKg - palletKg);
  const dustKg = kg2(num(final.dustKg) || 0);
  const voidsKg = kg2(num(final.voidsKg) || 0);
  return { pallets: pallets.length, bags, grossKg, bagsKg, palletKg, netKg, dustKg, voidsKg, toSilosKg: kg2(netKg - dustKg - voidsKg) };
}

/** Dust % and Voids %, of the net received, as the Calibration Process report: BTM 113 → 1,250 of 137,831.9 kg = 0.91 %. */
export const pctOfNet = (kg: number, netKg: number): number => (netKg > 0 ? (kg / netKg) * 100 : 0);

/**
 * A soft note, never a refusal: the counts typed with the empty pallets don't add up to the pallets weighed.
 * Null when they agree or when any count was left blank.
 */
export function emptyPalletCountNote(stacks: EmptyPalletStackValues[], palletCount: number): string | null {
  const counts = stacks.filter((s) => (s.weightKg ?? "").trim() !== "").map((s) => num(s.count));
  if (counts.length === 0 || counts.some((c) => c === null || Number.isNaN(c))) return null;
  const total = counts.reduce<number>((n, c) => n + (c ?? 0), 0);
  return total === palletCount ? null : `The empty pallets add up to ${total}, but ${palletCount} pallet${palletCount === 1 ? " was" : "s were"} weighed.`;
}
