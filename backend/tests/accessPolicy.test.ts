import { describe, it, expect } from "vitest";
import { isAllowed } from "../src/auth/policy.js";

// The default-deny guard: a new route must be listed in policy.ts before a Branch Manager or QFS
// Officer can reach it. These pin what they can NOT do, which is what a careless edit would break.
describe("role access policy", () => {
  it("lets admin and warehouse incharge do anything", () => {
    for (const role of ["admin", "warehouse_incharge"] as const) {
      expect(isAllowed(role, "PATCH", "/api/receipts/REC-2026-0001/stages/n-gross")).toBe(true);
      expect(isAllowed(role, "POST", "/api/imports/abc/commit")).toBe(true);
    }
  });

  it("keeps Branch Manager and QFS Officer away from direct stage writes, imports and ledgers", () => {
    for (const role of ["branch_manager", "qfs_officer"] as const) {
      expect(isAllowed(role, "PATCH", "/api/receipts/REC-2026-0001/stages/n-gross")).toBe(false);
      expect(isAllowed(role, "POST", "/api/receipts")).toBe(false);
      expect(isAllowed(role, "POST", "/api/receipts/REC-2026-0001/branch")).toBe(false);
      expect(isAllowed(role, "POST", "/api/imports/preview")).toBe(false);
      expect(isAllowed(role, "POST", "/api/masters/suppliers")).toBe(false);
      expect(isAllowed(role, "GET", "/api/jute-ledgers")).toBe(false);
      expect(isAllowed(role, "GET", "/api/data-quality")).toBe(false);
      expect(isAllowed(role, "POST", "/api/submissions/x/approve")).toBe(false);
    }
  });

  it("lets them read receipts and submit their form", () => {
    for (const role of ["branch_manager", "qfs_officer"] as const) {
      expect(isAllowed(role, "GET", "/api/receipts")).toBe(true);
      expect(isAllowed(role, "GET", "/api/receipts/REC-2026-0001")).toBe(true);
      expect(isAllowed(role, "POST", "/api/receipts/REC-2026-0001/submissions")).toBe(true);
    }
  });

  it("only lets a Branch Manager use the supplier request routes", () => {
    expect(isAllowed("branch_manager", "POST", "/api/supplier-requests")).toBe(true);
    expect(isAllowed("branch_manager", "GET", "/api/my-suppliers")).toBe(true);
    expect(isAllowed("qfs_officer", "POST", "/api/supplier-requests")).toBe(false);
    expect(isAllowed("branch_manager", "POST", "/api/supplier-requests/x/approve")).toBe(false);
  });
});
