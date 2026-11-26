/**
 * A production run's Bins show their moisture and KOR instead of their trucks (26 Nov 2026, user). Each Lot's latest reading,
 * averaged by its kg over the Bin.
 */
import { describe, it, expect } from "vitest";
import { binQuality, lotReading, warehouseBinStock, type DryingRoundFacts } from "../src/domain/productionBatch";

const qfs = (v: Record<string, string>) => ({ stageData: { "n-qfs": v } });

describe("a Lot's latest reading", () => {
  it("is the final reading after unloading, else the truck sample's; none when nothing was measured", () => {
    expect(lotReading(qfs({ "Sample moisture (%)": "11", KOR: "46", "Final moisture (%)": "9.4", "FINAL KOR": "47.1" }))).toEqual({ moisture: 9.4, kor: 47.1 });
    expect(lotReading(qfs({ "Sample moisture (%)": "11", KOR: "46" }))).toEqual({ moisture: 11, kor: 46 });
    expect(lotReading(qfs({ "Sample moisture (%)": "10,5" }))).toEqual({ moisture: 10.5 });
    expect(lotReading({ stageData: {} })).toEqual({});
  });

  it("is what drying made it, for dried RCN: the last round's check, else the imported drying's moisture after", () => {
    const rounds: DryingRoundFacts[] = [
      { sn: 1, status: "RE-DRY", source: "entered", receivedNetWeightKg: 900, destinationBinNo: "B-1", outputMoisturePct: 11, outputKor: 45 },
      { sn: 2, status: "PASSED", source: "entered", receivedNetWeightKg: 880, destinationBinNo: "B-1", outputMoisturePct: 8.2, outputKor: 46.5 },
    ];
    const r = qfs({ "Final moisture (%)": "12", "FINAL KOR": "45.9" });
    expect(lotReading(r, rounds, true)).toEqual({ moisture: 8.2, kor: 46.5 });
    // Not dried: the drying rounds don't apply.
    expect(lotReading(r, rounds, false)).toEqual({ moisture: 12, kor: 45.9 });
    // Imported drying: its own moisture after; KOR isn't measured again there, so the reception's stays.
    expect(lotReading({ stageData: { ...r.stageData, "n-drying": { "Moisture % — after drying": "8.9" } } }, [], true)).toEqual({ moisture: 8.9, kor: 45.9 });
  });
});

describe("a Bin's quality", () => {
  it("averages its Lots by kg, with the spread and how many were measured", () => {
    const q = binQuality([{ kg: 30000, moisture: 8, kor: 46 }, { kg: 10000, moisture: 12, kor: 42 }, { kg: 5000 }]);
    expect(q).toEqual({ moisture: 9, kor: 45, moistureRange: [8, 12], korRange: [42, 46], measured: 2, lots: 3 });
  });

  it("falls back to a plain average when a measured Lot has no kg, and says nothing when none is measured", () => {
    expect(binQuality([{ kg: 30000, moisture: 8 }, { moisture: 12 }]).moisture).toBe(10);
    expect(binQuality([{ kg: 100 }, {}])).toMatchObject({ moisture: null, kor: null, moistureRange: null, measured: 0, lots: 2 });
  });

  it("is carried by the Bin's Lots from procurement", () => {
    const truck = {
      id: "REC-1", source: "entered" as const, arrivalDate: "2026-11-01", supplierName: "S", lbaCode: "L", vehicleNo: "V", warehouse: "W", lotNo: "LOT-1",
      stageData: {
        "n-qfs": { "Final moisture (%)": "9", "FINAL KOR": "47" }, "n-bin": { "Bin Number": "BIN-1" },
        "n-grn": { "GRN Weight (kept separate from Gross/Net/Paid)": "40000", PRICE: "470" },
      },
      branches: { "n-qfs": "pass" }, timeline: [],
    };
    const lot = warehouseBinStock([truck]).get("BIN-1")!.lots[0]!;
    expect(lot).toMatchObject({ kg: 40000, moisture: 9, kor: 47 });
  });
});
