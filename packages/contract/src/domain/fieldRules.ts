/**
 * What a typed procurement value should look like (docs/procurement-field-rules.png, agreed with the team Nov 2026). Every
 * value is saved: a rule only warns, it never refuses or holds a value back (Nov 2026, the team: "all values can be
 * saved, just warn the user"). The warehouse decides; the app points out what looks wrong.
 *
 * Where the limits come from, so nobody mistakes them for invented tolerances:
 * - moisture, nut count and KOR: the raw cashew trade's own grades (moisture 10 % max; 230 nuts/kg the acceptability
 *   limit; KOR 43-48 lbs good, 48-55 excellent). The outer bounds are wide physical limits, only there to catch typing slips.
 * - bags and weights: bags are 80 kg and one truck carries about 60 tonnes, so 750 bags is a full truck.
 * - a cut-test sample is 1,000 g (KOR_FACTOR in receiptMath.ts is per 1,000 g).
 * The client is still to confirm the limits; they live here, once, so changing one is a one-line edit.
 *
 * Uploaded workbooks are judged the same way: a real data problem is reported, not refused.
 */
import { computeDerivedFields, parseQty } from "./receiptMath.js";
import { formatDate } from "./dateFormat.js";

export interface FieldIssue {
  stageId: string;
  /** The field the message is shown under. */
  label: string;
  message: string;
  /** Every field the issue is about (both weights of "empty truck heavier than loaded"). */
  involves: readonly (readonly [stageId: string, label: string])[];
}

interface NumberRule {
  /** Whole numbers only (bags, nut count). */
  integer?: boolean;
  /** Warn below this / above this: outside what can physically be true, most likely a typing slip. */
  min?: number;
  max?: number;
  /** Warn at exactly 0 or less (a weight or price of 0 means "not weighed", not a reading). */
  positive?: boolean;
  /** WARN above / below, with the reason the person reads. */
  warnAbove?: [limit: number, why: string];
  warnBelow?: [limit: number, why: string];
  unit?: string;
}

interface FormatRule {
  pattern: RegExp;
  /** What a right value looks like, shown in the message. */
  example: string;
}

type Rule = { number: NumberRule } | { format: FormatRule };

// The team doesn't set a moisture ceiling of its own (Nov 2026): over 100 % is only a typing slip; 10 % is the
// trade standard, so above it is a warning.
const MOISTURE: Rule = { number: { min: 0, max: 100, unit: "%", warnAbove: [10, "too wet, needs drying"] } };
const NUT_COUNT: Rule = { number: { integer: true, min: 100, max: 300, unit: "nuts per kg", warnAbove: [230, "poor quality: 230 nuts per kg is the trade limit"] } };
const KOR: Rule = { number: { min: 30, max: 60, unit: "lbs", warnBelow: [43, "poor quality: 43 - 48 lbs is good, 48 - 55 excellent"] } };
const GRAMS: Rule = { number: { min: 0, max: 1000, unit: "g" } };
const BAGS: Rule = { number: { integer: true, min: 0 } };
const KG: Rule = { number: { min: 0, unit: "kg" } };
const WEIGHT: Rule = { number: { positive: true, unit: "kg" } };

const gramFields = (panel: "Sample" | "Final") =>
  Object.fromEntries(["Good Kernel", "Immature", "Spotted", "Rejection", "Void", "Oil", "Shell"].map((g) => [`${panel} – ${g} (g)`, GRAMS]));

/** By stage, by the field's exact label (stages.ts). A field not listed here is free text. */
export const FIELD_RULES: Record<string, Record<string, Rule>> = {
  "n-gate": {
    // Real plates: 827KT01, 7957-GN-01, and two trailers as "4972KB01/9901KD01". A warning only: plates from abroad vary.
    "VEHICLE NO.": { format: { pattern: /^[A-Z0-9-]+( ?\/ ?[A-Z0-9-]+)*$/i, example: "827KT01, or 4972KB01/9901KD01 for two plates" } },
  },
  "n-verify": {
    // 674 of 674 codes in the 2026 workbook are NNNN-NNNN, but the team also writes a plain number here (77583), the same
    // as the FICHE (Nov 2026: "this type of fiche code is already fine"). Both are right; anything else is a warning.
    "FICHE CODE": { format: { pattern: /^(\d{4}-\d{4}|\d+)$/, example: "0401-0007 or 77583" } },
    FICHE: { format: { pattern: /^\d+$/, example: "72515 (numbers only)" } },
  },
  "n-gross": {
    "Loaded truck weight (kg)": WEIGHT,
    "Tare / empty truck weight (kg)": WEIGHT,
    "GROSS WT KGS": { number: { positive: true, unit: "kg", warnAbove: [60000, "more than one full truck (about 60,000 kg)"] } },
  },
  "n-qfs": {
    "Sample moisture (%)": MOISTURE,
    "Final moisture (%)": MOISTURE,
    "Sample nut count": NUT_COUNT,
    "Final nut count": NUT_COUNT,
    KOR,
    "FINAL KOR": KOR,
    ...gramFields("Sample"),
    ...gramFields("Final"),
  },
  "n-unload": {
    "BON SACS (good bags)": { number: { integer: true, min: 0, warnAbove: [750, "more than a full truck (60,000 kg ÷ 80 kg bags)"] } },
    "HUMID SACS (damp bags)": BAGS,
    "Sacs déchirés (torn bags)": BAGS,
    "SACS (bags)": BAGS,
    Refraction: KG,
    "Tally Clerk bag count": BAGS,
    "Pallets used (30 bags/pallet)": BAGS,
  },
  "n-grn": {
    "GRN Weight (kept separate from Gross/Net/Paid)": WEIGHT,
    PRICE: { number: { positive: true, unit: "CFA per kg" } },
  },
  "n-drying": {
    "Moisture % — before drying": MOISTURE,
    "Moisture % — after drying": MOISTURE,
    "Dried quantity returned to warehouse": KG,
  },
  "n-stock": {
    "Added to stock from this truck (kg)": KG,
  },
  "n-ledger": {
    Quantity: { number: { positive: true } },
  },
};

export function fieldRule(stageId: string, label: string): Rule | undefined {
  return FIELD_RULES[stageId]?.[label];
}

/** Fields the form should offer a number keyboard for. */
export function isNumericField(stageId: string, label: string): boolean {
  const r = fieldRule(stageId, label);
  return Boolean(r && "number" in r);
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const withUnit = (n: number, unit?: string) => (unit ? `${fmt(n)} ${unit}` : fmt(n));

/** The issue with one value on its own, or undefined when it is fine (or blank: blank is "not recorded yet", never wrong). */
export function checkValue(stageId: string, label: string, raw: string | undefined): Omit<FieldIssue, "involves"> | undefined {
  const value = (raw ?? "").trim();
  const rule = fieldRule(stageId, label);
  if (!rule || value === "") return undefined;
  const at = (message: string) => ({ stageId, label, message });

  if ("format" in rule) {
    const f = rule.format;
    if (f.pattern.test(value)) return undefined;
    return at(`"${value}" doesn't look right. It should look like ${f.example}.`);
  }
  const r = rule.number;
  const n = parseQty(value);
  if (n === undefined) return at(`"${value}" isn't a number.`);
  if (r.integer && !Number.isInteger(n)) return at("Not a whole number.");
  if (r.positive && n <= 0) return at("Should be more than 0.");
  if (r.min !== undefined && n < r.min) return at(`Below ${withUnit(r.min, r.unit)}. Please check.`);
  if (r.max !== undefined && n > r.max) return at(`Above ${withUnit(r.max, r.unit)}. Please check.`);
  if (r.warnAbove && n > r.warnAbove[0]) return at(`Above ${withUnit(r.warnAbove[0], r.unit)}: ${r.warnAbove[1]}.`);
  if (r.warnBelow && n < r.warnBelow[0]) return at(`Below ${withUnit(r.warnBelow[0], r.unit)}: ${r.warnBelow[1]}.`);
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Values that must agree with each other. Each check reads the record as it stands (calculated fields included) and
// returns its issue, or nothing. Blank inputs are "not recorded yet": a check needs every value it compares.
// ---------------------------------------------------------------------------------------------------------------------

type StageData = Record<string, Record<string, string>>;

export interface CheckContext {
  /** The receipt's arrival date (ISO). */
  arrivalDate?: string;
  /** Today (ISO date), so "in the future" is decided by the caller's clock, not by this module. */
  today: string;
  /** The day the record was entered (ISO date): an arrival before it was typed in late, which is real but worth a look. */
  enteredOn?: string;
}

type Ref = readonly [string, string];
const LOADED: Ref = ["n-gross", "Loaded truck weight (kg)"];
const TARE: Ref = ["n-gross", "Tare / empty truck weight (kg)"];
const GROSS: Ref = ["n-gross", "GROSS WT KGS"];
const GOOD: Ref = ["n-unload", "BON SACS (good bags)"];
const DAMP: Ref = ["n-unload", "HUMID SACS (damp bags)"];
const TORN: Ref = ["n-unload", "Sacs déchirés (torn bags)"];
const SACS: Ref = ["n-unload", "SACS (bags)"];
const REFRACTION: Ref = ["n-unload", "Refraction"];
const TALLY: Ref = ["n-unload", "Tally Clerk bag count"];
const PALLETS: Ref = ["n-unload", "Pallets used (30 bags/pallet)"];
const OFFLOADED: Ref = ["n-unload", "DATE OF OFFLOADING"];
const ARRIVED: Ref = ["n-gate", "DATE OF ARRIVAL"];
/** Days that can't be in the future (a truck can't arrive or be unloaded tomorrow): their calendar stops at today. */
const NO_FUTURE_DATES: readonly Ref[] = [ARRIVED, OFFLOADED];
export const isNoFutureDate = (stageId: string, label: string) => NO_FUTURE_DATES.some(([s, l]) => s === stageId && l === label);
const NET: Ref = ["n-netwt", "NET WT KGS"];
const GRN: Ref = ["n-grn", "GRN Weight (kept separate from Gross/Net/Paid)"];
const SAMPLE_MOIST: Ref = ["n-qfs", "Sample moisture (%)"];
const FINAL_MOIST: Ref = ["n-qfs", "Final moisture (%)"];
/** Sample (at the gate) and final (at unloading) are minutes apart, so moisture can't really move much between them. */
const MOISTURE_GAP = 3;
const MOIST_BEFORE: Ref = ["n-drying", "Moisture % — before drying"];
const MOIST_AFTER: Ref = ["n-drying", "Moisture % — after drying"];

type Check = (get: (r: Ref) => number | undefined, text: (r: Ref) => string, ctx: CheckContext) => FieldIssue | undefined;

const issue = (at: Ref, message: string, ...also: Ref[]): FieldIssue => ({
  stageId: at[0], label: at[1], message, involves: [at, ...also],
});

/** The cut-test sample is 1,000 g, so its parts can't add up to more. */
const gramsOverSample = (panel: "Sample" | "Final"): Check => (get) => {
  const refs = ["Good Kernel", "Immature", "Spotted", "Rejection", "Void", "Oil", "Shell"].map((g) => ["n-qfs", `${panel} – ${g} (g)`] as const);
  const total = refs.reduce((sum, r) => sum + (get(r) ?? 0), 0);
  return total > 1000 ? issue(refs[0]!, `The ${panel.toLowerCase()} cut-test grams add up to ${fmt(total)} g, more than the 1,000 g sample.`, ...refs.slice(1)) : undefined;
};

export const CROSS_CHECKS: readonly Check[] = [
  (get) => {
    const loaded = get(LOADED), tare = get(TARE);
    return loaded !== undefined && tare !== undefined && tare >= loaded
      ? issue(TARE, `The empty truck (${fmt(tare)} kg) weighs as much as or more than the loaded truck (${fmt(loaded)} kg). Please check.`, LOADED)
      : undefined;
  },
  (_get, text, ctx) => {
    const d = text(ARRIVED).slice(0, 10);
    if (d && d > ctx.today) return issue(ARRIVED, `The arrival date ${formatDate(d)} is in the future.`);
    const entered = ctx.enteredOn?.slice(0, 10);
    return d && entered && d < entered ? issue(ARRIVED, `A past date: this record was entered on ${formatDate(entered)}. Please check it.`) : undefined;
  },
  (_get, text, ctx) => {
    const off = text(OFFLOADED).slice(0, 10);
    const arrived = (text(ARRIVED) || ctx.arrivalDate || "").slice(0, 10);
    if (off && off > ctx.today) return issue(OFFLOADED, `The offloading date ${formatDate(off)} is in the future.`);
    return off && arrived && off < arrived ? issue(OFFLOADED, `Offloaded on ${formatDate(off)}, before the truck arrived on ${formatDate(arrived)}.`, ARRIVED) : undefined;
  },
  (get) => {
    const net = get(NET), refr = get(REFRACTION);
    if (net === undefined || refr === undefined || net <= 0) return undefined;
    if (refr > net) return issue(REFRACTION, `Refraction (${fmt(refr)} kg) is more than the whole net weight (${fmt(net)} kg). Please check the number.`);
    return refr > net * 0.01 ? issue(REFRACTION, `Refraction is high: more than 1 % of the net weight (${fmt(net)} kg). Please check the number.`) : undefined;
  },
  (get) => {
    const gross = get(GROSS), bags = get(SACS);
    if (gross === undefined || !bags || bags <= 0) return undefined;
    const perBag = gross / bags;
    return perBag < 70 || perBag > 90
      ? issue(GROSS, `That makes ${fmt(perBag)} kg in each bag, but a bag holds about 80 kg. Please check the weight and the number of bags.`, SACS, GOOD, DAMP, TORN)
      : undefined;
  },
  (get) => {
    const damp = get(DAMP), torn = get(TORN), total = get(SACS);
    if (damp === undefined || torn === undefined || !total) return undefined;
    return damp + torn > total * 0.1 ? issue(DAMP, `${fmt(damp + torn)} of the ${fmt(total)} bags are damp or torn. That is a lot (more than 1 in 10). Please check.`, TORN) : undefined;
  },
  (get) => {
    const tally = get(TALLY), total = get(SACS);
    return tally !== undefined && total !== undefined && tally !== total
      ? issue(TALLY, `The tally clerk counted ${fmt(tally)} bags, but the bags entered above add up to ${fmt(total)}. The two should match.`, SACS, GOOD, DAMP, TORN)
      : undefined;
  },
  (get) => {
    const pallets = get(PALLETS), total = get(SACS);
    return pallets !== undefined && total !== undefined && pallets * 30 < total
      ? issue(PALLETS, `${fmt(pallets)} pallets carry only ${fmt(pallets * 30)} bags (30 each), but ${fmt(total)} bags were unloaded. Please check.`, SACS)
      : undefined;
  },
  (get) => {
    const grn = get(GRN), net = get(NET);
    return grn !== undefined && net !== undefined && grn > net
      ? issue(GRN, `The GRN quantity (${fmt(grn)} kg) is more than the net weight (${fmt(net)} kg).`)
      : undefined;
  },
  gramsOverSample("Sample"),
  gramsOverSample("Final"),
  (get) => {
    const sample = get(SAMPLE_MOIST), final = get(FINAL_MOIST);
    return sample !== undefined && final !== undefined && Math.abs(final - sample) > MOISTURE_GAP
      ? issue(FINAL_MOIST, `Very different from the sample (${fmt(sample)} %). Please check both readings.`, SAMPLE_MOIST)
      : undefined;
  },
  (get) => {
    const before = get(MOIST_BEFORE), after = get(MOIST_AFTER);
    return before !== undefined && after !== undefined && after >= before
      ? issue(MOIST_AFTER, `Moisture after drying (${fmt(after)} %) is not lower than before (${fmt(before)} %).`, MOIST_BEFORE)
      : undefined;
  },
];

/**
 * Every issue on a record: each value on its own, then the values that must agree. Calculated fields (net, total bags)
 * are taken as the system would calculate them, so a check never judges a stale stored number.
 */
export function recordIssues(stageData: StageData, ctx: CheckContext): FieldIssue[] {
  const derived = computeDerivedFields(stageData);
  const text = ([s, l]: Ref) => (derived[s]?.[l] ?? stageData[s]?.[l] ?? "").trim();
  const get = (r: Ref) => parseQty(text(r));

  const single: FieldIssue[] = [];
  for (const [stageId, fields] of Object.entries(stageData)) {
    for (const [label, value] of Object.entries(fields)) {
      const i = checkValue(stageId, label, value);
      if (i) single.push({ ...i, involves: [[stageId, label]] });
    }
  }
  const cross = CROSS_CHECKS.map((c) => c(get, text, ctx)).filter((i): i is FieldIssue => i !== undefined);
  return [...single, ...cross];
}

/** Issues grouped for one stage's form: {label: issue}, the first when a field has two. */
export function issuesByLabel(issues: FieldIssue[], stageId: string): Record<string, FieldIssue> {
  const out: Record<string, FieldIssue> = {};
  for (const i of issues) {
    if (i.stageId !== stageId) continue;
    out[i.label] ??= i;
  }
  return out;
}
