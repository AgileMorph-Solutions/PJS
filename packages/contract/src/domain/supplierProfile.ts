/**
 * The LBA register: what the client asked to keep for every supplier (their Oct 2026 table: Identification,
 * Location, Contact, Administrative Identification, Payment, Control), and how strictly. One list, read by the
 * supplier page (form and "what is missing"), the backend (what a new supplier must have) and the Excel sheet.
 */
export type Requirement = "required" | "recommended" | "optional";
export type SupplierStatus = "active" | "inactive" | "suspended";

export const SUPPLIER_STATUS_LABELS: Record<SupplierStatus, string> = { active: "Active", inactive: "Inactive", suspended: "Suspended" };

/** The editable profile fields, by the Supplier column that holds each. */
export type ProfileKey =
  | "name" | "tradeName" | "zone" | "region" | "managerName" | "managerPosition" | "phonePrimary" | "phoneSecondary"
  | "email" | "address" | "registrationRef" | "bankAccountHolder" | "bankName" | "bankAccountRef";

export interface ProfileField { key: ProfileKey; label: string; section: ProfileSection; requirement: Requirement; type?: "email" | "tel" }

export type ProfileSection = "Identification" | "Location" | "Contact" | "Administrative identification" | "Payment";

export const PROFILE_FIELDS: readonly ProfileField[] = [
  { key: "name", label: "Legal / official name", section: "Identification", requirement: "required" },
  { key: "tradeName", label: "Trade name, if different", section: "Identification", requirement: "optional" },
  { key: "zone", label: "Zone", section: "Location", requirement: "required" },
  { key: "region", label: "Region", section: "Location", requirement: "recommended" },
  { key: "managerName", label: "Manager / representative name", section: "Contact", requirement: "required" },
  { key: "managerPosition", label: "Position", section: "Contact", requirement: "recommended" },
  { key: "phonePrimary", label: "Primary phone number", section: "Contact", requirement: "required", type: "tel" },
  { key: "phoneSecondary", label: "Secondary phone number", section: "Contact", requirement: "optional", type: "tel" },
  { key: "email", label: "Email", section: "Contact", requirement: "recommended", type: "email" },
  { key: "address", label: "Address", section: "Contact", requirement: "recommended" },
  { key: "registrationRef", label: "RCCM or registration reference", section: "Administrative identification", requirement: "required" },
  { key: "bankAccountHolder", label: "Account holder name", section: "Payment", requirement: "required" },
  { key: "bankName", label: "Bank", section: "Payment", requirement: "required" },
  { key: "bankAccountRef", label: "Account reference", section: "Payment", requirement: "required" },
];

export const PROFILE_SECTIONS: readonly ProfileSection[] = ["Identification", "Location", "Contact", "Administrative identification", "Payment"];

export type SupplierProfileValues = Partial<Record<ProfileKey, string | null>>;

const filled = (v: string | null | undefined) => (v ?? "").trim() !== "";

/** Required fields with no value. The LBA code and status are required too but always present, so they aren't listed. */
export function missingRequired(values: SupplierProfileValues): ProfileField[] {
  return PROFILE_FIELDS.filter((f) => f.requirement === "required" && !filled(values[f.key]));
}

/** "9 of 11 required filled" — the count the supplier page and list show. */
export function requiredCompleteness(values: SupplierProfileValues): { filled: number; total: number } {
  const required = PROFILE_FIELDS.filter((f) => f.requirement === "required");
  return { filled: required.filter((f) => filled(values[f.key])).length, total: required.length };
}

/**
 * What a save must satisfy. A NEW supplier needs every required field. An existing one may stay as incomplete as it
 * already was (the register started empty, so blocking those saves would make the 78 imported suppliers uneditable),
 * but a required field that has a value can't be emptied again.
 */
export function requiredProblems(next: SupplierProfileValues, before: SupplierProfileValues | null): string[] {
  return PROFILE_FIELDS.filter((f) => f.requirement === "required" && !filled(next[f.key]) && (before === null || filled(before[f.key])))
    .map((f) => (before === null ? `${f.label} is required.` : `${f.label} is required and can't be emptied.`));
}

/** A reason is asked for whenever a supplier is not active. */
export function statusProblem(status: SupplierStatus, reason: string | null | undefined): string | null {
  return status !== "active" && !filled(reason) ? `Say why the supplier is ${SUPPLIER_STATUS_LABELS[status].toLowerCase()}.` : null;
}
