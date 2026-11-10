import { describe, it, expect } from "vitest";
import { formatRcnReceiptId, parseSiteId } from "../src/domain/ids";
import { batchStatus } from "../src/domain/productionBatch";
import { canTakeMoistureCheck, moistureCheckError, moistureKor, rcnReceiptStatus, sameBtmAndBin } from "../src/domain/rcnReceipt";

describe("RCN Receipt IDs", () => {
  it("are issued in the Phase 1 doc's shape, RR-YAK-2026-0001, and parse back", () => {
    expect(formatRcnReceiptId("YAK", 2026, 1)).toBe("RR-YAK-2026-0001");
    expect(parseSiteId("RR-YAK-2026-0002")).toEqual({ kind: "RR", code: "YAK", year: 2026, seq: 2 });
  });
});

describe("batch status", () => {
  it("is Open until the first load arrives, then In process", () => {
    expect(batchStatus(0)).toBe("open");
    expect(batchStatus(1)).toBe("in_process");
  });
});

describe("same BTM from the same bin", () => {
  const existing = [
    { btmNo: "120", binCode: "BIN-03B" },
    { btmNo: "121", binCode: "BIN-03B" },
    { btmNo: "120", binCode: "BIN-10" },
  ];

  it("finds the earlier receipt of that BTM from that bin only", () => {
    expect(sameBtmAndBin(existing, " 120 ", "BIN-03B")).toEqual([existing[0]]);
    expect(sameBtmAndBin(existing, "122", "BIN-03B")).toEqual([]);
  });
});

describe("receipt status, derived from its moisture checks", () => {
  const ok = { status: "approved", decision: "ok" } as const;
  const hold = { status: "approved", decision: "hold" } as const;
  const pending = { status: "submitted", decision: "ok" } as const;
  const rejected = { status: "rejected", decision: "ok" } as const;

  it("follows the doc: waiting → waiting for approval → waiting for weighing, or on hold", () => {
    expect(rcnReceiptStatus([])).toBe("waiting_for_moisture");
    expect(rcnReceiptStatus([pending])).toBe("moisture_pending");
    expect(rcnReceiptStatus([ok])).toBe("waiting_for_weighing");
    expect(rcnReceiptStatus([hold])).toBe("on_hold");
  });

  it("a rejected check changes nothing; a re-check after a hold decides again", () => {
    expect(rcnReceiptStatus([rejected])).toBe("waiting_for_moisture");
    expect(rcnReceiptStatus([hold, rejected])).toBe("on_hold");
    expect(rcnReceiptStatus([hold, pending])).toBe("moisture_pending");
    expect(rcnReceiptStatus([hold, ok])).toBe("waiting_for_weighing");
  });

  it("takes a new check at any step, except while one is still waiting for approval", () => {
    expect(["waiting_for_moisture", "on_hold", "moisture_pending", "waiting_for_weighing", "intake_done", "calibrated"].map((s) => canTakeMoistureCheck(s as never)))
      .toEqual([true, true, false, true, true, true]);
  });
});

describe("moisture check form", () => {
  // The client's "2. Input RCN Quality report", BTM 1001: their own KOR (lbs) is 42.769239999999996.
  const btm1001 = { moisture: "9.8", nutCount: "180", sampleG: "1000", gkG: "230", spotG: "12", immatureG: "13", oilG: "5", rejectionG: "32", voidsG: "25", shellG: "664", fruitWasteG: "19", decision: "ok" };

  it("calculates KOR exactly as the client's sheet, and only with all three kernel grams", () => {
    expect(moistureKor(btm1001)).toBeCloseTo(42.76924, 8);
    expect(moistureKor({ gkG: "230", spotG: "12" })).toBeNull();
  });

  it("accepts the real row, and a check without a cut test", () => {
    expect(moistureCheckError(btm1001)).toBeNull();
    expect(moistureCheckError({ moisture: "8.3", nutCount: "173", decision: "hold" })).toBeNull();
  });

  it("refuses what the doc refuses, and says why", () => {
    expect(moistureCheckError({ ...btm1001, moisture: "21" })).toMatch(/between 0 and 20/);
    expect(moistureCheckError({ ...btm1001, moisture: "" })).toMatch(/moisture/);
    expect(moistureCheckError({ ...btm1001, nutCount: "" })).toMatch(/nut count/);
    expect(moistureCheckError({ ...btm1001, shellG: "700" })).toMatch(/1036 g, more than the 1000 g sample/);
    expect(moistureCheckError({ ...btm1001, decision: "" })).toMatch(/OK or Fail/);
  });
});

import { openStage, rcnReceiptStages } from "../src/domain/rcnReceipt";
describe("an RCN receipt's stages — recorded in any order", () => {
  type Check = { status: "submitted" | "approved" | "rejected"; decision: "ok" | "hold" };
  const ok: Check = { status: "approved", decision: "ok" };
  const r = (o: { checks?: Check[]; pallets?: number; finalWeight?: object | null; calibration?: { sizedKg: number; leftKg: number | null } | null } = {}) =>
    rcnReceiptStages({ status: "waiting_for_moisture", moistureChecks: o.checks ?? [], pallets: Array(o.pallets ?? 0).fill({}), finalWeight: o.finalWeight ?? null, calibration: o.calibration ?? null });

  it("a new load: moisture is next, nothing else done", () => {
    expect(r()).toEqual({ receipt: "done", moisture: "current", pallets: "todo", final_weight: "todo", calibration: "todo" });
  });

  it("each step is done by what it holds, whatever came before it", () => {
    // Weighed and closed before any moisture check: those two steps are done, moisture is still the next to do.
    expect(r({ pallets: 3, finalWeight: {} })).toEqual({ receipt: "done", moisture: "current", pallets: "done", final_weight: "done", calibration: "todo" });
    // Sorted before the final weight: not "done", as the total it must reach isn't known yet.
    expect(r({ checks: [ok], pallets: 2, calibration: { sizedKg: 500, leftKg: null } })).toMatchObject({ moisture: "done", final_weight: "current", calibration: "todo" });
  });

  it("a check waiting for approval is waiting, and the next open step is current", () => {
    const s = r({ checks: [{ status: "submitted", decision: "ok" }] });
    expect(s.moisture).toBe("waiting");
    expect(s.pallets).toBe("current");
    expect(openStage(s)).toBe("moisture");
  });

  it("a load on hold still needs its moisture check", () => {
    expect(r({ checks: [{ status: "approved", decision: "hold" }], pallets: 1 }).moisture).toBe("current");
  });

  it("all done once every step holds its record and all of the load is sorted", () => {
    const done = r({ checks: [ok], pallets: 3, finalWeight: {}, calibration: { sizedKg: 4538.9, leftKg: 0 } });
    expect(Object.values(done).every((x) => x === "done")).toBe(true);
    expect(openStage(done)).toBe("calibration");
  });
});
