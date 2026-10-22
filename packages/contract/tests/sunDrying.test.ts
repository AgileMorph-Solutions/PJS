import { describe, it, expect } from "vitest";
import { DRYING_STATUS, dryingKor, dryingPhase, dryingQualityProblem, isOpenRound, type DryingQuality } from "../src/domain/sunDrying";

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
