/**
 * The values the system calculates instead of asking anyone to type (Oct 2026 team feedback:
 * "automatically calculating Net Weight, Total Bags, Drying Loss, Amount").
 *
 * Every formula was checked against the real 2026 workbook before being adopted, not assumed:
 *   Total bags = good + damp + torn         645 Truck Reception rows match, 44 don't (kept, reported)
 *   Net        = Gross − bags × 1 kg        728/728 rows
 *   Paid       = Net − Refraction           716/716 rows
 *   Amount     = Price × Paid               715/715 rows
 *   Drying loss= Issued net − Received net  138/138 Drying Batch rows (and ÷ issued for the %)
 * Gross = Loaded truck − Empty truck is the Bordereau de Livraison's own column order ("Poids
 * Entrés camion", "Poids vide (Tare)", "Poids brute"); the sheet's GROSS WT KGS is already net of
 * the truck (41,300 kg for 478 bags ≈ 86 kg/bag).
 *
 * A rule only fires when ALL its inputs are present. Imported receipts have a GROSS WT KGS but no
 * loaded/empty truck readings — recomputing on missing inputs would blank a real value.
 */
import type { ReceiptRecord } from "../types/receipt.js";

type StageData = ReceiptRecord["stageData"];

/** Each jute bag is deducted at 1 kg — what every one of the 728 real rows does. */
export const BAG_WEIGHT_KG = 1;

/**
 * Parse a workbook-style quantity: tolerates surrounding spaces, thousands spaces ("41 300") and
 * the French decimal comma the real sheets contain ("44,94"). Blank or non-numeric → undefined,
 * never 0, so "not entered" stays distinguishable from zero.
 */
export function parseQty(v: string | number | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim().replace(/\s+/g, "");
  if (s === "") return undefined;
  const n = Number(s.includes(".") ? s.replace(/,/g, "") : s.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/** Two decimals at most, no float noise ("40762", "48.4", not "40762.00000001"). */
export function formatQty(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

type FieldRef = readonly [stageId: string, label: string];

export interface DerivedRule {
  target: FieldRef;
  inputs: readonly FieldRef[];
  compute: (values: number[]) => number;
  /** Shown beside the read-only field so nobody wonders where the number came from. */
  formula: string;
}

const LOADED: FieldRef = ["n-gross", "Loaded truck weight (kg)"];
const TARE: FieldRef = ["n-tare", "Tare / empty truck weight (kg)"];
const GROSS: FieldRef = ["n-gross", "GROSS WT KGS"];
const GOOD: FieldRef = ["n-unload", "BON SACS (good bags)"];
const DAMP: FieldRef = ["n-unload", "HUMID SACS (damp bags)"];
const TORN: FieldRef = ["n-unload", "Sacs déchirés (torn bags)"];
const SACS: FieldRef = ["n-unload", "SACS (bags)"];
const REFRACTION: FieldRef = ["n-unload", "Refraction"];
const NET: FieldRef = ["n-netwt", "NET WT KGS"];
const PAID: FieldRef = ["n-netwt", "PAID WT"];
const PRICE: FieldRef = ["n-grn", "PRICE"];
const AMOUNT: FieldRef = ["n-grn", "AMOUNT"];

/** In dependency order: each rule may read the targets of the rules above it. */
export const DERIVED_RULES: readonly DerivedRule[] = [
  { target: SACS, inputs: [GOOD, DAMP, TORN], compute: ([g, d, t]) => g! + d! + t!, formula: "Good + damp + torn bags" },
  { target: GROSS, inputs: [LOADED, TARE], compute: ([l, t]) => l! - t!, formula: "Loaded truck − empty truck" },
  { target: NET, inputs: [GROSS, SACS], compute: ([g, b]) => g! - b! * BAG_WEIGHT_KG, formula: "Gross − 1 kg per bag" },
  { target: PAID, inputs: [NET, REFRACTION], compute: ([n, r]) => n! - r!, formula: "Net − refraction" },
  { target: AMOUNT, inputs: [PRICE, PAID], compute: ([p, w]) => p! * w!, formula: "Price × paid weight" },
];

const key = ([stageId, label]: FieldRef) => `${stageId}\u0000${label}`;
const RULE_BY_TARGET = new Map(DERIVED_RULES.map((r) => [key(r.target), r]));

export function derivedRuleFor(stageId: string, label: string): DerivedRule | undefined {
  return RULE_BY_TARGET.get(key([stageId, label]));
}

export function isDerivedField(stageId: string, label: string): boolean {
  return RULE_BY_TARGET.has(key([stageId, label]));
}

/**
 * Every derived value computable from `stageData`, as {stageId: {label: value}}. Rules see the
 * results of earlier rules, so a new loaded/tare reading flows through Gross → Net → Paid → Amount
 * in one call. Rules whose inputs are incomplete are simply absent from the result.
 */
export function computeDerivedFields(stageData: StageData): Record<string, Record<string, string>> {
  const working: Record<string, Record<string, string>> = {};
  for (const [stageId, fields] of Object.entries(stageData)) working[stageId] = { ...fields };
  const out: Record<string, Record<string, string>> = {};

  for (const rule of DERIVED_RULES) {
    const values = rule.inputs.map(([s, l]) => parseQty(working[s]?.[l]));
    if (values.some((v) => v === undefined)) continue;
    const [stageId, label] = rule.target;
    const value = formatQty(rule.compute(values as number[]));
    (working[stageId] ??= {})[label] = value;
    (out[stageId] ??= {})[label] = value;
  }
  return out;
}

export interface FormulaMismatch {
  stageId: string;
  label: string;
  stored: string;
  expected: string;
}

/**
 * Stored values that disagree with their own formula, each judged ONLY against the inputs as
 * stored — unlike computeDerivedFields, nothing cascades. One wrong bag total is one mismatch, not
 * also a "wrong" net, paid and amount that were in fact computed correctly from the recorded total.
 */
export function storedFormulaMismatches(stageData: StageData): FormulaMismatch[] {
  const out: FormulaMismatch[] = [];
  for (const rule of DERIVED_RULES) {
    const values = rule.inputs.map(([s, l]) => parseQty(stageData[s]?.[l]));
    const [stageId, label] = rule.target;
    const stored = parseQty(stageData[stageId]?.[label]);
    if (stored === undefined || values.some((v) => v === undefined)) continue;
    const expected = formatQty(rule.compute(values as number[]));
    if (Math.abs(stored - Number(expected)) >= 0.005) out.push({ stageId, label, stored: stageData[stageId]![label]!, expected });
  }
  return out;
}

/** Drying loss for a Lot/quantity issued to drying. Undefined when either weight is missing or nothing was issued. */
export function dryingLoss(issuedNetKg: number | undefined, receivedNetKg: number | undefined): { kg: number; pct: number } | undefined {
  if (issuedNetKg === undefined || receivedNetKg === undefined || issuedNetKg === 0) return undefined;
  const kg = issuedNetKg - receivedNetKg;
  return { kg, pct: kg / issuedNetKg };
}
