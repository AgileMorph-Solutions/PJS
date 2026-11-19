import { describe, it, expect } from "vitest";
import { ROLE_FORMS, ROLES, canWriteStageDirectly, formForRole } from "../src/data/roles.js";
import { STAGE_FIELD_MAP } from "../src/generated/stageFieldMap.js";

describe("role forms", () => {
  it("only reference stage labels that still exist in the field dictionary", () => {
    for (const form of ROLE_FORMS) {
      for (const { stageId, labels } of form.stages) {
        const spec = STAGE_FIELD_MAP[stageId];
        expect(spec, `${form.id}: unknown stage ${stageId}`).toBeTruthy();
        for (const label of labels) {
          expect(
            spec.fields.some((f) => f.label === label),
            `${form.id}: ${stageId} has no field "${label}"`
          ).toBe(true);
        }
      }
    }
  });

  it("gives Branch Manager and QFS Officer a form, and the top of the hierarchy none", () => {
    expect(formForRole("branch_manager")?.id).toBe("bm-reception");
    expect(formForRole("qfs_officer")?.id).toBe("qfs-jute-check");
    expect(formForRole("warehouse_incharge")).toBeUndefined();
    expect(formForRole("admin")).toBeUndefined();
  });

  it("lets only admin and warehouse incharge write stages without approval", () => {
    const direct = ROLES.filter((r) => canWriteStageDirectly(r.value)).map((r) => r.value);
    expect(direct.sort()).toEqual(["admin", "warehouse_incharge"]);
  });
});

import { canSeeField, canSetPrice, redactStageData } from "../src/data/roles";
describe("price and amount visibility (Oct 2026)", () => {
  const sd = { "n-grn": { PRICE: "470", AMOUNT: "19158140", "GRN Weight (kept separate from Gross/Net/Paid)": "40762" }, "n-gate": { "VEHICLE NO.": "X" } };
  it("hides price and amount from the Warehouse Incharge only", () => {
    expect(canSeeField("warehouse_incharge", "n-grn", "PRICE")).toBe(false);
    expect(canSeeField("warehouse_incharge", "n-grn", "AMOUNT")).toBe(false);
    expect(canSeeField("warehouse_incharge", "n-grn", "GRN Weight (kept separate from Gross/Net/Paid)")).toBe(true);
    for (const role of ["admin", "branch_manager", "qfs_officer"] as const) expect(canSeeField(role, "n-grn", "PRICE")).toBe(true);
  });
  it("strips them from stage data without touching anything else, or the original", () => {
    expect(redactStageData(sd, "warehouse_incharge")).toEqual({ "n-grn": { "GRN Weight (kept separate from Gross/Net/Paid)": "40762" }, "n-gate": { "VEHICLE NO.": "X" } });
    expect(sd["n-grn"].PRICE).toBe("470");
    expect(redactStageData(sd, "admin")).toBe(sd);
  });
  it("lets the Branch Manager and Admin set the price, nobody else", () => {
    expect(canSetPrice("branch_manager")).toBe(true);
    expect(canSetPrice("admin")).toBe(true);
    expect(canSetPrice("warehouse_incharge")).toBe(false);
    expect(canSetPrice("qfs_officer")).toBe(false);
  });
  it("the Branch Manager's approval form no longer carries the price", () => {
    expect(formForRole("branch_manager")!.stages.some((s) => s.labels.includes("PRICE"))).toBe(false);
  });
});


import { canAccessProduction } from "../src/data/roles";
describe("production access", () => {
  it("is for the Central (factory) warehouse's Incharge and QFS Officer, and admin", () => {
    expect(canAccessProduction("admin", null)).toBe(true);
    expect(canAccessProduction("warehouse_incharge", "CENTRAL")).toBe(true);
    expect(canAccessProduction("qfs_officer", "CENTRAL")).toBe(true);
  });
  it("is closed to Unit warehouse users, whatever their role", () => {
    for (const role of ["warehouse_incharge", "qfs_officer", "branch_manager"] as const) {
      expect(canAccessProduction(role, "UNIT")).toBe(false);
    }
  });
  it("is closed to a Branch Manager even at the factory, and to anyone with no warehouse yet", () => {
    expect(canAccessProduction("branch_manager", "CENTRAL")).toBe(false);
    expect(canAccessProduction("warehouse_incharge", null)).toBe(false);
    expect(canAccessProduction("qfs_officer", undefined)).toBe(false);
  });
});

import { roleFitsWarehouseType } from "../src/data/roles";
describe("which warehouse category a role fits", () => {
  it("puts Production Incharge and Factory Manager at a Central warehouse only", () => {
    for (const role of ["production_incharge", "factory_manager"] as const) {
      expect(roleFitsWarehouseType(role, "CENTRAL")).toBe(true);
      expect(roleFitsWarehouseType(role, "UNIT")).toBe(false);
      expect(roleFitsWarehouseType(role, null)).toBe(false);
    }
  });
  it("leaves the warehouse roles free to work at either category", () => {
    for (const role of ["warehouse_incharge", "branch_manager", "qfs_officer"] as const) {
      expect(roleFitsWarehouseType(role, "UNIT")).toBe(true);
      expect(roleFitsWarehouseType(role, "CENTRAL")).toBe(true);
    }
  });
});

import { canRecordIntake, canRunProduction } from "../src/data/roles";
// Lokesh, 16 Nov 2026 ("Option 1"): the warehouse records and weighs a load, production accepts it and runs what follows.
describe("the two sides of production", () => {
  it("gives the load's intake to the warehouse and everything after its acceptance to production; Admin does both", () => {
    expect(ROLES.filter((r) => canRecordIntake(r.value)).map((r) => r.value)).toEqual(["admin", "warehouse_incharge"]);
    expect(ROLES.filter((r) => canRunProduction(r.value)).map((r) => r.value)).toEqual(["admin", "production_incharge"]);
  });
  it("opens Production to the factory roles at a Central warehouse, the Factory Manager to watch", () => {
    for (const role of ["production_incharge", "factory_manager"] as const) {
      expect(canAccessProduction(role, "CENTRAL")).toBe(true);
      expect(canAccessProduction(role, "UNIT")).toBe(false);
    }
    expect(canRecordIntake("factory_manager") || canRunProduction("factory_manager")).toBe(false);
  });
});

import { canSeeFactory } from "../src/data/roles";
// 18 Nov 2026: "the warehouse guy will not see the entire production process" — the production team sees all of it.
describe("who sees production past the intake", () => {
  it("is the production team and Admin; the warehouse team (Incharge and QFS Officer) sees only its loads", () => {
    expect(ROLES.filter((r) => canSeeFactory(r.value)).map((r) => r.value)).toEqual(["admin", "production_incharge", "factory_manager"]);
  });
});
