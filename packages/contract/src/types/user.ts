import type { Role } from "../data/roles.js";
import type { WarehouseType } from "../data/warehouseTypes.js";

/** What the API returns for a user — never the password hash. `warehouseType` is looked up from the
 * user's warehouse (null for admin, who has none). */
export interface UserView {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  warehouse: string | null;
  warehouseType: WarehouseType | null;
  active: boolean;
}

export type SubmissionStatus = "submitted" | "approved" | "rejected";

/** `values` is {stageId: {fieldLabel: value}} — exactly what was submitted, immutable after. */
export interface SubmissionView {
  id: string;
  receiptId: string;
  formId: string;
  values: Record<string, Record<string, string>>;
  status: SubmissionStatus;
  submittedBy: string;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  warehouse: string;
}

export interface BranchManagerView {
  id: string;
  username: string;
  displayName: string;
  warehouse: string | null;
  active: boolean;
  supplierCodes: string[];
}

export type SupplierRequestStatus = "pending" | "approved" | "rejected";

export interface SupplierRequestView {
  id: string;
  name: string;
  code: string | null;
  status: SupplierRequestStatus;
  reason: string | null;
  requestedBy: string;
  warehouse: string | null;
  createdAt: string;
}
