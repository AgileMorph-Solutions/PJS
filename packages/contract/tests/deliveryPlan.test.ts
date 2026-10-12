import { describe, it, expect } from "vitest";
import {
  planProgress, planStatus, isOverdue, plannedReceptionInfo, unplannedInfo, exceptionApprovalStatus, planLinkStatus, planPrefill,
  type PlanTerms, type PlanReceiptFacts,
} from "../src/domain/deliveryPlan.js";

const terms = (over: Partial<PlanTerms> = {}): PlanTerms => ({
  expectedQuantityKg: 100_000, expectedTrucks: 3, expectedArrivalDate: "2026-02-18", expectedDeliveryEnd: "2026-05-07",
  expectedOrigin: "VAVOUA", destinationStore: "BKE-003", cancelled: false, ...over,
});
const truck = (id: string, over: Partial<PlanReceiptFacts> = {}): PlanReceiptFacts => ({
  id, arrivalDate: "2026-03-01", rejected: false, grnKg: 30_000, origin: "VAVOUA", store: "BKE-003", ...over,
});

describe("plan progress", () => {
  // The client's own plan DP-BKE-2026-006: 78,715 kg expected, 92,606 kg received over 3 trucks.
  it("reproduces the client's over-delivered plan: remaining −13,891 kg, variance +13,891 kg", () => {
    const p = planProgress({ expectedQuantityKg: 78_715 }, [
      truck("a", { grnKg: 30_000 }), truck("b", { grnKg: 31_000 }), truck("c", { grnKg: 31_606 }),
    ]);
    expect(p).toEqual({ actualKg: 92_606, arrivals: 3, acceptedTrucks: 3, rejectedTrucks: 0, awaitingGrnTrucks: 0, remainingKg: -13_891, varianceKg: 13_891 });
  });

  it("counts a rejected truck as an arrival but not an accepted one, and a truck without a GRN adds no kg", () => {
    const p = planProgress({ expectedQuantityKg: 100_000 }, [truck("a"), truck("b", { rejected: true, grnKg: undefined }), truck("c", { grnKg: undefined })]);
    expect(p).toMatchObject({ actualKg: 30_000, arrivals: 3, acceptedTrucks: 2, rejectedTrucks: 1, awaitingGrnTrucks: 1, remainingKg: 70_000 });
  });

  it("has no remaining or variance when no quantity was planned — not 0", () => {
    expect(planProgress({ expectedQuantityKg: null }, [truck("a")])).toMatchObject({ remainingKg: null, varianceKg: null, actualKg: 30_000 });
  });
});

describe("plan status", () => {
  const status = (t: PlanTerms, trucks: PlanReceiptFacts[]) => planStatus(t, planProgress(t, trucks));

  it("is planned until a truck arrives, then partially received", () => {
    expect(status(terms(), [])).toBe("planned");
    expect(status(terms(), [truck("a")])).toBe("partially_received");
  });

  it("is delivered when the expected trucks OR the expected quantity have arrived", () => {
    expect(status(terms(), [truck("a"), truck("b"), truck("c")])).toBe("delivered");
    expect(status(terms({ expectedQuantityKg: 50_000, expectedTrucks: 9 }), [truck("a"), truck("b")])).toBe("delivered");
  });

  it("is cancelled only by the stored decision — arrivals don't undo it, they are flagged instead", () => {
    expect(status(terms({ cancelled: true }), [truck("a"), truck("b"), truck("c")])).toBe("cancelled");
  });

  it("never calls an empty plan delivered, even if it expected nothing", () => {
    expect(status(terms({ expectedQuantityKg: 0, expectedTrucks: 0 }), [])).toBe("planned");
  });

  it("reports lateness separately, so a half-delivered plan past its window is both", () => {
    const t = terms();
    expect(isOverdue(t, "partially_received", "2026-06-01")).toBe(true);
    expect(isOverdue(t, "delivered", "2026-06-01")).toBe(false);
    expect(isOverdue(t, "cancelled", "2026-06-01")).toBe(false);
    expect(isOverdue(t, "planned", "2026-05-07")).toBe(false); // the last day is still on time
    expect(isOverdue(terms({ expectedDeliveryEnd: null }), "planned", "2026-02-19")).toBe(true); // falls back to the start
  });
});

describe("reception type and flags", () => {
  const info = (t: PlanTerms, trucks: PlanReceiptFacts[], id: string) => plannedReceptionInfo(t, trucks).get(id)!;

  it("a truck that matches its plan is simply planned", () => {
    expect(info(terms(), [truck("a")], "a")).toEqual({ type: "planned", flags: [] });
  });

  it("flags each way a truck departs from the plan", () => {
    expect(info(terms(), [truck("a", { origin: "MANKONO" })], "a").flags).toEqual(["origin_mismatch"]);
    expect(info(terms(), [truck("a", { store: "BKE-001" })], "a").flags).toEqual(["warehouse_change"]);
    expect(info(terms(), [truck("a", { arrivalDate: "2026-02-10" })], "a").flags).toEqual(["early_delivery"]);
    expect(info(terms(), [truck("a", { arrivalDate: "2026-06-10" })], "a").flags).toEqual(["late_delivery"]);
    expect(info(terms({ cancelled: true }), [truck("a")], "a").flags).toEqual(["plan_cancelled"]);
    expect(info(terms(), [truck("a", { origin: "MANKONO" })], "a").type).toBe("planned_with_exception");
  });

  it("puts 'over the planned quantity' on the truck that crossed it, not on every truck", () => {
    const t = terms({ expectedQuantityKg: 78_715 });
    const trucks = [
      truck("a", { grnKg: 30_000, arrivalDate: "2026-03-01" }),
      truck("b", { grnKg: 31_000, arrivalDate: "2026-03-02" }),
      truck("c", { grnKg: 31_606, arrivalDate: "2026-03-03" }),
    ];
    const all = plannedReceptionInfo(t, trucks);
    expect(all.get("a")!.flags).toEqual([]);
    expect(all.get("b")!.flags).toEqual([]);
    expect(all.get("c")!.flags).toEqual(["plan_excess"]);
  });

  it("judges trucks in arrival order whatever order they are passed in", () => {
    const t = terms({ expectedQuantityKg: 50_000 });
    const all = plannedReceptionInfo(t, [truck("late", { grnKg: 30_000, arrivalDate: "2026-03-05" }), truck("early", { grnKg: 30_000, arrivalDate: "2026-03-01" })]);
    expect(all.get("early")!.flags).toEqual([]);
    expect(all.get("late")!.flags).toEqual(["plan_excess"]);
  });

  it("treats an unrecorded origin or store as unknown, never as a mismatch", () => {
    expect(info(terms(), [truck("a", { origin: undefined, store: undefined })], "a")).toEqual({ type: "planned", flags: [] });
    expect(info(terms({ expectedOrigin: null, destinationStore: null }), [truck("a", { origin: "X", store: "Y" })], "a").flags).toEqual([]);
  });

  it("compares origin ignoring case and surrounding spaces", () => {
    expect(info(terms(), [truck("a", { origin: " vavoua " })], "a").flags).toEqual([]);
  });

  it("a rejected planned truck is not an exception on that account alone", () => {
    expect(info(terms(), [truck("a", { rejected: true })], "a")).toEqual({ type: "planned", flags: ["quality_rejected"] });
  });

  it("a truck with no plan is unplanned, with the reasons it can be told from the data", () => {
    expect(unplannedInfo({ rejected: false })).toEqual({ type: "unplanned", flags: ["unplanned"] });
    expect(unplannedInfo({ rejected: true })).toEqual({ type: "unplanned", flags: ["unplanned", "quality_rejected"] });
    expect(unplannedInfo({ rejected: false }, { knownSupplier: false }).flags).toEqual(["unplanned", "unknown_supplier"]);
    expect(unplannedInfo({ rejected: false }, { knownSupplier: true }).flags).toEqual(["unplanned"]);
  });
});

describe("approval and link status", () => {
  const planned = { type: "planned", flags: [] } as const;
  const exception = { type: "planned_with_exception", flags: ["origin_mismatch"] } as const;
  const unplanned = { type: "unplanned", flags: ["unplanned"] } as const;

  it("only departures from the plan need approval, and only until someone approves", () => {
    expect(exceptionApprovalStatus(planned, false, null)).toBe("not_required");
    expect(exceptionApprovalStatus(exception, false, null)).toBe("pending");
    expect(exceptionApprovalStatus(unplanned, false, null)).toBe("pending");
    expect(exceptionApprovalStatus(unplanned, false, "2026-03-01T08:00:00Z")).toBe("approved");
  });

  it("a rejected truck needs no approval, whatever it was", () => {
    expect(exceptionApprovalStatus(unplanned, true, null)).toBe("not_applicable_rejected");
    expect(exceptionApprovalStatus(exception, true, "2026-03-01T08:00:00Z")).toBe("not_applicable_rejected");
  });

  it("says whether the truck arrived against its plan or was linked afterwards", () => {
    expect(planLinkStatus(null, null)).toBe("not_planned");
    expect(planLinkStatus("DP-BKE-2026-001", null)).toBe("planned_from_start");
    expect(planLinkStatus("DP-BKE-2026-001", "2026-03-02T09:00:00Z")).toBe("linked_later");
  });
});

describe("what the plan already knows", () => {
  const plan = { supplierName: "SCAAMT COOP CA", supplierCode: "LBA-002-SCA", expectedOrigin: "VAVOUA", destinationStore: "BKE-003" };

  it("suggests the plan's supplier, code and origin for the supplier-documents stage", () => {
    expect(planPrefill(plan, {}, "n-verify")).toEqual({
      "SUPPLIERS NAME": { value: "SCAAMT COOP CA", from: "delivery plan" },
      "LBA CODE": { value: "LBA-002-SCA", from: "delivery plan" },
      ORIGIN: { value: "VAVOUA", from: "delivery plan" },
    });
  });

  it("suggests the planned store for the gate", () => {
    expect(planPrefill(plan, {}, "n-gate")).toEqual({ "WH NO.": { value: "BKE-003", from: "delivery plan" } });
  });

  it("never suggests over a value that is already there, or for a stage the plan knows nothing about", () => {
    expect(planPrefill(plan, { "n-verify": { ORIGIN: "MANKONO", "LBA CODE": " " } }, "n-verify")).toEqual({
      "SUPPLIERS NAME": { value: "SCAAMT COOP CA", from: "delivery plan" },
      "LBA CODE": { value: "LBA-002-SCA", from: "delivery plan" }, // blank counts as empty
    });
    expect(planPrefill(plan, {}, "n-qfs")).toEqual({});
  });

  it("offers nothing for a truck with no plan, or a plan that left a field out", () => {
    expect(planPrefill(undefined, {}, "n-verify")).toEqual({});
    expect(planPrefill({ ...plan, expectedOrigin: null, supplierCode: null }, {}, "n-verify")).toEqual({
      "SUPPLIERS NAME": { value: "SCAAMT COOP CA", from: "delivery plan" },
    });
  });
});
