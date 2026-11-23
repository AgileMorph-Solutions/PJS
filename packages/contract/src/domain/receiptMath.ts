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
  /**
   * The field is the system's ONLY while every input is recorded; until then a person may type it.
   * For values the real 2026 sheets held as typed numbers with nothing behind them — KOR is the
   * case: Truck Reception has the final KOR but never the cut-test grams it comes from, so locking
   * it would make every truck without grams impossible to record.
   */
  fallbackToTyped?: boolean;
  /**
   * Never typed in the app, even before its inputs exist (team decision, Nov 2026: KOR is only ever the cut test's
   * result). The typed fallback is then for uploads alone, whose sheet may hold the result without its inputs.
   */
  calculatedOnlyInApp?: boolean;
  /**
   * Calculated only once its target's step has been started. Writing a value into a step creates it, and a step's mere
   * presence moves the truck's status (deriveStatus: n-stock → "in_stock") — so Net and bags alone must not open the stock step.
   */
  onlyInStartedStage?: boolean;
}

/** 80 lb of kernels per 1000 g sample, as a factor — the client's own constant in their Warehouse Receiving sheet. */
export const KOR_FACTOR = 0.17637;

const LOADED: FieldRef = ["n-gross", "Loaded truck weight (kg)"];
const TARE: FieldRef = ["n-gross", "Tare / empty truck weight (kg)"];
const GROSS: FieldRef = ["n-gross", "GROSS WT KGS"];
const GOOD: FieldRef = ["n-unload", "BON SACS (good bags)"];
const DAMP: FieldRef = ["n-unload", "HUMID SACS (damp bags)"];
const TORN: FieldRef = ["n-unload", "Sacs déchirés (torn bags)"];
const SACS: FieldRef = ["n-unload", "SACS (bags)"];
const REFRACTION: FieldRef = ["n-unload", "Refraction"];
const TALLY_CLERK_BAGS: FieldRef = ["n-unload", "Tally Clerk bag count"];
const RECONDITIONED: FieldRef = ["n-unload", "Reconditioning of torn bags"];
const PALLETS: FieldRef = ["n-unload", "Pallets used (30 bags/pallet)"];
const NET: FieldRef = ["n-netwt", "NET WT KGS"];
const PAID: FieldRef = ["n-netwt", "PAID WT"];
const GRN_WEIGHT: FieldRef = ["n-grn", "GRN Weight (kept separate from Gross/Net/Paid)"];
const PRICE: FieldRef = ["n-grn", "PRICE"];
const AMOUNT: FieldRef = ["n-grn", "AMOUNT"];
const KOR: FieldRef = ["n-qfs", "KOR"];
const ADDED_TO_STOCK: FieldRef = ["n-stock", "Added to stock from this truck (kg)"];
const CLOSING_STOCK: FieldRef = ["n-stock", "Closing stock (kg)"];
const STOCK_AFTER: FieldRef = ["n-stock", "Total warehouse stock after this truck (kg)"];
const FINAL_KOR: FieldRef = ["n-qfs", "FINAL KOR"];
const panel = (name: "Sample" | "Final"): FieldRef[] =>
  (["Good Kernel", "Immature", "Spotted"] as const).map((g) => ["n-qfs", `${name} – ${g} (g)`] as const);
/** KOR from a cut test's grams: (good kernel + ½ × (immature + spotted)) × KOR_FACTOR. Used at QFS and at every drying check. */
export const korFromGrams = (good: number, immature: number, spotted: number): number => (good + 0.5 * (immature + spotted)) * KOR_FACTOR;
const korRule = (target: FieldRef, name: "Sample" | "Final"): DerivedRule => ({
  target,
  inputs: panel(name),
  compute: ([good, immature, spotted]) => korFromGrams(good!, immature!, spotted!),
  formula: `(Good kernel + ½ × (immature + spotted)) × ${KOR_FACTOR} — ${name.toLowerCase()} cut test`,
  fallbackToTyped: true,
  calculatedOnlyInApp: true,
});

/** In dependency order: each rule may read the targets of the rules above it. */
export const DERIVED_RULES: readonly DerivedRule[] = [
  // 20 Nov 2026 team decision (reverting the 19 Nov one): good, damp and torn bags are counted and typed; SACS is their total.
  { target: SACS, inputs: [GOOD, DAMP, TORN], compute: ([g, d, t]) => g! + d! + t!, formula: "Good + damp + torn bags" },
  { target: TALLY_CLERK_BAGS, inputs: [GOOD, RECONDITIONED], compute: ([g, r]) => g! + r!, formula: "Good bags + reconditioned torn bags" },
  { target: GROSS, inputs: [LOADED, TARE], compute: ([l, t]) => l! - t!, formula: "Loaded truck − empty truck" },
  { target: NET, inputs: [GROSS, SACS], compute: ([g, b]) => g! - b! * BAG_WEIGHT_KG, formula: "Gross − 1 kg per bag" },
  { target: PAID, inputs: [NET, REFRACTION], compute: ([n, r]) => n! - r!, formula: "Net − refraction" },
  { target: AMOUNT, inputs: [PRICE, PAID], compute: ([p, w]) => p! * w!, formula: "Price × paid weight" },
  korRule(KOR, "Sample"),
  korRule(FINAL_KOR, "Final"),
  // Closing stock is typed for now (the team will decide later how it is worked out); the total follows from it.
  {
    target: STOCK_AFTER, inputs: [CLOSING_STOCK, ADDED_TO_STOCK], compute: ([c, a]) => c! + a!,
    formula: "Closing stock + added to stock from this truck", onlyInStartedStage: true,
  },
];

/**
 * A suggestion for an empty field, offered next to it and never written on its own. GRN Quantity is
 * the quantity officially recognised into stock — usually the net weight, but a different VALUE the
 * warehouse confirms (the client: "Net Weight, GRN Quantity and Paid Weight are different values"),
 * so it is proposed from Net rather than locked to it.
 */
export interface PrefillRule {
  target: FieldRef;
  /** Every one must be recorded: a suggestion missing a part would be offered as if it were the whole. */
  sources: readonly FieldRef[];
  /** Shown beside the suggestion so the person knows where it came from. */
  from: string;
  /** Turns the sources' values, in order, into the suggestion; their sum when absent. */
  compute?: (values: number[]) => number;
}
export const PREFILL_RULES: readonly PrefillRule[] = [
  { target: GRN_WEIGHT, sources: [NET], from: "net weight" },
  // 30 bags to a pallet (the label's own rule), so the pallets needed for the bags unloaded, rounded up.
  { target: PALLETS, sources: [SACS], from: "bags ÷ 30", compute: ([bags]) => Math.ceil(bags! / 30) },
  // Nov 2026 team decision: what goes into stock is the net weight less the jute bags, at the same 1 kg a bag. Not locked
  // (20 Nov 2026: the warehouse may need to put in a different figure); filled in by itself when the GRN completes
  // (23 Nov 2026, stockFillOnGrn), rather than only offered.
  { target: ADDED_TO_STOCK, sources: [NET, SACS], from: "net weight − 1 kg per bag", compute: ([net, bags]) => net! - bags! * BAG_WEIGHT_KG },
];

/** Suggestions for the empty fields of one stage, as {label: {value, from}}. A field that already has a value gets none. */
export function prefillSuggestions(stageData: StageData, stageId: string): Record<string, { value: string; from: string }> {
  const out: Record<string, { value: string; from: string }> = {};
  for (const r of PREFILL_RULES) {
    if (r.target[0] !== stageId) continue;
    if ((stageData[stageId]?.[r.target[1]] ?? "").trim() !== "") continue; // already has a value, typed or imported
    const parts = r.sources.map(([s, l]) => parseQty(stageData[s]?.[l]));
    if (!parts.every((p) => p !== undefined)) continue;
    const values = parts as number[];
    out[r.target[1]] = { value: formatQty(r.compute ? r.compute(values) : values.reduce((a, b) => a + b, 0)), from: r.from };
  }
  return out;
}

const key = ([stageId, label]: FieldRef) => `${stageId}\u0000${label}`;
const RULE_BY_TARGET = new Map(DERIVED_RULES.map((r) => [key(r.target), r]));

export function derivedRuleFor(stageId: string, label: string): DerivedRule | undefined {
  return RULE_BY_TARGET.get(key([stageId, label]));
}

export function isDerivedField(stageId: string, label: string): boolean {
  return RULE_BY_TARGET.has(key([stageId, label]));
}

/**
 * The rule that is locking this field RIGHT NOW: any rule without a typed fallback, and a
 * fallback rule only once every one of its inputs is recorded in `stageData` — except in the app
 * for a rule calculated only there (KOR), which is locked from the start. This — not
 * derivedRuleFor — is what decides whether a person may type the field.
 */
/** `from`: "app" for a person typing in the app; "upload" for a sheet or script writing what its source recorded. */
export function derivedRuleInForce(stageData: StageData, stageId: string, label: string, from: "app" | "upload" = "app"): DerivedRule | undefined {
  const rule = derivedRuleFor(stageId, label);
  if (!rule || !rule.fallbackToTyped) return rule;
  if (rule.calculatedOnlyInApp && from === "app") return rule;
  return rule.inputs.every(([s, l]) => parseQty(stageData[s]?.[l]) !== undefined) ? rule : undefined;
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
    const [stageId, label] = rule.target;
    if (rule.onlyInStartedStage && !stageData[stageId]) continue;
    const values = rule.inputs.map(([s, l]) => parseQty(working[s]?.[l]));
    if (values.some((v) => v === undefined)) continue;
    const value = formatQty(rule.compute(values as number[]));
    (working[stageId] ??= {})[label] = value;
    (out[stageId] ??= {})[label] = value;
  }
  return out;
}

/**
 * Calculated values that no longer have their inputs, to be blanked: a calculation runs only when every input is
 * recorded, so clearing one (Spotted grams) used to leave the old result behind (KOR 18.61 next to grams that can't give
 * it — found 20 Nov 2026). A value is blanked only if `before` shows the app worked it out (it equals the formula of the
 * inputs as they were): a value an upload brought in with no inputs behind it (a sheet's KOR without grams) stays.
 * In rule order, so a cleared Gross also clears the Net and Paid worked out from it.
 */
export function staleDerivedFields(stageData: StageData, before: StageData): Record<string, Record<string, string>> {
  const now: Record<string, Record<string, string>> = {};
  for (const [stageId, fields] of Object.entries(stageData)) now[stageId] = { ...fields };
  const then: Record<string, Record<string, string>> = {};
  for (const [stageId, fields] of Object.entries(before)) then[stageId] = { ...fields };
  const out: Record<string, Record<string, string>> = {};
  for (const rule of DERIVED_RULES) {
    const [stageId, label] = rule.target;
    const stored = (now[stageId]?.[label] ?? "").trim();
    if (!stored || rule.inputs.every(([s, l]) => parseQty(now[s]?.[l]) !== undefined)) continue;
    const inputsThen = rule.inputs.map(([s, l]) => parseQty(then[s]?.[l]));
    if (inputsThen.some((v) => v === undefined)) continue;
    if (formatQty(rule.compute(inputsThen as number[])) !== (then[stageId]?.[label] ?? "").trim()) continue;
    (now[stageId] ??= {})[label] = "";
    (out[stageId] ??= {})[label] = "";
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

/**
 * What the stock step gets by itself the moment the truck's GRN is complete (team, 23 Nov 2026: "this should be autofilled,
 * not just suggested"): Added to stock = net weight − 1 kg per bag, when it is still blank and both are recorded. The stage's
 * own note says stock increments from the completed GRN, so the truck reads "In stock" from then on. The person may still
 * change the figure; a value already there (typed, or an upload's) is never replaced. Empty when there is nothing to fill.
 */
export function stockFillOnGrn(stageData: StageData, grnComplete: boolean): Record<string, string> {
  if (!grnComplete) return {};
  const offered = prefillSuggestions(stageData, ADDED_TO_STOCK[0])[ADDED_TO_STOCK[1]];
  return offered ? { [ADDED_TO_STOCK[1]]: offered.value } : {};
}
