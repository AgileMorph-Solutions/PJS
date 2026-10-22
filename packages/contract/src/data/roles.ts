/**
 * Who may write what. Both the backend (reject the write) and the frontend (hide/disable the
 * field) read this one map — hand-copying it between them is the drift this package exists to stop.
 *
 * Field labels are the exact `n` strings from stages.ts, keyed by stage id. contract's roles test
 * asserts every label here still exists in STAGE_FIELD_MAP, so a stages.ts rename can't silently
 * orphan a form.
 */
export type Role = "admin" | "warehouse_incharge" | "branch_manager" | "qfs_officer";

export const ROLES: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "warehouse_incharge", label: "Warehouse Incharge" },
  { value: "branch_manager", label: "Branch Manager" },
  { value: "qfs_officer", label: "QFS Officer" },
];

export const ROLE_LABEL: Record<Role, string> = Object.fromEntries(
  ROLES.map((r) => [r.value, r.label])
) as Record<Role, string>;

export function isRole(value: unknown): value is Role {
  return ROLES.some((r) => r.value === value);
}

export interface FormStageFields {
  stageId: string;
  labels: string[];
}

export interface RoleForm {
  id: string;
  title: string;
  role: Role;
  stages: FormStageFields[];
}

/**
 * Forms that need Warehouse Incharge approval before their values touch the stage tables.
 *
 * bm-reception: Sept-30 clarification — the Branch Manager enters these after unloading. Lot
 * Number, GROSS WT KGS and NET WT KGS used to be here too; the Oct 2026 team feedback made them
 * system-produced (Lot issued on quality pass; weights calculated from the weighbridge readings —
 * see stages.ts n-lot and domain/receiptMath.ts), so nobody types them.
 * "FICHE" is the fiche number; "FICHE CODE" is a separate column and not part of this form.
 */
export const ROLE_FORMS: RoleForm[] = [
  {
    id: "bm-reception",
    title: "Branch Manager — reception details",
    role: "branch_manager",
    stages: [
      { stageId: "n-gate", labels: ["VEHICLE NO."] },
      { stageId: "n-verify", labels: ["SUPPLIERS NAME", "LBA CODE", "FICHE"] },
      // PRICE left this form (Oct 2026): the Branch Manager sets it directly (canSetPrice below), because the Warehouse
      // Incharge who approves this form may no longer see prices.
    ],
  },
  {
    // id keeps its original name: it's stored on every FormSubmission, so renaming it would orphan
    // existing submissions. The form grew from the jute check alone to include quality analysis.
    id: "qfs-jute-check",
    title: "QFS Officer — quality analysis & jute bag check",
    role: "qfs_officer",
    stages: [
      // The measurements only. The Pass/Fail decision (n-qfs's branch) is NOT part of this form — the
      // Warehouse Incharge still records it, since a Fail rejects the truck. The cut-test grams come
      // first in each panel because KOR / FINAL KOR follow from them (domain/receiptMath.ts): record the
      // grams and KOR is calculated; leave them out and KOR is typed, as every 2026 truck was.
      {
        stageId: "n-qfs",
        labels: [
          "MOIS. (moisture)",
          "NUT COUNT",
          "Sample – Good Kernel (g)",
          "Sample – Immature (g)",
          "Sample – Spotted (g)",
          "Sample – Rejection (g)",
          "Sample – Void (g)",
          "Sample – Oil (g)",
          "Sample – Shell (g)",
          "KOR",
          "Final – Good Kernel (g)",
          "Final – Immature (g)",
          "Final – Spotted (g)",
          "Final – Rejection (g)",
          "Final – Void (g)",
          "Final – Oil (g)",
          "Final – Shell (g)",
          "FINAL KOR",
        ],
      },
      // SACS (total) is not here: it is calculated as good + damp + torn (domain/receiptMath.ts).
      {
        stageId: "n-unload",
        labels: ["BON SACS (good bags)", "HUMID SACS (damp bags)", "Sacs déchirés (torn bags)"],
      },
    ],
  },
];

type FieldRef = readonly [stageId: string, label: string];

/** The money on a truck: the negotiated price per kg and the amount it comes to (price × paid weight). */
export const PRICE_FIELDS: readonly FieldRef[] = [["n-grn", "PRICE"], ["n-grn", "AMOUNT"]];

/**
 * Fields a role may neither see nor write (Oct 2026 client change: "hide price/amount from the Warehouse In-Charge and show them
 * to the Branch Manager"). The server strips them from every response to that role and refuses its writes to them; the screens
 * leave them out. Admin, Branch Manager and QFS Officer are not limited here (QFS Officers never see the GRN step's form anyway).
 */
export const HIDDEN_FIELDS: Partial<Record<Role, readonly FieldRef[]>> = { warehouse_incharge: PRICE_FIELDS };

export function canSeeField(role: Role, stageId: string, label: string): boolean {
  return !(HIDDEN_FIELDS[role] ?? []).some(([s, l]) => s === stageId && l === label);
}

/** stageData without the fields this role may not see; the same object when nothing is hidden from it. */
export function redactStageData<T extends Record<string, Record<string, string>>>(stageData: T, role: Role): T {
  const hidden = HIDDEN_FIELDS[role];
  if (!hidden?.length || !stageData) return stageData;
  const out: Record<string, Record<string, string>> = { ...stageData };
  for (const [stageId, label] of hidden) {
    if (out[stageId] && label in out[stageId]!) {
      const { [label]: _gone, ...rest } = out[stageId]!;
      out[stageId] = rest;
    }
  }
  return out as T;
}

/** Who sets the price, directly and with no approval step: the Branch Manager who negotiated it, and Admin. */
export function canSetPrice(role: Role): boolean {
  return role === "branch_manager" || role === "admin";
}

/** Admin and Warehouse Incharge are top of the hierarchy: their stage edits apply immediately (except fields hidden from them). */
export function canWriteStageDirectly(role: Role): boolean {
  return role === "admin" || role === "warehouse_incharge";
}

export function formForRole(role: Role): RoleForm | undefined {
  return ROLE_FORMS.find((f) => f.role === role);
}

export function formById(id: string): RoleForm | undefined {
  return ROLE_FORMS.find((f) => f.id === id);
}
