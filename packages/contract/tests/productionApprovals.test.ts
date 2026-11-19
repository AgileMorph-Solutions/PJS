import { describe, it, expect } from "vitest";
import { productionApprovalKinds } from "../src/domain/productionApprovals";
import { ROLES } from "../src/data/roles";

// Each step goes up to the role above it (Lokesh, 16 Nov 2026, "Option 1"): the warehouse approves its QFS Officer's
// moisture checks; the Production Incharge accepts the warehouse's loads and approves the factory's checks.
describe("who decides which production approvals", () => {
  it("sends the moisture check to the warehouse, the load and the factory's checks to the Production Incharge, both to Admin", () => {
    const by = Object.fromEntries(ROLES.map((r) => [r.value, productionApprovalKinds(r.value)]));
    expect(by.warehouse_incharge).toEqual(["moisture_check"]);
    expect(by.production_incharge).toEqual(["load_acceptance", "sizing_check", "lot_entry"]);
    expect(by.admin).toEqual(["moisture_check", "load_acceptance", "sizing_check", "lot_entry"]);
  });

  it("gives the roles that only submit or watch nothing to decide", () => {
    for (const role of ["qfs_officer", "branch_manager", "factory_manager"] as const) expect(productionApprovalKinds(role)).toEqual([]);
  });
});
