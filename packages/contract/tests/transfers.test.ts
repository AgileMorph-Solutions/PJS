import { describe, it, expect } from "vitest";
import { transferVariance, transferState, TRANSFER_TOLERANCE, type TransferFacts } from "../src/domain/transfers.js";

const t = (over: Partial<TransferFacts> = {}): TransferFacts => ({
  status: "received",
  lines: [{ bags: 590, netWeightKg: 48_290 }],
  dispatchedGrossKg: 48_880,
  bagsReceived: 574,
  receivedGrossKg: 48_820,
  ...over,
});

describe("BKT variance", () => {
  // The client's own BKT001 row: sent 590 bags / 48,880 kg gross, received 574 bags / 48,820 kg gross.
  it("reproduces the client's BKT001: −16 bags and −44 kg", () => {
    expect(transferVariance(t())).toEqual({
      bagsDispatched: 590, bagsReceived: 574, bagVariance: -16,
      netDispatchedKg: 48_290, netAtArrivalKg: 48_246, weightVarianceKg: -44,
    });
  });

  it("reproduces BKT005, which gained weight: +16 bags, +1,064 kg", () => {
    expect(transferVariance(t({ lines: [{ bags: 592, netWeightKg: null }], dispatchedGrossKg: 50_760, bagsReceived: 608, receivedGrossKg: 51_840 }))).toMatchObject({
      bagVariance: 16, netDispatchedKg: 50_168, netAtArrivalKg: 51_232, weightVarianceKg: 1_064,
    });
  });

  it("sums several Lots on one truck", () => {
    const v = transferVariance(t({ lines: [{ bags: 344, netWeightKg: 1 }, { bags: 150, netWeightKg: 1 }], dispatchedGrossKg: 40_200, bagsReceived: 516, receivedGrossKg: 40_300 }));
    expect(v).toMatchObject({ bagsDispatched: 494, netDispatchedKg: 39_706, bagVariance: 22, netAtArrivalKg: 39_784, weightVarianceKg: 78 });
  });

  it("falls back to the Lots' own net weights when the truck wasn't weighed at dispatch", () => {
    const v = transferVariance(t({ dispatchedGrossKg: null, lines: [{ bags: 300, netWeightKg: 20_000 }, { bags: 290, netWeightKg: 28_290 }] }));
    expect(v.netDispatchedKg).toBe(48_290);
  });

  it("is not computed until the destination has recorded the arrival — nothing is compared at dispatch", () => {
    for (const status of ["requested", "dispatched"] as const) {
      // Even if received fields were somehow present, they don't count before the truck has arrived.
      expect(transferVariance(t({ status }))).toMatchObject({ bagsReceived: null, bagVariance: null, netAtArrivalKg: null, weightVarianceKg: null });
    }
    expect(transferVariance(t({ status: "dispatched" })).netDispatchedKg).toBe(48_290); // what was sent is known
  });

  it("leaves a variance null rather than 0 when one side is unknown", () => {
    expect(transferVariance(t({ receivedGrossKg: null }))).toMatchObject({ bagVariance: -16, netAtArrivalKg: null, weightVarianceKg: null });
    expect(transferVariance(t({ lines: [{ bags: null, netWeightKg: null }], dispatchedGrossKg: null }))).toMatchObject({ bagsDispatched: null, bagVariance: null, netDispatchedKg: null });
    expect(transferVariance(t({ lines: [] }))).toMatchObject({ bagsDispatched: null });
  });
});

describe("BKT status", () => {
  it("steps requested → in transit, with no variance yet", () => {
    expect(transferState(t({ status: "requested" }))).toBe("requested");
    expect(transferState(t({ status: "dispatched" }))).toBe("in_transit");
  });

  it("is closed only when what arrived matches what left", () => {
    expect(transferState(t({ bagsReceived: 590, receivedGrossKg: 48_880 }))).toBe("closed");
  });

  it("is a discrepancy on any bag or weight difference — the client's own rule — whichever side moves", () => {
    expect(TRANSFER_TOLERANCE).toEqual({ bags: 0, kg: 0 });
    expect(transferState(t())).toBe("discrepancy");
    expect(transferState(t({ bagsReceived: 591, receivedGrossKg: 48_880 + 1 }))).toBe("discrepancy"); // +1 bag, +1 kg gross → net equal, bags off
    expect(transferState(t({ bagsReceived: 590, receivedGrossKg: 48_900 }))).toBe("discrepancy"); // bags equal, weight off
  });

  it("a missing weight never turns a matching transfer into a discrepancy by itself", () => {
    expect(transferState(t({ bagsReceived: 590, receivedGrossKg: null }))).toBe("closed");
  });
});
