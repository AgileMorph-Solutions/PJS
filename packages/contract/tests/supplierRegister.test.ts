import { describe, it, expect } from "vitest";
import { missingRequired, requiredCompleteness, requiredProblems, statusProblem, PROFILE_FIELDS } from "../src/domain/supplierProfile";
import { supplierPerformance, type SupplierTruckFacts } from "../src/domain/supplierPerformance";

const full = Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, "x"]));

describe("supplier profile requirements", () => {
  it("counts required fields, and lists what is missing", () => {
    expect(requiredCompleteness({})).toEqual({ filled: 0, total: 8 });
    expect(requiredCompleteness(full)).toEqual({ filled: 8, total: 8 });
    expect(missingRequired({ ...full, zone: "  ", bankName: null }).map((f) => f.key)).toEqual(["zone", "bankName"]);
  });

  it("a new supplier needs every required field", () => {
    expect(requiredProblems({ name: "SCOOP A" }, null)).toHaveLength(7); // everything but the name it was given
    expect(requiredProblems(full, null)).toEqual([]);
  });

  it("an existing supplier may stay as incomplete as it was, but can't empty a required field it has", () => {
    expect(requiredProblems({ name: "SCOOP A" }, { name: "SCOOP A" })).toEqual([]);
    expect(requiredProblems({ name: "SCOOP A", zone: "" }, { name: "SCOOP A", zone: "Nord" })).toEqual(["Zone is required and can't be emptied."]);
  });

  it("a supplier that isn't active needs a reason", () => {
    expect(statusProblem("active", null)).toBeNull();
    expect(statusProblem("suspended", " ")).toMatch(/suspended/);
    expect(statusProblem("inactive", "Stopped trading")).toBeNull();
  });
});

describe("supplier performance", () => {
  const t = (over: Partial<SupplierTruckFacts>): SupplierTruckFacts => ({ arrivalDate: "2026-03-01", rejected: false, ...over });

  it("works everything out from trucks, plans and jute, and averages quality by delivered kg", () => {
    const p = supplierPerformance(
      [
        t({ arrivalDate: "2026-03-01", grnKg: 30000, kor: 48, moisture: 9 }),
        t({ arrivalDate: "2026-03-05", grnKg: 10000, kor: 44, moisture: 11 }),
        t({ arrivalDate: "2026-03-09", rejected: true, kor: 30, moisture: 15 }), // rejected: counts as arrived, not in averages
        t({ arrivalDate: "2026-03-07", grnKg: 5000 }), // no readings: in volume, not in averages
      ],
      [{ expectedKg: 50000, receivedKg: 40000, cancelled: false }, { expectedKg: 99999, receivedKg: 0, cancelled: true }],
      { issued: 1200, returned: 900, movements: 4 },
    );
    expect(p).toMatchObject({
      targetKg: 50000, receivedOnPlansKg: 40000, volumeDeliveredKg: 45000, achievementPct: 80,
      averageKor: 47, korTrucks: 2, averageMoisture: 9.5, moistureTrucks: 2,
      trucksArrived: 4, rejectedTrucks: 1, rejectionRatePct: 25, lastDeliveryDate: "2026-03-07",
      juteBagBalance: 300, fundingExposure: null, outstandingAmount: null,
    });
  });

  it("leaves a figure empty when its records don't exist, rather than showing 0", () => {
    const p = supplierPerformance([], [], { issued: 0, returned: 0, movements: 0 });
    expect(p).toMatchObject({ targetKg: null, achievementPct: null, averageKor: null, rejectionRatePct: null, lastDeliveryDate: null, juteBagBalance: null });
    expect(p.volumeDeliveredKg).toBe(0);
  });
});
