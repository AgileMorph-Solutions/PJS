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
