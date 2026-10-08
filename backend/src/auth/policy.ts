/**
 * Which requests each role may make, decided by method + path — default-deny for the two narrow
 * roles. Written as a pure function so it can be tested without a database, and so a new route is
 * closed to Branch Managers / QFS Officers until someone deliberately lists it here, rather than
 * open until someone remembers to close it.
 *
 * admin / warehouse_incharge: everything (warehouse scoping is enforced separately, in scope.ts;
 * admin-only routes use requireRole).
 */
import type { Role } from "@anagroci/contract/data/roles";

type Rule = { method: string; path: RegExp };

const READ_RECEIPTS: Rule[] = [
  // `plan-info` is the whole warehouse's plan/exception view, not a receipt id: it isn't filtered by the
  // reader's suppliers, so it stays with Warehouse Incharge / admin.
  { method: "GET", path: /^\/api\/receipts(\/(?!plan-info$)[^/]+)?$/ },
  { method: "GET", path: /^\/api\/receipts\/downstream$/ },
  { method: "GET", path: /^\/api\/masters$/ },
];

const COMMON: Rule[] = [
  { method: "GET", path: /^\/api\/auth\/me$/ },
  { method: "POST", path: /^\/api\/auth\/logout$/ },
  // A submitter sees their own submissions (filtered by author in the service).
  { method: "GET", path: /^\/api\/submissions$/ },
  { method: "POST", path: /^\/api\/receipts\/[^/]+\/submissions$/ },
];

const ALLOWED: Partial<Record<Role, Rule[]>> = {
  branch_manager: [
    ...COMMON,
    ...READ_RECEIPTS,
    { method: "GET", path: /^\/api\/my-suppliers$/ },
    { method: "GET", path: /^\/api\/supplier-requests$/ },
    { method: "POST", path: /^\/api\/supplier-requests$/ },
  ],
  qfs_officer: [...COMMON, ...READ_RECEIPTS],
};

export function isAllowed(role: Role, method: string, path: string): boolean {
  const rules = ALLOWED[role];
  if (!rules) return true; // admin and warehouse_incharge
  return rules.some((r) => r.method === method && r.path.test(path));
}
