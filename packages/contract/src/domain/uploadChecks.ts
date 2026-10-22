/**
 * Soft checks on one uploaded truck row: things that are probably wrong but must never stop the
 * upload (the repo's rule: a real data problem is reported, not refused and not cleaned). They are
 * saved against the truck so whoever opens it sees them.
 *
 * Deliberately only two kinds of check: a value that cannot be true (a negative weight, an empty
 * truck heavier than the loaded one, moisture over 100%) and a value that disagrees with something
 * the system already holds (a supplier code not in the master, a fiche already used by another
 * truck). No "looks unusual" tolerances: a number we invented would flag good data and teach people
 * to ignore the list. Net, GRN and Paid are NOT compared — the client says they legitimately differ.
 *
 * One shape, many instances (like backend/src/domain/dataQuality/checks.ts): a check returns the
 * warnings it found, and the list at the bottom is the registry.
 */
import { supplierNameKey } from "./supplierCode.js";

export type UploadSeverity = "warning" | "info";

export interface UploadWarning {
  /** The plain column label the person sees in the sheet; absent when the warning is about the row as a whole. */
  column?: string;
  message: string;
  severity: UploadSeverity;
}

/** What a check may look at: the row as it will stand once applied, plus what the system already knows. */
export interface UploadCheckInput {
  arrivalDate: string;
  supplierName: string;
  lbaCode: string;
  stageData: Record<string, Record<string, string>>;
  today: string;
  /** Supplier master: code → name. */
  suppliers: ReadonlyMap<string, string>;
  /** Other trucks already using this fiche (never including the row's own truck). */
  ficheUsedBy: ReadonlyArray<string>;
}

type UploadCheck = (i: UploadCheckInput) => UploadWarning[];

const value = (i: UploadCheckInput, stage: string, label: string) => (i.stageData[stage]?.[label] ?? "").trim();
/** A typed number, French decimal comma included; undefined when blank, NaN when it isn't one. */
const num = (raw: string) => (raw === "" ? undefined : Number(raw.replace(/\s/g, "").replace(",", ".")));
const warn = (column: string | undefined, message: string): UploadWarning => ({ column, message, severity: "warning" });

const NUMERIC: [stage: string, label: string][] = [
  ["n-gross", "Loaded truck weight (kg)"], ["n-gross", "Tare / empty truck weight (kg)"],
  ["n-qfs", "MOIS. (moisture)"], ["n-qfs", "KOR"], ["n-qfs", "FINAL KOR"],
  ["n-unload", "BON SACS (good bags)"], ["n-unload", "HUMID SACS (damp bags)"], ["n-unload", "Sacs déchirés (torn bags)"], ["n-unload", "Refraction"],
  ["n-grn", "GRN Weight (kept separate from Gross/Net/Paid)"], ["n-grn", "PRICE"],
];

const notANumberOrNegative: UploadCheck = (i) =>
  NUMERIC.flatMap(([stage, label]) => {
    const raw = value(i, stage, label);
    const n = num(raw);
    if (n === undefined) return [];
    if (Number.isNaN(n)) return [warn(label, `"${raw}" isn't a number`)];
    return n < 0 ? [warn(label, `is negative (${raw})`)] : [];
  });

const percentOutOfRange: UploadCheck = (i) => {
  const out: UploadWarning[] = [];
  const mois = num(value(i, "n-qfs", "MOIS. (moisture)"));
  if (mois !== undefined && mois > 100) out.push(warn("MOIS. (moisture)", `moisture ${mois}% is over 100%`));
  // KOR is pounds of kernel per 80 lb of nuts, so it cannot exceed 80.
  for (const label of ["KOR", "FINAL KOR"]) {
    const k = num(value(i, "n-qfs", label));
    if (k !== undefined && k > 80) out.push(warn(label, `${label} ${k} is over 80, the most a sample can yield`));
  }
  return out;
};

const emptyTruckHeavier: UploadCheck = (i) => {
  const loaded = num(value(i, "n-gross", "Loaded truck weight (kg)"));
  const tare = num(value(i, "n-gross", "Tare / empty truck weight (kg)"));
  return loaded !== undefined && tare !== undefined && tare > loaded
    ? [warn("Tare / empty truck weight (kg)", `the empty truck (${tare} kg) weighs more than the loaded truck (${loaded} kg)`)]
    : [];
};

const offloadedBeforeArrival: UploadCheck = (i) => {
  const off = value(i, "n-unload", "DATE OF OFFLOADING").slice(0, 10);
  return off && i.arrivalDate && off < i.arrivalDate.slice(0, 10)
    ? [warn("DATE OF OFFLOADING", `offloaded on ${off}, before the truck arrived on ${i.arrivalDate.slice(0, 10)}`)]
    : [];
};

const arrivalInFuture: UploadCheck = (i) =>
  i.arrivalDate && i.arrivalDate.slice(0, 10) > i.today ? [warn("Arrival date", `${i.arrivalDate.slice(0, 10)} is in the future`)] : [];

const supplierNotInMaster: UploadCheck = (i) => {
  const code = i.lbaCode.trim();
  if (!code) return []; // blank is "not recorded yet", not a mismatch
  const known = i.suppliers.get(code);
  if (known === undefined) return [warn("LBA code", `${code} isn't in the supplier master`)];
  const name = i.supplierName.trim();
  // "RCN X" and "X" are the same supplier (the prefix was dropped from stored names), so only a real difference is reported.
  return name && supplierNameKey(name) !== supplierNameKey(known) ? [warn("Supplier name", `"${name}" differs from "${known}", the master's name for ${code}`)] : [];
};

const ficheUsedElsewhere: UploadCheck = (i) =>
  i.ficheUsedBy.length ? [warn("FICHE", `fiche ${value(i, "n-verify", "FICHE")} is already used by ${i.ficheUsedBy.slice(0, 3).join(", ")}${i.ficheUsedBy.length > 3 ? "…" : ""}`)] : [];

export const UPLOAD_CHECKS: readonly UploadCheck[] = [
  notANumberOrNegative, percentOutOfRange, emptyTruckHeavier, offloadedBeforeArrival, arrivalInFuture, supplierNotInMaster, ficheUsedElsewhere,
];

export function checkUploadRow(input: UploadCheckInput): UploadWarning[] {
  return UPLOAD_CHECKS.flatMap((c) => c(input));
}
