/** Phase 5 against the client's "12. Shelled Kernels Quality Report" and the document's worked example. */
import { describe, expect, it } from "vitest";
import { storeBalance } from "../src/domain/byProducts.js";
import { isColourSorted, nextColourSortStep, sortChecks, sorterComparison, sorterFigures, sorterStreamKg } from "../src/domain/colourSort.js";
import { canColourSort, canShell, lotStatus } from "../src/domain/cooking.js";
import { ENTRY_DEFS, entryError, entryNotes } from "../src/domain/lotEntries.js";

describe("QC-7's figures", () => {
  it("reproduce the sheet's first row, ANG26E01 before the sorter, on every % column", () => {
    const f = sorterFigures({ sampleG: "1000", wholesG: "819", brokensG: "13", buttsG: "0", knifeMarkG: "119", rejectionG: "2", oilDirtG: "2", edgeCutG: "0", shellG: "45" });
    expect(f.rejectionPct).toBeCloseTo(0.4, 6);
    expect(f.brokensPct).toBeCloseTo(1.3, 6);
    expect(f.shellPct).toBeCloseTo(4.5, 6);
    expect(f.knifeMarkPct).toBeCloseTo(11.9, 6);
    expect(f.wholesPct).toBeCloseTo(93.8, 6);
    expect(f.errorG).toBe(0);
  });

  it("reproduce the doc's 21/07 (BC to E): wholes 83.9 → 95.2 %, rejection 10.4 → 1.8 %", () => {
    const before = sorterFigures({ sampleG: "1000", wholesG: "796", brokensG: "30", buttsG: "18", knifeMarkG: "43", rejectionG: "80", oilDirtG: "24", shellG: "9" });
    const after = sorterFigures({ sampleG: "1000", wholesG: "916", brokensG: "20", buttsG: "10", knifeMarkG: "36", rejectionG: "12", oilDirtG: "6" });
    expect([before.wholesPct.toFixed(1), before.rejectionPct.toFixed(1), before.brokensPct.toFixed(1), before.knifeMarkPct.toFixed(1)]).toEqual(["83.9", "10.4", "4.8", "4.3"]);
    expect([after.wholesPct.toFixed(1), after.rejectionPct.toFixed(1), after.brokensPct.toFixed(1), after.knifeMarkPct.toFixed(1)]).toEqual(["95.2", "1.8", "3.0", "3.6"]);
    expect(before.errorG).toBe(0);
  });

  it("notes, never refuses, parts that don't add up to the sample", () => {
    expect(entryNotes("qc7_before", { sampleG: "1000", wholesG: "990" }, {})).toEqual(["The parts add up to 990 g, not the 1,000 g sample."]);
    expect(entryError("qc7_before", { date: "2026-07-21", values: { stream: "Wholes", sampleG: "1000", wholesG: "990" } })).toBeNull();
  });

  it("only the sample after the sorter asks for OK or No", () => {
    expect(ENTRY_DEFS.qc7_before.decision).toBeUndefined();
    expect(entryError("qc7_after", { date: "2026-07-21", values: { stream: "Wholes", sampleG: "1000" } })).toMatch(/Choose OK or No · sort again/);
    expect(entryError("qc7_after", { date: "2026-07-21", values: { stream: "Kernels", sampleG: "1000" }, decision: "ok" })).toMatch(/Stream must be one of Wholes, Pieces, Rejection \+ oil/);
  });
});

describe("a stream's standing and the Lot's status", () => {
  const check = (id: number, stream: string, decision: string, status = "approved") => ({ id, status, decision, values: { stream } });

  it("splits the day record into the sorter's streams, as the doc's 21/07: rejection + oil 621.7 kg", () => {
    const kg = sorterStreamKg([{ kg: { wholesKg: "36987.7", piecesKg: "1139.2", rejectionKg: "428.9", oilKg: "192.8", blackRejectionKg: "780.6" } }]);
    expect(kg).toEqual({ Wholes: 36_987.7, Pieces: 1139.2, "Rejection + oil": 621.7 });
  });

  it("holds a stream on No until a newer check passes it; the Lot is sorted when every stream with kg is", () => {
    expect(sortChecks(["Wholes"], [check(1, "Wholes", "no")]).Wholes).toBe("resort");
    expect(sortChecks(["Wholes"], [check(1, "Wholes", "no"), check(2, "Wholes", "ok", "submitted")]).Wholes).toBe("waiting");
    const checks = sortChecks(["Wholes", "Pieces"], [check(1, "Wholes", "no"), check(2, "Wholes", "ok"), check(3, "Pieces", "ok")]);
    expect(isColourSorted(["Wholes", "Pieces"], checks)).toBe(true);
    expect(isColourSorted(["Wholes", "Pieces", "Rejection + oil"], checks)).toBe(false);
    expect(isColourSorted([], {})).toBe(false);
  });

  it("Colour sorted comes after Shelled, and a sorted Lot still takes shelling records", () => {
    expect(lotStatus({ inCooling: true, cooling: "ok", shellingDays: 1, colourSorted: true })).toBe("colour_sorted");
    expect(lotStatus({ inCooling: true, cooling: "ok", shellingDays: 0, colourSorted: true })).toBe("ready");
    expect([canShell("colour_sorted"), canColourSort("shelled"), canColourSort("ready")]).toEqual([true, true, false]);
  });

  it("points the QFS Officer at the before sample, then each stream; nobody else is sent", () => {
    const base = { canCheck: true, beforeSamples: 0, streams: ["Wholes", "Pieces"] as ("Wholes" | "Pieces")[], checks: { Wholes: "not_checked" as const, Pieces: "not_checked" as const } };
    expect(nextColourSortStep(base)).toBe("before");
    expect(nextColourSortStep({ ...base, beforeSamples: 1 })).toBe("after");
    expect(nextColourSortStep({ ...base, beforeSamples: 1, checks: { Wholes: "ok", Pieces: "resort" } })).toBe("after");
    expect(nextColourSortStep({ ...base, beforeSamples: 1, checks: { Wholes: "ok", Pieces: "ok" } })).toBe("none");
    expect(nextColourSortStep({ ...base, canCheck: false })).toBe("none");
  });
});

describe("before and after, compared", () => {
  it("pairs each stream and size group's newest approved sample on either side", () => {
    const s = (id: number, kind: string, stream: string, sizes: string, wholesG: string, status = "approved") => ({ id, kind, status, values: { stream, sizes, sampleG: "1000", wholesG } });
    const rows = sorterComparison([
      s(1, "qc7_before", "Wholes", "BC to E", "839"),
      s(2, "qc7_after", "Wholes", "BC to E", "900"),
      s(3, "qc7_after", "Wholes", "BC to E", "952"),
      s(4, "qc7_after", "Pieces", "", "700", "submitted"),
      s(5, "qc7_before", "Wholes", "A++ to B", "880"),
      // The Lot's other records come in the same list, and must not make a row of their own.
      { id: 6, kind: "qc3", status: "approved", values: { size: "A" } },
      { id: 7, kind: "cooker_log", status: "approved", values: { size: "A" } },
    ]);
    expect(rows.map((r) => [r.stream, r.sizes, r.before?.wholesPct, r.after?.wholesPct])).toEqual([
      ["Wholes", "A++ to B", 100, undefined],
      ["Wholes", "BC to E", 100, 100],
    ]);
  });
});

describe("black rejection", () => {
  it("is a store of its own: produced by shelling, gone by sale", () => {
    expect(storeBalance("black_rejection", 780.6, 500)).toMatchObject({ stockKg: 280.6 });
  });
});
