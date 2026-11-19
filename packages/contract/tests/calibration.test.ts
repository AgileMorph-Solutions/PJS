import { describe, expect, it } from "vitest";
import {
  correctSizePct, largestOtherGrade, manualCalibrationError, nextCalibrationStep, samplingPointFromWord, siloChecks, siloDailyStock, siloFromWord, siloPool, silosWaiting, sizingCheckError, sizingCheckNotes, sizingGradePct,
} from "../src/domain/calibration.js";
import { cookRunError } from "../src/domain/cooking.js";
import { RCN_STAGES, rcnReceiptStages, rcnReceiptStatus } from "../src/domain/rcnReceipt.js";
import { pctOfNet } from "../src/domain/rcnWeighing.js";

// Decision, Nov 2026: only the silos' total is known. Intake and Calibration are one stage; a load is in the silos,
// net − dust − voids, the moment production accepts it (Lokesh, 16 Nov 2026: the warehouse weighs, "then operations
// will accept").
describe("Intake & Calibration is one stage", () => {
  const ok = [{ status: "approved" as const, decision: "ok" as const }];

  it("a weighed load waits for production; it is Calibrated once production accepts it, with nothing left to sort", () => {
    expect(rcnReceiptStatus(ok, { pallets: 1, finalised: false })).toBe("weighing");
    expect(rcnReceiptStatus(ok, { pallets: 1, finalised: true })).toBe("waiting_for_acceptance");
    expect(rcnReceiptStatus(ok, { pallets: 1, finalised: true, accepted: true })).toBe("calibrated");
    // Steps stay any-order: a final weight saved before the moisture check still waits for that check.
    expect(rcnReceiptStatus([], { pallets: 1, finalised: true })).toBe("waiting_for_moisture");
  });

  it("has no separate calibration step on a load: production's acceptance is the last one", () => {
    expect(RCN_STAGES.map((s) => s.id)).toEqual(["receipt", "moisture", "pallets", "final_weight", "acceptance"]);
    const weighed = rcnReceiptStages({ status: "waiting_for_acceptance", moistureChecks: ok, pallets: [1], finalWeight: {}, acceptance: null });
    expect(weighed.acceptance).toBe("current");
    const stages = rcnReceiptStages({ status: "calibrated", moistureChecks: ok, pallets: [1], finalWeight: {}, acceptance: {} });
    expect(Object.values(stages).every((s) => s === "done")).toBe(true);
  });
});

describe("QC-2 sizing check", () => {
  // 24. Wholes Manual Calibration, Sheet2, 28/08/2026, BIN-08B.
  const a2plus = { point: "App", sampleG: "1000", grams: { App: "727", Ap: "224", A: "49" } };

  it("correct size % is the silo's own grams over the sample, as the doc defines it", () => {
    expect(correctSizePct("App", "1000", a2plus.grams)).toBeCloseTo(72.7, 9);
    expect(correctSizePct("received", "1000", a2plus.grams)).toBeNull();
  });

  it("raises the doc's two alerts as notes, not refusals", () => {
    expect(sizingCheckError({ ...a2plus, date: "2026-08-28", decision: "ok" })).toBeNull();
    expect(sizingCheckNotes(a2plus)).toEqual(["Only 72.7 % is the silo's own size (target 85 %)."]);
    // One of the sheet's four rows whose parts don't add up (Error Check −15).
    expect(sizingCheckNotes({ point: "A", sampleG: "1000", grams: { A: "900", AB: "115" } })).toEqual(["The grams add up to 1,015 g, not the 1,000 g sample."]);
  });
});

describe("a silo's QC-2 standing", () => {
  const check = (over: object) => ({ id: 1, point: "A", status: "approved", decision: "ok", date: "2026-08-28", correctPct: 90, moves: 0, ...over });

  it("is flagged by a failed check, and asks for a new check once re-sized rather than reading as passed", () => {
    expect(siloChecks([]).A.state).toBe("not_checked");
    expect(siloChecks([check({ decision: "fail" })]).A.state).toBe("failed");
    expect(siloChecks([check({ decision: "fail", moves: 1 })]).A.state).toBe("re_sized");
    expect(siloChecks([check({ decision: "fail", moves: 1 }), check({ id: 2 })]).A).toMatchObject({ state: "ok", correctPct: 90 });
  });

  it("changes only on an approved check, and only for its own silo", () => {
    const standing = siloChecks([check({ decision: "fail", status: "submitted" }), check({ id: 2, status: "rejected" }), check({ id: 3, point: "received" })]);
    expect(standing.A.state).toBe("not_checked");
    expect(standing.B.state).toBe("not_checked");
  });
});

describe("the next job on screen", () => {
  const nothing = { checksWaiting: 0, failedSilos: 0, silosToCheck: 0 };
  const incharge = { canSize: true, canCheck: true };
  const qfs = { canSize: false, canCheck: true };

  it("goes approval, then failed silo, then the next check; there is no load to sort any more", () => {
    expect(nextCalibrationStep({ ...incharge, ...nothing, checksWaiting: 1, failedSilos: 1 })).toBe("check");
    expect(nextCalibrationStep({ ...incharge, ...nothing, failedSilos: 1, silosToCheck: 1 })).toBe("fix");
    expect(nextCalibrationStep({ ...incharge, ...nothing, silosToCheck: 1 })).toBe("check");
    expect(nextCalibrationStep({ ...incharge, ...nothing })).toBe("none");
  });

  it("never sends a QFS Officer to a job only the Incharge can do", () => {
    expect(nextCalibrationStep({ ...qfs, ...nothing, checksWaiting: 1, failedSilos: 1 })).toBe("none");
    expect(nextCalibrationStep({ ...qfs, ...nothing, silosToCheck: 1 })).toBe("check");
  });
});

describe("what Intake hands over", () => {
  it("reads dust and voids as a share of the net received: the doc's BTM 113", () => {
    expect(pctOfNet(1250, 137_831.9).toFixed(2)).toBe("0.91");
    expect(pctOfNet(8, 137_831.9).toFixed(3)).toBe("0.006");
    expect(pctOfNet(5, 0)).toBe(0);
  });

  it("gives each size its share of the sample, as the sheet's % columns", () => {
    expect(sizingGradePct("Ap", "1000", { Ap: "224" })).toBeCloseTo(22.4, 9);
    expect(sizingGradePct("under", "1000", {})).toBe(0);
    expect(sizingGradePct("A", "", { A: "5" })).toBeNull();
  });
});

describe("silo stock, as one total", () => {
  it("is calibrated in − cooked; cooking's kg per size count only as their total", () => {
    // BTM 1001's two receipts, 48,699.15 kg each into the silos (4. Calibration Process report).
    const pool = siloPool([{ kg: 48_699.15 }, { kg: 48_699.15 }], [{ sizes: { A: "20000", B: "5000.3" } }]);
    expect(pool).toEqual({ inKg: 97_398.3, cookedKg: 25_000.3, stockKg: 72_398 });
  });

  it("won't let a Lot cook more than the silos hold in total, whatever sizes it names", () => {
    expect(cookRunError({ date: "2026-08-28", code: "ANG26H01", sizes: { A: "600", B: "400" } }, 1000)).toBeNull();
    expect(cookRunError({ date: "2026-08-28", code: "ANG26H01", sizes: { A: "600", B: "400.01" } }, 1000)).toMatch(/has 1,000 kg in the silos/);
    expect(cookRunError({ date: "2026-08-28", code: "ANG26H01", sizes: { A: "-1" } }, 1000)).toMatch(/0 or more/);
  });

  it("records a move by hand as typed: no silo's own kg is known to hold it to", () => {
    expect(manualCalibrationError({ date: "2026-08-28", fromSize: "Ap", toSize: "A", kg: "601" })).toBeNull();
    expect(manualCalibrationError({ date: "2026-08-28", fromSize: "Ap", toSize: "Ap", kg: "1" })).toMatch(/different silo/);
    expect(manualCalibrationError({ date: "2026-08-28", fromSize: "Ap", toSize: "A", kg: "0" })).toMatch(/above 0/);
  });
});

describe("the silos that still need someone", () => {
  const check = (over: object) => ({ id: 1, point: "A", status: "approved", decision: "fail", date: "2026-08-28", correctPct: 20, moves: 0, ...over });

  it("asks to fix a failed silo, then to check it again once its nuts are moved; never a silo nobody sampled", () => {
    expect(silosWaiting(100, siloChecks([check({})]))).toEqual({ toCheck: [], failed: ["A"], moved: [] });
    expect(silosWaiting(100, siloChecks([check({ moves: 1 })]))).toEqual({ toCheck: ["A"], failed: [], moved: ["A"] });
  });

  it("asks nothing while the silos are empty: nothing can be sampled or moved, so the screen would be stuck", () => {
    expect(silosWaiting(0, siloChecks([check({})]))).toEqual({ toCheck: [], failed: [], moved: [] });
  });

  it("names the deciding check, so a silo failed from another batch can still be fixed", () => {
    expect(siloChecks([check({ id: 3, decision: "ok" }), check({ id: 7 })]).A.checkId).toBe(7);
    expect(siloChecks([]).A.checkId).toBeNull();
  });
});

describe("the silo stock report, day by day (report 5)", () => {
  // The client's own first rows: 17,957.2 on 23/04, then 30,733.05 and 33,665.7 on 24/04 → closing 82,355.95.
  const loads = [
    { date: "2026-04-24", kg: 30_733.05 },
    { date: "2026-04-23", kg: 17_957.2 },
    { date: "2026-04-24", kg: 33_665.7 },
  ];

  it("carries each day's closing into the next day's opening, as the client's report does", () => {
    const days = siloDailyStock(loads, []);
    expect(days.map((d) => [d.date, d.openingKg, d.inKg, d.closingKg])).toEqual([
      ["2026-04-23", 0, 17_957.2, 17_957.2],
      ["2026-04-24", 17_957.2, 64_398.75, 82_355.95],
    ]);
  });

  it("a move by hand shows on its day, on a day of its own if need be, and changes no total", () => {
    const days = siloDailyStock(loads, [{ date: "2026-04-25", kg: "500" }]);
    expect(days[2]).toEqual({ date: "2026-04-25", openingKg: 82_355.95, inKg: 0, cookedKg: 0, movedKg: 500, closingKg: 82_355.95 });
  });

  it("always closes on the same total as the silo stock", () => {
    const cooks = [{ date: "2026-04-25", sizes: { A: "1000.5" } }];
    const days = siloDailyStock(loads, [{ date: "2026-04-24", kg: "12.5" }], cooks);
    expect(days.at(-1)!.closingKg).toBeCloseTo(siloPool(loads, cooks).stockKg, 2);
  });
});

describe("where a failed silo's nuts probably belong", () => {
  it("is the largest other size in the sample: the client's silo A+ of 28/08 is mostly A", () => {
    expect(largestOtherGrade("Ap", { Ap: "162", A: "792", AB: "46" })).toBe("A");
    expect(largestOtherGrade("A", { A: "1000" })).toBeNull();
  });
});

describe("a silo as a workbook writes it", () => {
  it("reads the report's words and the QC-2 sheet's", () => {
    expect([siloFromWord("A++"), siloFromWord(" a+ "), siloFromWord("DE"), siloFromWord("E"), siloFromWord("Z")]).toEqual(["App", "Ap", "E", "E", null]);
    expect([samplingPointFromWord("Received RCN"), samplingPointFromWord("Before Calibration"), samplingPointFromWord("AB"), samplingPointFromWord("")]).toEqual(["received", "received", "AB", null]);
  });
});
