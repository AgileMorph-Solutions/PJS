import { describe, expect, it } from "vitest";
import {
  calibrationProgress, calibrationRunError, correctSizePct, manualCalibrationError, nextCalibrationStep, siloChecks, siloStock, sizingCheckError, sizingCheckNotes, sizingGradePct,
} from "../src/domain/calibration.js";
import { rcnReceiptStatus } from "../src/domain/rcnReceipt.js";
import { pctOfNet } from "../src/domain/rcnWeighing.js";

describe("calibration runs", () => {
  it("adds up a load sized over two days, as the client's Calibration Process report does for BTM 1001", () => {
    // 48,699.15 kg into silos, sized as 17,966.1 then 30,733.05 (4. Calibration Process report, 23–24/04/2026).
    const runs = [{ sizes: { A: "17966.1" } }, { sizes: { A: "30733.05" } }];
    expect(calibrationProgress(48_699.15, runs)).toEqual({ toSilosKg: 48_699.15, sizedKg: 48_699.15, leftKg: 0 });
  });

  it("refuses a run larger than what is left, and one with nothing in it", () => {
    expect(calibrationRunError({ date: "2026-04-24", sizes: { A: "30733.06" } }, 30_733.05)).toMatch(/more than the 30,733.05 kg/);
    expect(calibrationRunError({ date: "2026-04-24", sizes: { A: "30733.05" } }, 30_733.05)).toBeNull();
    expect(calibrationRunError({ date: "2026-04-24", sizes: { A: "0" } }, 100)).toMatch(/at least one silo/);
  });
});

describe("the receipt's status carries on past Intake", () => {
  const ok = [{ status: "approved" as const, decision: "ok" as const }];
  it("is Intake done, then Calibration in progress, then Calibrated", () => {
    expect(rcnReceiptStatus(ok, { pallets: 1, finalised: true, calibration: { sizedKg: 0, leftKg: 10 } })).toBe("intake_done");
    expect(rcnReceiptStatus(ok, { pallets: 1, finalised: true, calibration: { sizedKg: 4, leftKg: 6 } })).toBe("calibrating");
    expect(rcnReceiptStatus(ok, { pallets: 1, finalised: true, calibration: { sizedKg: 10, leftKg: 0 } })).toBe("calibrated");
    // Phase 1 callers that know nothing of calibration see what they always did.
    expect(rcnReceiptStatus(ok, { pallets: 1, finalised: true })).toBe("intake_done");
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
  const nothing = { loadsToSort: 0, checksWaiting: 0, failedSilos: 0, silosToCheck: 0 };
  const incharge = { canSize: true, canCheck: true };
  const qfs = { canSize: false, canCheck: true };

  it("goes load, then approval, then failed silo, then the next check", () => {
    expect(nextCalibrationStep({ ...incharge, ...nothing, loadsToSort: 1, failedSilos: 1 })).toBe("sort");
    expect(nextCalibrationStep({ ...incharge, ...nothing, checksWaiting: 1, failedSilos: 1 })).toBe("check");
    expect(nextCalibrationStep({ ...incharge, ...nothing, failedSilos: 1, silosToCheck: 1 })).toBe("fix");
    expect(nextCalibrationStep({ ...incharge, ...nothing, silosToCheck: 1 })).toBe("check");
    expect(nextCalibrationStep({ ...incharge, ...nothing })).toBe("none");
  });

  it("never sends a QFS Officer to a job only the Incharge can do", () => {
    expect(nextCalibrationStep({ ...qfs, ...nothing, loadsToSort: 1, checksWaiting: 1, failedSilos: 1 })).toBe("none");
    expect(nextCalibrationStep({ ...qfs, ...nothing, loadsToSort: 1, silosToCheck: 1 })).toBe("check");
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

describe("silo stock", () => {
  it("is sized in ± moved by hand; a move changes no total", () => {
    const stock = siloStock([{ sizes: { Ap: "600", A: "100" } }], [{ fromSize: "Ap", toSize: "A", kg: "500" }]);
    expect(stock.find((s) => s.size === "Ap")!.stockKg).toBe(100);
    expect(stock.find((s) => s.size === "A")!.stockKg).toBe(600);
    expect(stock.reduce((n, s) => n + s.stockKg, 0)).toBe(700);
  });

  it("won't move more than the silo holds, or into the same silo", () => {
    expect(manualCalibrationError({ date: "2026-08-28", fromSize: "Ap", toSize: "A", kg: "601" }, 600)).toMatch(/holds 600 kg/);
    expect(manualCalibrationError({ date: "2026-08-28", fromSize: "Ap", toSize: "Ap", kg: "1" }, 600)).toMatch(/different silo/);
  });
});
