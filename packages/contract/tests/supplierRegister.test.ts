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
        t({ arrivalDate: "2026-03-08", netKg: 10000, kor: 46, moisture: 10 }), // weighed, GRN not entered yet: weights the averages, not the GRN volume
      ],
      [{ expectedKg: 50000, receivedKg: 40000, cancelled: false }, { expectedKg: 99999, receivedKg: 0, cancelled: true }],
      { issued: 1200, returned: 900, movements: 4 },
    );
    expect(p).toMatchObject({
      targetKg: 50000, receivedOnPlansKg: 40000, volumeDeliveredKg: 45000, weighedOnArrivalKg: 10000, trucksAwaitingGrn: 1, achievementPct: 80,
      averageKor: 46.8, korTrucks: 3, averageMoisture: 9.6, moistureTrucks: 3,
      trucksArrived: 5, rejectedTrucks: 1, rejectionRatePct: 20, lastDeliveryDate: "2026-03-08",
      juteBagsIssued: 1200, juteBagsReturned: 900, juteBagBalance: 300, fundingExposure: null, outstandingAmount: null,
    });
  });

  it("counts bags and paid weight on accepted trucks only, and measures damaged bags only where a split was recorded", () => {
    const p = supplierPerformance(
      [
        t({ netKg: 10000, paidKg: 9900, bags: 200, goodBags: 190, dampBags: 6, tornBags: 4 }),
        t({ netKg: 20000, paidKg: 19800, bags: 400, goodBags: 400, dampBags: 0, tornBags: 0 }),
        t({ netKg: 5000, bags: 100 }), // counted, no split recorded: in the bag total, not in the damaged share
        t({ rejected: true, netKg: 9000, paidKg: 9000, bags: 150, goodBags: 100, dampBags: 50, tornBags: 0 }), // rejected: nothing counts
      ],
      [],
      { issued: 0, returned: 0, movements: 0 },
    );
    expect(p).toMatchObject({
      acceptedTrucks: 3, bagsDelivered: 700, goodBags: 590, dampBags: 6, tornBags: 4,
      damagedBagPct: 1.7, // 10 of the 600 bags whose split was recorded
      paidWeightKg: 29700, weighedOnArrivalKg: 35000, averageNetKgPerTruck: 11667,
    });
  });

  it("leaves a figure empty when its records don't exist, rather than showing 0", () => {
    const p = supplierPerformance([], [], { issued: 0, returned: 0, movements: 0 });
    expect(p).toMatchObject({ targetKg: null, achievementPct: null, averageKor: null, rejectionRatePct: null, lastDeliveryDate: null, juteBagBalance: null, damagedBagPct: null, averageNetKgPerTruck: null });
    expect(p.volumeDeliveredKg).toBe(0);
    expect(p.bagsDelivered).toBe(0);
  });
});
