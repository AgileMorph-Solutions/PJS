/** The drying form's quality keys and checks, shared by the Incharge's drying panel and the QFS Officer's form (DryingQualityInputs). */
import { dryingFieldProblem, dryingGramsTotalProblem } from "@anagroci/contract/domain/sunDrying";

export const num = (s: string | undefined) => (s === undefined || s.trim() === "" || Number.isNaN(Number(s.replace(",", "."))) ? null : Number(s.replace(",", ".")));

export const GRAM_FIELDS: [key: string, label: string][] = [
  ["GoodKernelG", "Good kernel"], ["ImmatureG", "Immature"], ["SpottedG", "Spotted"], ["RejectionG", "Rejection"],
  ["VoidG", "Void"], ["OilG", "Oil"], ["ShellG", "Shell"],
];

const QUALITY_KEYS = ["Moisture", "NutCount", "Kor", ...GRAM_FIELDS.map(([key]) => key)];

/** Whether a calculated KOR replaces the typed one: good kernel, immature and spotted are all there. */
export const korCalculated = (values: Record<string, string>, prefix: string) =>
  ["GoodKernelG", "ImmatureG", "SpottedG"].every((g) => num(values[`${prefix}${g}`]) !== null);

/**
 * Whether these fields hold a value that can't be right (contract dryingFieldProblem, the same rules a truck's fields use): the
 * save waits, as the server would refuse it. A warning (still too wet) doesn't hold it. A typed KOR the cut test replaces is
 * neither shown nor sent, so it isn't checked.
 */
export function hasHardProblem(values: Record<string, string>, keys: string[], prefix?: "input" | "output") {
  return keys.some((k) => !(prefix && k === `${prefix}Kor` && korCalculated(values, prefix)) && dryingFieldProblem(k, values[k]) && !dryingFieldProblem(k, values[k])!.soft)
    || (prefix !== undefined && dryingGramsTotalProblem(values, prefix) !== undefined);
}
export const qualityKeys = (prefix: "input" | "output") => QUALITY_KEYS.map((k) => `${prefix}${k}`);

