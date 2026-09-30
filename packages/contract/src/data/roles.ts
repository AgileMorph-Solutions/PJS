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
 * bm-reception: Sept-30 clarification — the Branch Manager enters these after unloading. NET WT
 * is `kind: "system"` in stages.ts ("never typed"), but the client wants the BM's figure as the
 * workbook records it today, so it is submitted here and the conflict is noted on n-netwt.
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
      { stageId: "n-gross", labels: ["GROSS WT KGS"] },
      { stageId: "n-netwt", labels: ["NET WT KGS"] },
      { stageId: "n-lot", labels: ["Lot Number"] },
      { stageId: "n-grn", labels: ["PRICE"] },
    ],
  },
  {
    // id keeps its original name: it's stored on every FormSubmission, so renaming it would orphan
    // existing submissions. The form grew from the jute check alone to include quality analysis.
    id: "qfs-jute-check",
    title: "QFS Officer — quality analysis & jute bag check",
    role: "qfs_officer",
    stages: [
      // The four measurements only. The Pass/Fail decision (n-qfs's branch) is NOT part of this
      // form — the Warehouse Incharge still records it, since a Fail rejects the truck.
      { stageId: "n-qfs", labels: ["MOIS. (moisture)", "NUT COUNT", "KOR", "FINAL KOR"] },
      {
        stageId: "n-unload",
        labels: ["SACS (bags)", "BON SACS (good bags)", "HUMID SACS (damp bags)", "Sacs déchirés (torn bags)"],
      },
    ],
  },
];

/** Admin and Warehouse Incharge are top of the hierarchy: their stage edits apply immediately. */
export function canWriteStageDirectly(role: Role): boolean {
  return role === "admin" || role === "warehouse_incharge";
}

export function formForRole(role: Role): RoleForm | undefined {
  return ROLE_FORMS.find((f) => f.role === role);
}

export function formById(id: string): RoleForm | undefined {
  return ROLE_FORMS.find((f) => f.id === id);
}
