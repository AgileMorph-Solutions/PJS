/**
 * Production Phase 4: Shelling's day record. Every formula is the document's; all of them were checked against the
 * client's "7. Shelling process Report" and hold on all 107 Lots shelled, to the gram.
 */

const num = (v: string | undefined | null): number | null => {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const n0 = (v: string | undefined | null) => num(v) || 0;
const kg3 = (n: number) => Math.round(n * 1000) / 1000;

/** The doc: "Shell dust = 1.5 % × input". The sheet has that on 71 of 107 rows; the rest look weighed (1.2–1.34 %). */
export const SHELL_DUST_RATE = 0.015;
/** The sheet's SHOT: good kernel per 80 kg bag in lbs. Its own factor, 176.36, to the last decimal on all 107 rows. */
const SHOT_FACTOR = 176.36;

export const SHELLING_KG_FIELDS = [
  ["wholesKg", "Wholes"],
  ["piecesKg", "Pieces"],
  ["rejectionKg", "Rejection"],
  ["oilKg", "Oil"],
  ["blackRejectionKg", "Black rejection"],
  ["firstPassUncutKg", "First-pass uncut"],
  ["finalUncutKg", "Final uncut"],
] as const;

export type ShellingKgField = (typeof SHELLING_KG_FIELDS)[number][0];

export type ShellingDayValues = Partial<Record<ShellingKgField | "inputKg" | "date", string>>;

export interface ShellingFigures {
  goodKg: number;
  finalKg: number;
  shellDustKg: number;
  /** "Shell is calculated, not weighed." */
  shellKg: number;
  yieldPct: number;
  realisationPct: number;
  wholesPct: number;
  brokensPct: number;
  uncutPct: number;
  finalUncutPct: number;
  shellPct: number;
  shotLbs: number;
}

/** Real check, the doc's 21/07: 151,367 in → good 38,126.9 (25.19 %), final 39,529.2, shell 109,567.3, wholes 97.0 %. */
export function shellingFigures(v: ShellingDayValues): ShellingFigures {
  const input = n0(v.inputKg);
  const goodKg = kg3(n0(v.wholesKg) + n0(v.piecesKg));
  const finalKg = kg3(goodKg + n0(v.rejectionKg) + n0(v.oilKg) + n0(v.blackRejectionKg));
  const shellDustKg = kg3(input * SHELL_DUST_RATE);
  const shellKg = kg3(input - finalKg - shellDustKg);
  const ofInput = (kg: number) => (input > 0 ? (kg / input) * 100 : 0);
  const ofGood = (kg: number) => (goodKg > 0 ? (kg / goodKg) * 100 : 0);
  return {
    goodKg, finalKg, shellDustKg, shellKg,
    yieldPct: ofInput(goodKg),
    realisationPct: ofInput(finalKg),
    wholesPct: ofGood(n0(v.wholesKg)),
    brokensPct: ofGood(n0(v.piecesKg)),
    uncutPct: ofInput(n0(v.firstPassUncutKg)),
    finalUncutPct: ofInput(n0(v.finalUncutKg)),
    shellPct: ofInput(shellKg),
    shotLbs: input > 0 ? (goodKg / input) * SHOT_FACTOR : 0,
  };
}

export function shellingDayError(v: ShellingDayValues): string | null {
  if (!(v.date ?? "").trim()) return "A date is required.";
  const input = num(v.inputKg);
  if (input === null) return "Enter the input kg.";
  if (Number.isNaN(input) || input <= 0) return "Input must be a number of kg above 0.";
  for (const [key, label] of SHELLING_KG_FIELDS) {
    const n = num(v[key]);
    if (n !== null && (Number.isNaN(n) || n < 0)) return `${label} must be a number of kg, 0 or more.`;
  }
  const f = shellingFigures(v);
  if (f.finalKg <= 0) return "Enter the kg of at least one output.";
  // Shell is what is left of the input, so it can't be negative: this is a typing mistake, not a real day.
  if (f.shellKg < 0) return `The outputs and shell dust come to ${(f.finalKg + f.shellDustKg).toLocaleString("en-US", { maximumFractionDigits: 2 })} kg, more than the input.`;
  return null;
}

/**
 * Soft notes, never refusals. Shelling more than was cooked is a real case in the client's own file (ANG26F10:
 * 110,708 kg cooked, 132,565 kg shelled over two rows), so it is pointed out rather than stopped.
 */
export function shellingDayNotes(v: ShellingDayValues, leftKg: number): string[] {
  const notes: string[] = [];
  if (n0(v.inputKg) > leftKg + 0.0001) notes.push(`Only ${leftKg.toLocaleString("en-US", { maximumFractionDigits: 2 })} kg of this Lot is left to shell.`);
  if (n0(v.finalUncutKg) > n0(v.firstPassUncutKg)) notes.push("Final uncut is more than the first-pass uncut.");
  return notes;
}

export type ShellingStep = "day" | "line_run" | "qc5" | "qty1" | "qc6" | "none";

/** The one job to point this person at, for a Lot past QC-4; `done` says what this Lot already has. */
export function nextShellingStep(v: { canFloor: boolean; canCheck: boolean; days: number; lineRuns: number; qc5: number; qty1: number; qc6: number }): ShellingStep {
  if (v.canFloor && v.days === 0) return "day";
  if (v.canFloor && v.lineRuns === 0) return "line_run";
  if (v.canCheck && v.qc5 === 0) return "qc5";
  if (v.canCheck && v.qty1 === 0) return "qty1";
  if (v.canCheck && v.qc6 === 0) return "qc6";
  return "none";
}
