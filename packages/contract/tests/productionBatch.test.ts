import { describe, it, expect } from "vitest";
import { planBatch, suggestBatchCode, warehouseBinStock, splitBinCodes, arrivedLots } from "../src/domain/productionBatch";
import { GRN_QUANTITY_LABEL } from "../src/domain/receiptStatus";
import type { ReceiptRecord, TransferRequest } from "../src/types/receipt";

const DRIED_BIN = 'New/assigned Bin (marked "dried stock")';
/** Every decision answered the way that keeps the Lot in its bin. */
const READY = { "n-qfs": "pass", "n-drying": "none", "n-xferdec": "production" };

function receipt(id: string, stageData: ReceiptRecord["stageData"], extra: Partial<ReceiptRecord> = {}): ReceiptRecord {
  return {
    id, source: "entered", arrivalDate: "2026-06-01", supplierName: "S", lbaCode: "L", vehicleNo: "V", warehouse: "YAKRO FACTORY",
    stageData, branches: READY, timeline: [], ...extra,
  };
}
const grn = (kg: string) => ({ "n-grn": { [GRN_QUANTITY_LABEL]: kg, PRICE: "470" } });

describe("the batch plan", () => {
  it("reproduces ANA-03B from the Phase 1 doc: 4,172.9 t, ≈ 28 days, ending 16/08/2026 from 19/07/2026", () => {
    const plan = planBatch([2_950_400, 878_200, 251_800, 92_500], "2026-07-19");
    expect(plan).toEqual({ plannedKg: 4_172_900, days: 28, endDate: "2026-08-16", withinMonthlyGuide: true });
  });

  it("only warns outside 3,700–4,500 t; the edges are inside", () => {
    expect(planBatch([3_700_000], "2026-07-19").withinMonthlyGuide).toBe(true);
    expect(planBatch([4_500_000], "2026-07-19").withinMonthlyGuide).toBe(true);
    expect(planBatch([92_500], "2026-07-19").withinMonthlyGuide).toBe(false);
    expect(planBatch([92_500], "").endDate).toBeUndefined();
  });

  it("suggests the name from the largest bin: BIN-03B → ANA-03B", () => {
    expect(suggestBatchCode([{ binCode: "BIN-10", kg: 878_200 }, { binCode: "BIN-03B", kg: 2_950_400 }])).toBe("ANA-03B");
    expect(suggestBatchCode([])).toBe("");
  });
});

describe("warehouse bin stock, as procurement left it", () => {
  it("counts a Lot's GRN weight in its bin once procurement is complete, and nothing else", () => {
    const stock = warehouseBinStock([
      receipt("A", { "n-bin": { "Bin Number": "bin-03b" }, ...grn("30000") }, { lotNo: "LOT-YAK-2026-0001" }),
      receipt("B", { "n-bin": { "Bin Number": "BIN-03B" }, ...grn("12000.5") }),
      // GRN quantity without a price: the record isn't complete yet, so the Lot isn't stock.
      receipt("C", { "n-bin": { "Bin Number": "BIN-03B" }, "n-grn": { [GRN_QUANTITY_LABEL]: "999" } }),
      receipt("D", { "n-bin": { "Bin Number": "BIN-03B" }, ...grn("500") }, { branches: { ...READY, "n-qfs": "fail" } }),
      receipt("E", { "n-bin": { "Bin Number": "BIN-03B" }, ...grn("500") }, { branches: { ...READY, "n-xferdec": "transfer" } }),
    ]);
    expect([...stock.keys()]).toEqual(["BIN-03B"]);
    expect(stock.get("BIN-03B")!.kg).toBe(42000.5);
    expect(stock.get("BIN-03B")!.lots.map((l) => l.receiptId)).toEqual(["A", "B"]);
    expect(stock.get("BIN-03B")!.lots[0]!.lotNo).toBe("LOT-YAK-2026-0001");
  });

  it("is strict: a GRN-complete Lot whose transfer or drying question is unanswered is not ready, never assumed to stay", () => {
    const inBin = { "n-bin": { "Bin Number": "BIN-03B" }, ...grn("1000") };
    const { "n-xferdec": _x, ...noTransferAnswer } = READY;
    const { "n-drying": _d, ...noDryingAnswer } = READY;
    const stock = warehouseBinStock([
      receipt("READY", inBin),
      receipt("NO-XFER", inBin, { branches: noTransferAnswer }),
      receipt("NO-DRY", inBin, { branches: noDryingAnswer }),
      // Drying chosen, but the Lot hasn't been issued to drying yet: it's about to leave the bin.
      receipt("DRY-SOON", inBin, { branches: { ...READY, "n-drying": "indirect" } }),
      receipt("QFS-OPEN", inBin, { branches: { "n-drying": "none", "n-xferdec": "production" } }),
    ]);
    expect(stock.get("BIN-03B")!.lots.map((l) => l.receiptId)).toEqual(["READY"]);
    expect(stock.get("BIN-03B")!.kg).toBe(1000);
  });

  it("takes a Lot out of its bin while it is drying, and counts the dried quantity in the bin it came back to", () => {
    const out = receipt("OUT", { "n-bin": { "Bin Number": "BIN-01" }, ...grn("10000"), "n-drying": { "Moisture % — before drying": "12" } });
    const back = receipt("BACK", { "n-bin": { "Bin Number": "BIN-01" }, ...grn("10000"), "n-drying": { "Dried quantity returned to warehouse": "9400", [DRIED_BIN]: "BIN-20" } });
    const stock = warehouseBinStock([out, back]);
    expect(stock.has("BIN-01")).toBe(false);
    expect(stock.get("BIN-20")).toMatchObject({ kg: 9400, lots: [{ receiptId: "BACK", dried: true, state: "in_bin" }] });
  });

  it("never guesses: a Lot split over several bins, or an imported one with no GRN weight, is listed but adds no kg", () => {
    const stock = warehouseBinStock([
      receipt("SPLIT", { "n-bin": { "Bin Number": "BIN-01 / BIN-02" }, ...grn("8000") }),
      receipt("IMP", { "n-bin": { "Bin Number": "BIN-01" }, "n-grn": { PRICE: "470" } }, { source: "imported" }),
    ]);
    expect(stock.get("BIN-01")).toMatchObject({ kg: 0 });
    expect(stock.get("BIN-01")!.lots.map((l) => [l.receiptId, l.state])).toEqual([["SPLIT", "split_across_bins"], ["IMP", "weight_not_recorded"]]);
    expect(stock.get("BIN-02")!.lots.map((l) => l.state)).toEqual(["split_across_bins"]);
    expect(splitBinCodes(" a, b/c ")).toEqual(["A", "B", "C"]);
  });
});

describe("Lots that arrived on a BKT", () => {
  const line = (receiptId: string, receivedBinCode: string | null) => ({
    receiptId, lotNumber: `LOT-BKE-2026-${receiptId}`, supplierName: "S", vehicleNo: "V", fiche: null, bags: 100, netWeightKg: null,
    moisture: null, kor: null, nutCount: null, binCode: "BKE-002-BIN-01", receivedBinCode,
  });
  const bkt = (id: string, status: TransferRequest["status"], lines: TransferRequest["lines"]): TransferRequest => ({
    id, transferDate: "2026-07-01", fromWarehouse: "BOUAKE", toWarehouse: "YAKRO FACTORY", status, remarks: null, lines,
    dispatchWhReceiptNo: "D", receiveWhReceiptNo: "R", truckNo: "T", transporter: null, driver: null, driverPhone: null,
    dispatchedGrossKg: 10100 * lines.length, dispatchedAt: null, dispatchedBy: null,
    bagsReceived: 100 * lines.length, damagedBags: null, receivedGrossKg: 10050 * lines.length, korReceived: null, moistureReceived: null,
    nutCountReceived: null, receivedComment: null, receivedLotNoRaw: null, receivedAt: "2026-07-03T09:00:00.000Z", receivedBy: null,
    state: "closed", variance: {} as TransferRequest["variance"],
  });

  it("counts a Lot alone on its truck at the net weighed on arrival, dated the day it arrived here", () => {
    const arrivals = arrivedLots([bkt("BKT-2026-001", "received", [line("0001", "bin-03b")])]);
    expect(arrivals).toEqual([{ transferId: "BKT-2026-001", receiptId: "0001", lotNo: "LOT-BKE-2026-0001", supplierName: "S", arrivalDate: "2026-07-03", binCode: "BIN-03B", kg: 9950 }]);
    const stock = warehouseBinStock([receipt("LOCAL", { "n-bin": { "Bin Number": "BIN-03B" }, ...grn("1000") })], arrivals);
    expect(stock.get("BIN-03B")).toMatchObject({ kg: 10950 });
    expect(stock.get("BIN-03B")!.lots[1]).toMatchObject({ receiptId: "0001", transferId: "BKT-2026-001", state: "in_bin", kg: 9950 });
  });

  it("doesn't split one truck's weight between several Lots, and ignores trucks not yet received or Lots with no bin", () => {
    const arrivals = arrivedLots([
      bkt("BKT-2026-002", "received", [line("0002", "BIN-03C"), line("0003", "BIN-03C")]),
      bkt("BKT-2026-003", "dispatched", [line("0004", "BIN-03C")]),
      bkt("BKT-2026-004", "received", [line("0005", null)]),
    ]);
    expect(arrivals.map((a) => [a.receiptId, a.kg])).toEqual([["0002", undefined], ["0003", undefined]]);
    const lots = warehouseBinStock([], arrivals).get("BIN-03C")!;
    expect(lots.kg).toBe(0);
    expect(lots.lots.map((l) => l.state)).toEqual(["weighed_with_other_lots", "weighed_with_other_lots"]);
  });
});
