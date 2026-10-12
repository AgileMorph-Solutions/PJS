import { describe, it, expect } from "vitest";
import { truckTimeline } from "../src/domain/truckTimeline";
import type { ReceiptRecord } from "../src/types/receipt";

const base = (over: Partial<ReceiptRecord> = {}): ReceiptRecord => ({
  id: "REC-X", source: "entered", arrivalDate: "2026-09-01", supplierName: "SCOOP A", lbaCode: "LBA-1", vehicleNo: "1200KT01", warehouse: "BOUAKE",
  stageData: { "n-gate": { "DATE OF ARRIVAL": "2026-09-02" } }, branches: {}, timeline: [], ...over,
});
const ids = (r: ReceiptRecord) => truckTimeline(r).map((s) => `${s.id}:${s.state}`);

describe("truck timeline", () => {
  it("a truck that only arrived shows the arrival and the one step it waits on", () => {
    expect(ids(base())).toEqual(["arrived:done", "quality:next"]);
  });

  it("uses the date the warehouse typed for arrival, not the receipt's own column", () => {
    const [arrived] = truckTimeline(base());
    expect(arrived).toMatchObject({ at: "2026-09-02", atKind: "entered" });
  });

  it("a rejected truck stops at the rejection and shows its reason; later steps are not listed as pending", () => {
    const r = base({
      branches: { "n-qfs": "fail" }, stageData: { "n-gate": {}, "n-verify": {}, "n-reject": { "Reason for rejection": "Moisture too high" } },
      timeline: [{ status: "rejected", at: "2026-09-02T10:15:00.000Z" }],
    });
    const steps = truckTimeline(r);
    expect(steps.map((s) => s.id)).toEqual(["arrived", "quality"]);
    expect(steps[1]).toMatchObject({ state: "rejected", detail: "Moisture too high", at: "2026-09-02 10:15", atKind: "recorded" });
  });

  it("says 'No reason recorded' rather than inventing one", () => {
    const r = base({ branches: { "n-qfs": "fail" }, stageData: { "n-gate": {}, "n-verify": {} } });
    expect(truckTimeline(r)[1]?.detail).toBe("No reason recorded");
  });

  it("a truck through GRN lists every step so far, with the GRN weight, and offers stock next", () => {
    const r = base({
      branches: { "n-qfs": "pass" }, lotNo: "LOT-BKE-2026-0001",
      stageData: { "n-gate": {}, "n-verify": {}, "n-unload": { "DATE OF OFFLOADING": "2026-09-03" }, "n-grn": { "GRN Weight (kept separate from Gross/Net/Paid)": "24350", PRICE: "450" } },
      timeline: [{ status: "pending_unload", at: "2026-09-02", note: "Lot LOT-BKE-2026-0001 issued" }, { status: "grn_completed", at: "2026-09-04" }],
    });
    expect(ids(r)).toEqual(["arrived:done", "quality:done", "unloaded:done", "lot:done", "grn:done", "stock:next"]);
    const steps = truckTimeline(r);
    expect(steps.find((s) => s.id === "unloaded")).toMatchObject({ at: "2026-09-03", atKind: "entered" });
    expect(steps.find((s) => s.id === "lot")).toMatchObject({ detail: "LOT-BKE-2026-0001", atKind: "recorded" });
    expect(steps.find((s) => s.id === "grn")?.detail).toMatch(/24.350 kg/);
  });
});
