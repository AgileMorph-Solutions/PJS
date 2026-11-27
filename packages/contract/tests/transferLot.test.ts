import { describe, expect, it } from "vitest";
import {
  binDrawProblem, suggestedScaleWeightKg, lotBinsProblems, lotLeft, lotNetKg, lotNoProblem, lotPieceProblem, lotWeighingProblems, normalizeLotNo, pieceNetKg, pieceWeightProblem,
  lotRemainingKg, putBackProblems, putBackShareKg, shareByBags, transferLotStatus, transferNumberProblem,
} from "../src/domain/transferLot";
import { dispatchWeightProblem, transferState } from "../src/domain/transfers";
import { dispatchedNotes, fieldApplies, hiddenOnRecord, sentVsReceived, stageDifferences, typedOnRecord } from "../src/domain/transferReception";
import { stageGate } from "../src/domain/phaseGate";
import { binLotMovements } from "../src/domain/productionBatch";
import { isGrnComplete } from "../src/domain/recordLock";

const isHard = (p: { soft: boolean } | undefined) => p !== undefined && !p.soft;
const isSoft = (p: { soft: boolean } | undefined) => p !== undefined && p.soft;

describe("transfer numbers: broken values are refused, unusual ones warn", () => {
  it("refuses letters, negatives and part of a bag", () => {
    expect(isHard(transferNumberProblem("bags", "abc"))).toBe(true);
    expect(transferNumberProblem("bags", "-5")).toEqual({ message: "Can't be negative.", soft: false });
    expect(transferNumberProblem("lotWeightKg", "-1")?.message).toBe("Can't be negative.");
    expect(isHard(transferNumberProblem("bags", "12.5"))).toBe(true);
    expect(isHard(transferNumberProblem("bags", "0"))).toBe(true);
    expect(isHard(transferNumberProblem("nutCount", "180.5"))).toBe(true);
    expect(isHard(transferNumberProblem("moisture", "120"))).toBe(true);
    expect(isHard(transferNumberProblem("kor", "95"))).toBe(true);
  });
  it("takes the French decimal comma and plain numbers", () => {
    expect(transferNumberProblem("kor", "44,94")).toBeUndefined();
    expect(transferNumberProblem("lotWeightKg", "41000")).toBeUndefined();
  });
  it("a count of 0 bags at arrival is real (everything missing): it saves, with a warning that it is unusual", () => {
    expect(isSoft(transferNumberProblem("bagsCounted", "0"))).toBe(true);
  });
  it("blank is fine unless required", () => {
    expect(transferNumberProblem("damagedBags", "")).toBeUndefined();
    expect(transferNumberProblem("bags", " ", true)).toEqual({ message: "Required.", soft: false });
  });
  it("warns outside the usual truck load (Bouaké dispatch / Yakro receiving), but still lets it save", () => {
    expect(isSoft(transferNumberProblem("truckWeightKg", "65000"))).toBe(true);
  });
});

describe("Lot numbers", () => {
  it("are stored in capitals and allow the client's own forms", () => {
    expect(normalizeLotNo(" lot-bke-2026-0007 ")).toBe("LOT-BKE-2026-0007");
    expect(lotNoProblem("LOT-BKE-2026-0007")).toBeUndefined();
    expect(lotNoProblem("3")).toBeUndefined();
  });
  it("refuses a blank, spaces or symbols", () => {
    expect(isHard(lotNoProblem(""))).toBe(true);
    expect(isHard(lotNoProblem("LOT 7"))).toBe(true);
    expect(isHard(lotNoProblem("LOT#7"))).toBe(true);
    expect(isHard(lotNoProblem("-7"))).toBe(true);
  });
});

describe("weights shared by bags", () => {
  it("net is the scale's weight less 1 kg a bag", () => {
    expect(lotNetKg(41500, 500)).toBe(41000);
    expect(lotNetKg(null, 500)).toBeNull();
  });
  it("shares always add up to the whole, the last taking the rounding", () => {
    const shares = shareByBags(1000, [1, 1, 1]);
    expect(shares).toEqual([333.33, 333.33, 333.34]);
    expect(shares.reduce((a, b) => a! + b!, 0)).toBeCloseTo(1000, 9);
    expect(shareByBags(41000, [300, 200])).toEqual([24600, 16400]);
    expect(shareByBags(null, [3, 2])).toEqual([null, null]);
  });
  it("a piece on a truck is its share of the lot by bags", () => {
    expect(pieceNetKg(41000, 500, 430)).toBe(35260);
    expect(lotLeft(500, 41000, [{ bags: 430 }])).toEqual({ leftBags: 70, leftKg: 5740 });
  });
});

describe("where a lot stands", () => {
  it("waits for its weight, then is loaded piece by piece", () => {
    expect(transferLotStatus(false, 500, 0)).toBe("waiting_weight");
    expect(transferLotStatus(true, 500, 0)).toBe("ready");
    expect(transferLotStatus(true, 70, 1)).toBe("part_loaded");
    expect(transferLotStatus(true, 0, 2)).toBe("loaded");
  });
  it("a piece's weight starts from the lot's weighing and may be changed: warned when far off, refused when it can't be right", () => {
    expect(pieceWeightProblem("4000", 4000)).toBeUndefined();
    expect(pieceWeightProblem("4150", 4000)).toBeUndefined();
    expect(isSoft(pieceWeightProblem("4500", 4000))).toBe(true);
    expect(isHard(pieceWeightProblem("-4000", 4000))).toBe(true);
    expect(isHard(pieceWeightProblem("0", 4000))).toBe(true);
    expect(isHard(pieceWeightProblem("heavy", 4000))).toBe(true);
    expect(isHard(pieceWeightProblem("", 4000))).toBe(true);
  });
  it("can't put more of it on a truck than is left", () => {
    expect(lotPieceProblem("70", 70)).toBeUndefined();
    expect(lotPieceProblem("71", 70)?.message).toBe("Only 70 bags of this lot are left to load.");
    expect(isHard(lotPieceProblem("71", 70))).toBe(true);
    expect(isHard(lotPieceProblem("5", 0))).toBe(true);
    expect(isHard(lotPieceProblem("", 70))).toBe(true);
  });
});

describe("making a lot from Bins", () => {
  const ok = { lotNo: "LOT-BKE-2026-0007", lotDate: "2026-11-24", bins: [{ binCode: "BIN-12", bags: "300" }, { binCode: "BIN-16", bags: "200" }] };
  it("passes a lot taken from two Bins", () => {
    expect(lotBinsProblems(ok)).toEqual({});
  });
  it("needs a Bin, bags for each, and one line per Bin", () => {
    expect(lotBinsProblems({ ...ok, bins: [] }).bins?.soft).toBe(false);
    const p = lotBinsProblems({ ...ok, bins: [{ binCode: "bin-12", bags: "3.5" }, { binCode: "BIN-12", bags: "-1" }, { binCode: "", bags: "10" }] });
    expect(Object.keys(p).sort()).toEqual(["bags.0", "bags.1", "bin.1", "bin.2"]);
  });
  it("warns, never refuses, when a Bin shows less than is taken", () => {
    expect(isSoft(binDrawProblem(20000, 24600))).toBe(true);
    expect(binDrawProblem(30000, 24600)).toBeUndefined();
    expect(binDrawProblem(0, null)).toBeUndefined();
  });
});

describe("weighing a lot", () => {
  const ok = { grossWeightKg: "41500", moisture: "9,5", kor: "46", nutCount: "180" };
  it("passes a normal weighing", () => {
    expect(lotWeighingProblems(ok, 500)).toEqual({});
  });
  it("needs every value, written as numbers", () => {
    const p = lotWeighingProblems({ grossWeightKg: "", moisture: "wet", kor: "", nutCount: "-3" }, 500);
    expect(Object.values(p).every((x) => !x.soft)).toBe(true);
    expect(Object.keys(p).sort()).toEqual(["grossWeightKg", "kor", "moisture", "nutCount"]);
  });
  it("refuses only a weight no more than the empty bags; any other saves with no warning, and a weight is suggested", () => {
    expect(lotWeighingProblems({ ...ok, grossWeightKg: "400" }, 500).grossWeightKg).toEqual({ message: "Must be more than 500 kg: the empty bags alone weigh that.", soft: false });
    expect(lotWeighingProblems({ ...ok, grossWeightKg: "25500" }, 500).grossWeightKg).toBeUndefined();
    expect(lotWeighingProblems({ ...ok, grossWeightKg: "200" }, 50).grossWeightKg).toBeUndefined();
    expect(suggestedScaleWeightKg(50)).toBe(4050);
  });
});

describe("the loaded weight at dispatch", () => {
  const lots = [{ bags: 25, netWeightKg: 2000 }];
  it("says plainly what the lots come to and how far off the scale is", () => {
    expect(dispatchWeightProblem(3000, lots)).toBe("The lots on this truck come to 2,025 kg (2,000 kg net + 25 kg of bags). 3,000 kg is 975 kg more. Please check the weight.");
    expect(dispatchWeightProblem(2025, lots)).toBeNull();
    expect(dispatchWeightProblem(2100, lots)).toBeNull();
  });
});

describe("a truck from the Unit warehouse goes through the same reception, without the supplier", () => {
  const transfer = {
    transferId: "BKT-2026-001", lineId: 1, fromWarehouse: "BOUAKE", sentAs: "LOT-BKE-2026-0007", truckNo: "399BH01", transporter: "ELS", driver: "Daniel", driverPhone: "1",
    dispatchedAt: null, sent: { bags: 50, netKg: 4000, moisture: 10, kor: 47.8, nutCount: 200 },
  };
  it("leaves out only the supplier's and the payment's fields", () => {
    expect(fieldApplies({ transfer }, "n-verify", "SUPPLIERS NAME")).toBe(false);
    expect(fieldApplies({ transfer }, "n-grn", "PRICE")).toBe(false);
    expect(fieldApplies({ transfer }, "n-verify", "FICHE")).toBe(true);
    expect(fieldApplies({}, "n-grn", "PRICE")).toBe(true);
    expect(hiddenOnRecord({ transfer }, "n-gate")).toEqual(["CREDIT/CASH"]);
    // Refraction is deducted from what a supplier is paid: a truck from the Unit warehouse has none.
    expect(fieldApplies({ transfer }, "n-unload", "Refraction")).toBe(false);
    expect(fieldApplies({}, "n-unload", "Refraction")).toBe(true);
    expect(hiddenOnRecord({ transfer }, "n-unload")).toContain("Refraction");
  });
  it("opens Weight without a supplier, and completes its GRN without a price", () => {
    const stageData = {
      "n-gate": { "DATE OF ARRIVAL": "2026-11-24", "WH LOCATION": "YAKRO FACTORY", "VEHICLE NO.": "399BH01" },
      "n-verify": { "FICHE CODE": "72533", FICHE: "72533", ORIGIN: "MANKONO" },
    };
    expect(stageGate({ stageData, branches: {}, transfer }, "n-gross").open).toBe(true);
    expect(stageGate({ stageData, branches: {} }, "n-gross").open).toBe(false);
    expect(isGrnComplete({ "n-grn": { "GRN Weight (kept separate from Gross/Net/Paid)": "4000" } }, false)).toBe(true);
    expect(isGrnComplete({ "n-grn": { "GRN Weight (kept separate from Gross/Net/Paid)": "4000" } })).toBe(false);
  });
  it("compares what arrived with what was sent", () => {
    const rows = sentVsReceived({ transfer, stageData: { "n-unload": { "SACS (bags)": "48" }, "n-netwt": { "NET WT KGS": "3880" }, "n-qfs": { "Final moisture (%)": "9.5", "FINAL KOR": "47.5", "Final nut count": "230" } } });
    expect(rows.map((r) => [r.label, r.diff, r.off])).toEqual([["Bags", -2, true], ["Net weight", -120, true], ["Moisture", -0.5, false], ["KOR", -0.3, false], ["Nut count", 30, true]]);
  });
  it("asks one set of readings, KOR typed, and the transfer-only fields only of such a truck", () => {
    expect(fieldApplies({ transfer }, "n-qfs", "Final moisture (%)")).toBe(false);
    expect(fieldApplies({ transfer }, "n-qfs", "Sample – Good Kernel (g)")).toBe(false);
    expect(typedOnRecord({ transfer }, "n-qfs", "KOR")).toBe(true);
    expect(typedOnRecord({}, "n-qfs", "KOR")).toBe(false);
    expect(fieldApplies({ transfer }, "n-gate", "Laisse-Passer Entree (Yakro)")).toBe(true);
    expect(fieldApplies({}, "n-gate", "Laisse-Passer Entree (Yakro)")).toBe(false);
    const stageData = { "n-gate": { "DATE OF ARRIVAL": "2026-11-24", "WH LOCATION": "Y", "VEHICLE NO.": "1" }, "n-verify": { "FICHE CODE": "1", FICHE: "1", ORIGIN: "M" }, "n-gross": { "GROSS WT KGS": "4050" },
      "n-qfs": { "Sample moisture (%)": "9.5", "Sample nut count": "184", KOR: "47.5" } };
    expect(stageGate({ stageData, branches: {}, transfer }, "n-unload").message).toMatch(/pass Quality/);
    expect(stageGate({ stageData, branches: { "n-qfs": "pass" }, transfer }, "n-unload").open).toBe(true);
  });
  it("shows what was dispatched under each received reading, and the differences in their step", () => {
    expect(dispatchedNotes(transfer, "n-qfs")).toEqual({ "Sample moisture (%)": "Dispatched from BOUAKE: 10 %", "Sample nut count": "Dispatched from BOUAKE: 200 nuts/kg", KOR: "Dispatched from BOUAKE: 47.8 lbs" });
    expect(stageDifferences({ transfer, stageData: { "n-unload": { "SACS (bags)": "48" } } }, "n-unload").map((r) => r.diff)).toEqual([-2]);
  });
  it("reads as being received until every lot's reception is done", () => {
    expect(transferState({ status: "dispatched", receiving: true, lines: [], dispatchedGrossKg: null, bagsReceived: null, receivedGrossKg: null })).toBe("receiving");
  });
});

describe("the truck and its driver, written one way", () => {
  it("stores a truck number in one form", async () => {
    const { normalizeTruckNo } = await import("../src/domain/transfers");
    expect(normalizeTruckNo(" 7957 gn-01 / 3599kv01 ")).toBe("7957GN01/3599KV01");
    expect(normalizeTruckNo("1796GC01/3922BB04")).toBe("1796GC01/3922BB04");
    expect(normalizeTruckNo("399bh01")).toBe("399BH01");
  });
  it("refuses a phone with letters or another number of digits than 10", async () => {
    const { driverPhoneProblem, normalizePhone, sameDriver } = await import("../src/domain/transfers");
    expect(driverPhoneProblem("07 15 34 70 75")).toBeUndefined();
    expect(driverPhoneProblem("+225 0715347075")).toBeUndefined();
    expect(driverPhoneProblem("715347075")).toEqual({ message: "9 digits: a phone number has 10 (e.g. 0715347075).", soft: false });
    expect(driverPhoneProblem("07153470751")?.soft).toBe(false);
    expect(driverPhoneProblem("07ab")).toEqual({ message: "Numbers only.", soft: false });
    expect(normalizePhone("07-15 34.70 75")).toBe("0715347075");
    expect(sameDriver({ driver: "traore  bakary", driverPhone: "07 15 34 70 75" }, { driver: "TRAORE BAKARY", driverPhone: "0715347075" })).toBe(true);
  });
  it("offers the loaded weight the lots come to", async () => {
    const { expectedLoadedKg } = await import("../src/domain/transfers");
    expect(expectedLoadedKg([{ bags: 25, netWeightKg: 2000 }, { bags: 10, netWeightKg: 820 }])).toBe(2855);
    expect(expectedLoadedKg([{ bags: null, netWeightKg: 2000 }])).toBeNull();
  });
});

// 26 Nov 2026 (user): half a lot went on the truck and the rest stays — the bags not on a truck can be put back in a Bin.
describe("putting a lot's bags back in a Bin", () => {
  const today = "2026-11-26";
  // A lot of 100 bags weighed at 8,000 kg net: 20 bags are 1,600 kg by its weighing.
  const ok = { binCode: "BKE-001-BIN-008", bags: "20", date: today, netKg: "1600" };
  const lot = (leftBags: number, weighed = true) => ({ weighed, leftBags, netKg: weighed ? 8000 : null, bags: 100 });
  it("takes only bags not on a truck, of a weighed lot, into a chosen Bin, on a day not in the future", () => {
    expect(putBackProblems(ok, lot(20), today)).toEqual({});
    expect(putBackProblems({ ...ok, bags: "21" }, lot(20), today).bags?.message).toMatch(/Only 20 bags of this lot aren't on a truck/);
    expect(putBackProblems(ok, lot(0), today).bags?.message).toMatch(/Every bag of this lot is on a truck or already put back/);
    expect(putBackProblems({ ...ok, bags: "2.5" }, lot(20), today).bags).toBeDefined();
    expect(putBackProblems({ ...ok, binCode: " " }, lot(20), today).binCode).toBeDefined();
    expect(putBackProblems({ ...ok, date: "2026-11-27" }, lot(20), today).date?.message).toMatch(/future/);
    // Not weighed: its Bins haven't lost any kg yet, so nothing is given back — the lot is changed or deleted instead.
    expect(putBackProblems(ok, lot(100, false), today).bags?.message).toMatch(/Weigh the lot first/);
  });

  // 26 Nov 2026 (user): the weight put back is weighed and typed; it is what the Bin gets back.
  it("needs the weight put back: a positive number; far from the bags' share only warns", () => {
    expect(putBackProblems({ ...ok, netKg: "" }, lot(20), today).netKg).toEqual({ message: "Required.", soft: false });
    expect(isHard(putBackProblems({ ...ok, netKg: "abc" }, lot(20), today).netKg)).toBe(true);
    expect(isHard(putBackProblems({ ...ok, netKg: "0" }, lot(20), today).netKg)).toBe(true);
    expect(isHard(putBackProblems({ ...ok, netKg: "-5" }, lot(20), today).netKg)).toBe(true);
    expect(putBackProblems({ ...ok, netKg: "1650" }, lot(20), today).netKg).toBeUndefined(); // within 5 % of 1,600
    expect(putBackProblems({ ...ok, netKg: "1600,5" }, lot(20), today).netKg).toBeUndefined(); // the decimal comma
    const far = putBackProblems({ ...ok, netKg: "2000" }, lot(20), today).netKg;
    expect(isSoft(far)).toBe(true);
    expect(far!.message).toMatch(/1,600 kg/);
    expect(putBackShareKg({ netKg: 8000, bags: 100 }, "20")).toBe(1600);
  });

  // 26 Nov 2026 (user): a lot of 10 bags, 800 kg net; 5 bags (400 kg) went on a truck. Its 5 bags left can go back, and at
  // most the 400 kg left of it: more would give the Bin stock that never existed.
  it("never takes more bags, nor more weight, than is left of the lot", () => {
    const tenBags = { weighed: true, leftBags: 5, netKg: 800, bags: 10, pieces: [{ netKg: 400 }], returns: [] };
    const draft = { binCode: "BKE-001-BIN-008", bags: "5", date: today, netKg: "400" };
    expect(lotRemainingKg(tenBags)).toBe(400);
    expect(putBackProblems(draft, tenBags, today)).toEqual({});
    expect(putBackProblems({ ...draft, bags: "6" }, tenBags, today).bags?.message).toMatch(/Only 5 bags of this lot aren't on a truck/);
    const tooHeavy = putBackProblems({ ...draft, netKg: "401" }, tenBags, today).netKg;
    expect(isHard(tooHeavy)).toBe(true);
    expect(tooHeavy!.message).toMatch(/Only 400 kg of this lot isn't on a truck or put back already/);
    // Lighter than the share only warns: RCN can weigh less on a second scale.
    expect(isSoft(putBackProblems({ ...draft, netKg: "360" }, tenBags, today).netKg)).toBe(true);
    // An earlier put-back counts at its own weighed kg: 2 bags put back at 150 kg leave 250 kg.
    const after = { ...tenBags, leftBags: 3, returns: [{ netKg: 150 }] };
    expect(lotRemainingKg(after)).toBe(250);
    expect(isHard(putBackProblems({ ...draft, bags: "3", netKg: "260" }, after, today).netKg)).toBe(true);
    expect(putBackProblems({ ...draft, bags: "3", netKg: "245" }, after, today).netKg).toBeUndefined();
    // Everything gone: nothing to weigh back.
    expect(putBackProblems({ ...draft, netKg: "10" }, { ...tenBags, pieces: [{ netKg: 800 }] }, today).netKg?.message).toMatch(/Nothing of this lot's weight is left/);
    expect(putBackShareKg({ netKg: null, bags: 100 }, "20")).toBeNull();
  });

  it("leaves less to load, and ends the lot on trucks, back in Bins, or both", () => {
    // 100 bags weighed at 8,000 kg net; 60 on a truck, 40 put back.
    expect(lotLeft(100, 8000, [{ bags: 60 }], [{ bags: 30 }])).toEqual({ leftBags: 10, leftKg: 800 });
    expect(lotLeft(100, 8000, [{ bags: 60 }], [{ bags: 40 }]).leftBags).toBe(0);
    expect(transferLotStatus(true, 10, 1, 1)).toBe("part_loaded");
    expect(transferLotStatus(true, 0, 1, 1)).toBe("closed");
    expect(transferLotStatus(true, 0, 1, 0)).toBe("loaded");
    expect(transferLotStatus(true, 0, 0, 2)).toBe("put_back");
    expect(transferLotStatus(true, 30, 0, 1)).toBe("ready"); // part put back, the rest still to load
  });

  it("gives each Bin it went into the bags' share of the lot's net, and the Bins it came from still lose the whole lot", () => {
    const lot = {
      lotNo: "LOT-BKE-2026-0001", lotDate: "2026-11-20",
      bins: [{ binCode: "BIN-A", bags: 100, netKg: 8000 }],
      returns: [{ id: 1, binCode: "bin-b", bags: 40, netKg: 3200, date: "2026-11-26", by: "wi" }],
    };
    expect(binLotMovements([lot])).toEqual([
      { binCode: "BIN-A", kg: -8000, kind: "lot_out", ref: "LOT-BKE-2026-0001", date: "2026-11-20", lotNo: "LOT-BKE-2026-0001" },
      { binCode: "BIN-B", kg: 3200, kind: "lot_back", ref: "LOT-BKE-2026-0001", date: "2026-11-26", lotNo: "LOT-BKE-2026-0001" },
    ]);
  });
});
