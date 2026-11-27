/**
 * Which requests each role may make, decided by method + path — default-deny for every listed role.
 * Written as a pure function so it can be tested without a database, and so a new route is closed to
 * the narrower roles until someone deliberately lists it here, rather than open until someone
 * remembers to close it.
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

const SIGN_IN: Rule[] = [
  { method: "GET", path: /^\/api\/auth\/me$/ },
  { method: "POST", path: /^\/api\/auth\/logout$/ },
  // Live updates (27 Nov 2026): "something changed at your warehouse", and nothing else (routes/events.ts).
  { method: "GET", path: /^\/api\/events$/ },
];

const MASTERS: Rule = { method: "GET", path: /^\/api\/masters$/ };
const PRODUCTION_PATH = /^\/api\/production(\/.*)?$/;
const PRODUCTION_READ: Rule = { method: "GET", path: PRODUCTION_PATH };

const COMMON: Rule[] = [
  ...SIGN_IN,
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
    // The price is the Branch Manager's to set directly, with no approval (Oct 2026: the Incharge who approves no longer sees prices).
    { method: "PUT", path: /^\/api\/receipts\/[^/]+\/price$/ },
  ],
  qfs_officer: [
    ...COMMON,
    ...READ_RECEIPTS,
    // The QFS Officer is on the warehouse team (18 Nov 2026): each load's moisture check, which the Warehouse Incharge
    // approves. They read the run and its loads for it, and nothing after the intake.
    { method: "GET", path: /^\/api\/production\/batches(\/[^/]+)?$/ },
    { method: "GET", path: /^\/api\/production\/rcn-receipts$/ },
    { method: "POST", path: /^\/api\/production\/rcn-receipts\/[^/]+\/moisture-checks$/ },
    // Every quality check is theirs (26 Nov 2026): the factory's QC checks too — read the run's silos and Lots, send a
    // check for the Production Incharge's approval. The routes' own requireRole keeps the floor's records off them.
    { method: "GET", path: /^\/api\/production\/batches\/[^/]+\/(lots|calibration)$/ },
    { method: "POST", path: /^\/api\/production\/sizing-checks$/ },
    { method: "POST", path: /^\/api\/production\/factory-lots\/[^/]+\/entries$/ },
    // Their list of checks across every section, and the warehouse checks they send for approval (drying, transfer lot, triage).
    { method: "GET", path: /^\/api\/quality-checks$/ },
    { method: "GET", path: /^\/api\/quality-submissions$/ },
    { method: "POST", path: /^\/api\/quality-submissions$/ },
    // The readings for the Incharge's open drying form (27 Nov 2026, routes/qualityRequests.ts). Opening and closing it is the Incharge's.
    { method: "POST", path: /^\/api\/quality-requests\/\d+\/answer$/ },
  ],
  // The factory's two roles (Nov 2026) see Production, not procurement: no receipts (and so no prices), no ledgers. They
  // must stay listed — an unlisted role falls through to "everything" below.
  // The Production Incharge reaches every production route; each route's own requireRole keeps the warehouse's side
  // (recording and weighing a load, starting a run) to the Warehouse Incharge.
  production_incharge: [...SIGN_IN, MASTERS, PRODUCTION_READ, { method: "*", path: PRODUCTION_PATH }],
  // The Factory Manager watches: every production page, nothing written.
  factory_manager: [...SIGN_IN, MASTERS, PRODUCTION_READ],
};

export function isAllowed(role: Role, method: string, path: string): boolean {
  const rules = ALLOWED[role];
  if (!rules) return true; // admin and warehouse_incharge
  return rules.some((r) => (r.method === "*" || r.method === method) && r.path.test(path));
}
