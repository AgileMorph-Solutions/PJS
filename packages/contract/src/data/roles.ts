/**
 * Who may write what. Both the backend (reject the write) and the frontend (hide/disable the
 * field) read this one map — hand-copying it between them is the drift this package exists to stop.
 *
 * Field labels are the exact `n` strings from stages.ts, keyed by stage id. contract's roles test
 * asserts every label here still exists in STAGE_FIELD_MAP, so a stages.ts rename can't silently
 * orphan a form.
 */
import type { WarehouseType } from "./warehouseTypes.js";

export type Role =
  | "admin" | "warehouse_incharge" | "branch_manager" | "qfs_officer"
  | "production_incharge" | "factory_manager";

export const ROLES: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "warehouse_incharge", label: "Warehouse Incharge" },
  { value: "branch_manager", label: "Branch Manager" },
  { value: "qfs_officer", label: "QFS Officer" },
  { value: "production_incharge", label: "Production Incharge" },
  { value: "factory_manager", label: "Factory Manager" },
];

/**
 * Roles that only exist at the factory, so they may only be assigned to a Central warehouse (Lokesh, 16 Nov 2026: "two user
 * IDs more for Production incharge and Factory Manager" to monitor the factory's area reports).
 */
export const CENTRAL_ONLY_ROLES: readonly Role[] = ["production_incharge", "factory_manager"];

/** Whether a user with this role may be assigned to a warehouse of this category. Admin has no warehouse at all. */
export function roleFitsWarehouseType(role: Role, warehouseType: WarehouseType | string | null | undefined): boolean {
  return !CENTRAL_ONLY_ROLES.includes(role) || warehouseType === "CENTRAL";
}

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
    // existing submissions. The form grew from the jute check alone to include quality analysis; the bag count at unloading
    // (good, damp, torn, reconditioned) left it on 26 Nov 2026 (user): counting bags isn't the QFS Officer's, the Warehouse
    // Incharge records it on the Unloading step.
    id: "qfs-jute-check",
    title: "QFS Officer — quality analysis",
    role: "qfs_officer",
    stages: [
      // The measurements only. The Pass/Fail decision (n-qfs's branch) is NOT part of this form — the
      // Warehouse Incharge still records it, since a Fail rejects the truck. The cut-test grams come
      // first in each panel because KOR / FINAL KOR follow from them (domain/receiptMath.ts): record the
      // grams and KOR is calculated; leave them out and KOR is typed, as every 2026 truck was.
      {
        stageId: "n-qfs",
        labels: [
          "Sample moisture (%)",
          "Sample nut count",
          "Final moisture (%)",
          "Final nut count",
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

/**
 * Who may read the warehouse-wide feeds a receipt page shows beside the truck: delivery plans, drying rounds and the linked
 * records. The Branch Manager and QFS Officer see their receipts only (backend auth/policy.ts, which is the real gate and is
 * tested against this), so their pages don't ask: every such request would come back 403.
 */
export function canReadWarehouseFeeds(role: Role): boolean {
  return role === "admin" || role === "warehouse_incharge";
}

/** Admin and Warehouse Incharge are top of the hierarchy: their stage edits apply immediately (except fields hidden from them). */
export function canWriteStageDirectly(role: Role): boolean {
  return role === "admin" || role === "warehouse_incharge";
}

/**
 * Who may change a value once it is recorded (22 Nov 2026): Admin and the Warehouse Incharge. Everyone else — the Branch
 * Manager, the QFS Officer — fills an empty field only. To correct what is already there they ask the Incharge or an Admin,
 * who changes it in the app, where the change is logged under their name. Letting anyone rewrite a recorded value would let
 * the data be quietly changed after the fact.
 */
export function canChangeRecordedValue(role: Role): boolean {
  return canWriteStageDirectly(role);
}

/**
 * Who corrects a record after it was closed or handed on (25 Nov 2026: an Admin; 26 Nov 2026, user: the Warehouse Incharge too,
 * at their own warehouse): reopen a truck whose GRN is complete, edit a BKT once made, change a transfer lot already on a truck
 * or undo bags put back in a Bin, correct a load production accepted. The Incharge is held to their own warehouse by the
 * routes' warehouse check (auth/scope.ts); an Admin reaches every warehouse.
 */
export function canCorrectRecords(role: Role | null | undefined): boolean {
  return role === "admin" || role === "warehouse_incharge";
}

/**
 * Who sends a check from the Quality checks page (drying, transfer lot) for approval: the QFS Officer, and an Admin. The page
 * is also open to the Warehouse Incharge (26 Nov 2026, user), read-only: they see what is due and approve in Approvals.
 */
export const QUALITY_CHECK_TAKERS: readonly Role[] = ["admin", "qfs_officer"];
/** Who opens the Quality checks page. */
export const QUALITY_CHECK_VIEWERS: readonly Role[] = ["admin", "qfs_officer", "warehouse_incharge"];

/** A value someone tried to change after it was recorded. */
export interface RecordedConflict {
  stageId: string;
  label: string;
  recorded: string;
}

type StageValues = Record<string, Record<string, string> | undefined>;

/**
 * The values in `incoming` that would change one already recorded in `current`. A blank field isn't recorded, and sending
 * the value that is already there changes nothing, so neither is a conflict.
 */
export function changesToRecorded(current: StageValues, incoming: Record<string, Record<string, string>>): RecordedConflict[] {
  const out: RecordedConflict[] = [];
  for (const [stageId, fields] of Object.entries(incoming)) {
    for (const [label, value] of Object.entries(fields)) {
      const recorded = (current[stageId]?.[label] ?? "").trim();
      if (recorded && recorded !== String(value ?? "").trim()) out.push({ stageId, label, recorded });
    }
  }
  return out;
}

/** incoming without the values already recorded exactly as sent: re-sending them is not new information. */
export function withoutUnchanged(current: StageValues, incoming: Record<string, Record<string, string>>): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [stageId, fields] of Object.entries(incoming)) {
    for (const [label, value] of Object.entries(fields)) {
      if ((current[stageId]?.[label] ?? "").trim() !== String(value ?? "").trim()) (out[stageId] ??= {})[label] = value;
    }
  }
  return out;
}

/** Who can change this field once recorded: the Incharge doesn't see prices, so a price is an Admin's to change. */
export function whoChangesRecorded(stageId: string, label: string): string {
  return canSeeField("warehouse_incharge", stageId, label) ? "the Warehouse Incharge or an Admin" : "an Admin";
}

/**
 * Why this person can't submit their form for a truck again, or undefined when they can. A form is sent more than once when
 * it was filled in a part at a time (23 Nov 2026: a QFS Officer sent moisture first, the cut-test grams later): after an
 * approval a new submission may fill what is still empty. One still waiting is decided first; a rejection stays final — the
 * Warehouse Incharge corrects the data after that.
 */
export function submitAgainBlocker(earlier: readonly { status: string }[]): string | undefined {
  if (earlier.some((s) => s.status === "rejected")) return "This form was rejected and can't be resubmitted — ask the Warehouse Incharge to correct it.";
  if (earlier.some((s) => s.status === "submitted")) return "This form is already waiting for approval. Once the Warehouse Incharge approves it, you can send what is still empty.";
  return undefined;
}

/** The plain refusal: which values are already recorded, as what, and whom to ask. */
export function recordedValueMessage(conflicts: readonly RecordedConflict[]): string {
  const what = conflicts.map((c) => `${c.label} (${c.recorded})`).join(", ");
  const who = conflicts.some((c) => whoChangesRecorded(c.stageId, c.label) === "an Admin") ? "an Admin" : "the Warehouse Incharge or an Admin";
  return `Already recorded: ${what}. Once a value is entered it can only be changed by ${who} — ask them to change it.`;
}

/**
 * The roles with work in Production. The warehouse sends a load and the factory accepts it (Lokesh, 16 Nov 2026, "Option
 * 1": "Warehouse page, they will update the details of quantity and quality. Then operations will accept"), so the work
 * splits at that acceptance. The warehouse team — the Warehouse Incharge, with the QFS Officer's moisture check — records,
 * checks and weighs the load (canRecordIntake), and sees only that: its intake. The production team sees the whole of
 * production (canSeeFactory), the warehouse's forms included, read-only: the Production Incharge accepts the load and runs
 * everything after it, its quality checks included (canRunProduction); the Factory Manager watches and changes nothing.
 */
export const PRODUCTION_ROLES: readonly Role[] = ["admin", "warehouse_incharge", "qfs_officer", "production_incharge", "factory_manager"];

/** The warehouse's side of a load: record it, weigh it, and approve its moisture check. */
export function canRecordIntake(role: Role): boolean {
  return role === "admin" || role === "warehouse_incharge";
}

/**
 * The factory's side: accept a weighed load, then every record after it (calibration, cooking, shelling, sorting,
 * by-products) and its quality checks.
 */
export function canRunProduction(role: Role): boolean {
  return role === "admin" || role === "production_incharge";
}

/**
 * Who takes the factory's quality checks (QC-2 silo checks, QC-4 to QC-7, QTY-1): the QFS Officer, whose checks wait for the
 * Production Incharge (26 Nov 2026, user: the QFS Officer does every quality check), and the Production Incharge or Admin,
 * whose own are approved as saved.
 */
export function canTakeFactoryChecks(role: Role): boolean {
  return canRunProduction(role) || role === "qfs_officer";
}

/**
 * Who sees production past the intake (team decision, 18 Nov 2026: "the warehouse guy will not see the entire production
 * process"): the production team and Admin. The warehouse team sees its loads, nothing after them — except the QFS Officer,
 * who reads the stages their checks are taken in (canTakeFactoryChecks), and changes nothing else there.
 */
export function canSeeFactory(role: Role): boolean {
  return canRunProduction(role) || role === "factory_manager";
}

/**
 * Production runs at the factory, which is the Central warehouse. So a role that works in Production
 * still sees none of it from a Unit warehouse (a Bouaké Warehouse Incharge has no batches to run).
 * Admin has no warehouse and may pick any factory. A user with no warehouse yet is refused, not guessed.
 * The API enforces this (backend auth/plugin.ts); the sidebar and routes read the same function.
 */
export function canAccessProduction(role: Role, warehouseType: WarehouseType | null | undefined): boolean {
  if (role === "admin") return true;
  return PRODUCTION_ROLES.includes(role) && warehouseType === "CENTRAL";
}

export function formForRole(role: Role): RoleForm | undefined {
  return ROLE_FORMS.find((f) => f.role === role);
}

export function formById(id: string): RoleForm | undefined {
  return ROLE_FORMS.find((f) => f.id === id);
}
