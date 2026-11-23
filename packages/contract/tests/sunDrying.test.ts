import { describe, it, expect } from "vitest";
import { DRYING_STATUS, binDryingStockProblem, canSendDryingToProduction, dryingFieldProblem, dryingGramsTotalProblem, dryingKor, dryingPhase, dryingQualityProblem, isOpenRound, onDryingYard, truckDryingBlocker, type DryingQuality } from "../src/domain/sunDrying";
import { stageGate } from "../src/domain/phaseGate";

const q = (over: Partial<DryingQuality> = {}): DryingQuality => ({
  moisture: 9, nutCount: null, goodKernelG: null, immatureG: null, spottedG: null, rejectionG: null, voidG: null, oilG: null, shellG: null, kor: null, ...over,
});

describe("sun drying", () => {
  it("reads a round's phase, including the two statuses used before rounds existed and imported free text", () => {
    expect(dryingPhase(DRYING_STATUS.inDrying)).toBe("in_drying");
    expect(dryingPhase("IN PROGRESS")).toBe("in_drying");
    expect(dryingPhase(DRYING_STATUS.qualityCheck)).toBe("quality_check");
    expect(dryingPhase("COMPLETED")).toBe("passed");
    expect(dryingPhase(DRYING_STATUS.redry)).toBe("redry");
    expect(dryingPhase("DONE (sheet text)")).toBe("other");
    expect(isOpenRound("QUALITY CHECK")).toBe(true);
    expect(isOpenRound("PASSED")).toBe(false);
  });

  it("calculates KOR from the cut-test grams exactly as QFS does, and falls back to a typed KOR without them", () => {
    // The client's own Input RCN Quality row: 230 g good, 13 immature, 12 spotted → 42.77 lbs.
    expect(dryingKor(q({ goodKernelG: 230, immatureG: 13, spottedG: 12, kor: 50 }))).toBe(42.77);
    expect(dryingKor(q({ kor: 47.5 }))).toBe(47.5);
    expect(dryingKor(q({ goodKernelG: 230, kor: 47.5 }))).toBe(47.5); // grams incomplete: the typed value stands
  });

  it("requires moisture and refuses impossible readings", () => {
    expect(dryingQualityProblem(q({ moisture: null }), "after")).toMatch(/Moisture after drying is required/);
    expect(dryingQualityProblem(q({ moisture: 120 }), "before")).toMatch(/between 0 and 100/);
    expect(dryingQualityProblem(q({ goodKernelG: 700, shellG: 400 }), "after")).toMatch(/more than the 1000 g/);
    expect(dryingQualityProblem(q({ kor: 95 }), "after")).toMatch(/between 0 and 80/);
    expect(dryingQualityProblem(q({ goodKernelG: 230, immatureG: 13, spottedG: 12 }), "after")).toBeNull();
  });
});

describe("a truck sent from the drying yard straight to production", () => {
  it("is read from its latest round entered in the app; workbook rows and earlier rounds don't count", async () => {
    const { wentStraightToProduction } = await import("../src/domain/sunDrying");
    const r = (sn: number, status: string, source = "entered") => ({ sn, status, source });
    expect(wentStraightToProduction([])).toBe(false);
    expect(wentStraightToProduction([r(1, "RE-DRY"), r(2, "SENT TO PRODUCTION")])).toBe(true);
    expect(wentStraightToProduction([r(1, "SENT TO PRODUCTION"), r(2, "PASSED")])).toBe(false);
    expect(wentStraightToProduction([r(1, "SENT TO PRODUCTION", "imported")])).toBe(false);
  });
});

// 23 Nov 2026: a truck already in a Bin was also dried "straight off the truck", and its Bin offered the same RCN again.
describe("the truck's yard drying and a Bin's drying are exclusive", () => {
  const round = (sn: number, status: string) => ({ sn, source: "entered", status });

  it("dries a truck with no Bin from the yard; one in a Bin from that Bin; nothing after it went to production", () => {
    expect(truckDryingBlocker("", [])).toBeUndefined();
    expect(truckDryingBlocker("BKE-001-BIN-008", [])).toMatch(/is in Bin BKE-001-BIN-008, so it wasn't unloaded straight onto the drying yard/);
    expect(truckDryingBlocker("BKE-002-BIN-012", [round(1, "PASSED")])).toMatch(/dried RCN is in Bin BKE-002-BIN-012 now/);
    expect(truckDryingBlocker("", [round(1, "SENT TO PRODUCTION")])).toMatch(/sent straight to production/);
    expect(truckDryingBlocker("", [round(1, "PASSED")])).toBeUndefined(); // passed, Bin not chosen yet: may be dried again
  });

  it("locks the Bin step while the RCN is out on the yard, and opens it once it is back", () => {
    expect(onDryingYard([round(1, "IN DRYING")])).toBe(true);
    expect(onDryingYard([round(1, "QUALITY CHECK")])).toBe(true);
    expect(onDryingYard([round(1, "PASSED")])).toBe(false);
    expect(onDryingYard([{ sn: 1, source: "imported", status: "IN DRYING" }])).toBe(false); // a workbook row isn't the app's
    const r = { stageData: {}, branches: {} };
    expect(stageGate(r, "n-bin", { onDryingYard: true })).toMatchObject({ open: false, waitingFor: "Drying" });
  });

  it("takes from a Bin only what it holds", () => {
    expect(binDryingStockProblem("B1", 0, 100)).toMatch(/holds no RCN/);
    expect(binDryingStockProblem("B1", 5000, 6000)).toMatch(/holds 5,000 kg/);
    expect(binDryingStockProblem("B1", 5000, 5000)).toBeNull();
  });
});

// 23 Nov 2026: the drying form took anything; it now checks each field with the rules a truck's fields use.
describe("what the drying form checks", () => {
  it("wants numbers, in range, with a whole nut count and bags", () => {
    expect(dryingFieldProblem("inputMoisture", "abc")).toEqual({ message: `"abc" isn't a number.`, soft: false });
    expect(dryingFieldProblem("inputMoisture", "140")!.message).toMatch(/Above 100 %/);
    expect(dryingFieldProblem("inputMoisture", "13")).toBeUndefined(); // wet before drying is why it is dried
    expect(dryingFieldProblem("outputMoisture", "13")).toMatchObject({ soft: true, message: expect.stringMatching(/still too wet/) });
    expect(dryingFieldProblem("outputNutCount", "180.5")!.message).toBe("Not a whole number.");
    expect(dryingFieldProblem("inputKor", "1100")!.message).toMatch(/Above 80/);
    expect(dryingFieldProblem("outputGoodKernelG", "-3")!.message).toMatch(/Below 0/);
    expect(dryingFieldProblem("issuedNetKg", "0")!.message).toBe("Should be more than 0.");
    expect(dryingFieldProblem("issuedNetKg", "")).toBeUndefined(); // blank is the "required" rule's
  });
  it("adds up the cut test against its 1000 g sample", () => {
    expect(dryingGramsTotalProblem({ inputGoodKernelG: "600", inputShellG: "500" }, "input")).toMatch(/1100 g/);
    expect(dryingGramsTotalProblem({ inputGoodKernelG: "600", inputShellG: "400" }, "input")).toBeUndefined();
  });
  it("sends straight to production only from a Central warehouse", () => {
    expect(canSendDryingToProduction("CENTRAL")).toBe(true);
    expect(canSendDryingToProduction("UNIT")).toBe(false);
    expect(canSendDryingToProduction(null)).toBe(false);
  });
});

