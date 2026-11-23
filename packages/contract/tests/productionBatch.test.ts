import { describe, it, expect } from "vitest";
import { planBatch, suggestBatchCode, warehouseBinStock, splitBinCodes, arrivedLots, productionReadinessGaps, binDryingMovements, binTransferMovements, lotsSentOnBkts, type DryingRoundFacts, type BinDryingRoundFacts } from "../src/domain/productionBatch";
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
      // All of it left on a dispatched BKT.
      receipt("E", { "n-bin": { "Bin Number": "BIN-03B" }, ...grn("500") }, { branches: { ...READY, "n-xferdec": "transfer" } }),
    ], [], new Map(), [], [], new Map([["E", { kg: 500, unknown: false }]]));
    expect([...stock.keys()]).toEqual(["BIN-03B"]);
    expect(stock.get("BIN-03B")!.kg).toBe(42000.5);
    expect(stock.get("BIN-03B")!.lots.map((l) => l.receiptId)).toEqual(["A", "B"]);
    expect(stock.get("BIN-03B")!.lots[0]!.lotNo).toBe("LOT-YAK-2026-0001");
  });

  it("counts a Lot in its Bin once quality passed and the GRN is complete: drying and transfer are the Bin's questions now, not the Lot's", () => {
    const inBin = { "n-bin": { "Bin Number": "BIN-03B" }, ...grn("1000") };
    const { "n-xferdec": _x, ...noTransferAnswer } = READY;
    const { "n-drying": _d, ...noDryingAnswer } = READY;
    const stock = warehouseBinStock([
      receipt("READY", inBin),
      receipt("NO-XFER", inBin, { branches: noTransferAnswer }),
      receipt("NO-DRY", inBin, { branches: noDryingAnswer }),
      receipt("KEPT", inBin, { branches: { ...READY, "n-xferdec": "stays" } }),
      // Still out: quality never passed, or it left on a dispatched BKT per Lot (counted where it arrived).
      receipt("QFS-OPEN", inBin, { branches: { "n-drying": "none", "n-xferdec": "production" } }),
      receipt("SENT-PER-LOT", inBin, { branches: { ...READY, "n-xferdec": "transfer" } }),
    ], [], new Map(), [], [], new Map([["SENT-PER-LOT", { kg: 1000, unknown: false }]]));
    expect(stock.get("BIN-03B")!.lots.map((l) => l.receiptId)).toEqual(["READY", "NO-XFER", "NO-DRY", "KEPT"]);
    expect(stock.get("BIN-03B")!.kg).toBe(4000);
  });

  // 23 Nov 2026: every Bouaké Bin read empty — a Lot marked "Yes — transfers out", or on a BKT not yet dispatched, counted as
  // gone, and a Lot split across two trucks vanished whole when the first left.
  it("keeps a Lot in its Bin until its BKT is dispatched, and takes off only what left", () => {
    const inBin = { "n-bin": { "Bin Number": "BIN-03B" }, ...grn("39800") };
    const marked = { branches: { ...READY, "n-xferdec": "transfer" } };
    const transfers = [
      { id: "BKT-1", status: "dispatched", fromWarehouse: "S", lines: [{ receiptId: "SPLIT", netWeightKg: 35820 }] },
      { id: "BKT-2", status: "requested", fromWarehouse: "S", lines: [{ receiptId: "SPLIT", netWeightKg: 3980 }, { receiptId: "WAITING", netWeightKg: 39800 }] },
      { id: "BKT-3", status: "received", fromWarehouse: "S", lines: [{ receiptId: "OLD", netWeightKg: null }] },
    ] as unknown as TransferRequest[];
    const sent = lotsSentOnBkts(transfers, ["S"]);
    expect(sent.get("WAITING")).toBeUndefined(); // the truck hasn't left
    const stock = warehouseBinStock([receipt("SPLIT", inBin, marked), receipt("WAITING", inBin, marked), receipt("OLD", inBin, marked)], [], new Map(), [], [], sent);
    const bin = stock.get("BIN-03B")!;
    expect(bin.lots.map((l) => [l.receiptId, l.kg, l.sentKg])).toEqual([["SPLIT", 3980, 35820], ["WAITING", 39800, undefined]]);
    expect(bin.kg).toBe(43780);
  });

  it("takes RCN dried from a Bin out of it when issued, and puts what came back into the new Bin only once the drying passed", () => {
    const lots = [receipt("A", { "n-bin": { "Bin Number": "BIN-01" }, ...grn("10000") })];
    const round = (o: Partial<BinDryingRoundFacts>): BinDryingRoundFacts => ({
      id: "R1", firstBatchId: null, round: 1, status: "IN DRYING", sourceBinNo: "BIN-01", destinationBinNo: null,
      issuedNetWeightKg: 4000, receivedNetWeightKg: null, date: "2026-11-20", ...o,
    });
    const out = warehouseBinStock(lots, [], new Map(), [], binDryingMovements([round({})]));
    expect(out.get("BIN-01")!.kg).toBe(6000);
    expect(out.has("BIN-20")).toBe(false);
    // Re-dried once: round 2 continues from what came back; only its pass puts RCN in the new Bin.
    const chain = [
      round({ status: "RE-DRY", receivedNetWeightKg: 3900 }),
      round({ id: "R2", firstBatchId: "R1", round: 2, status: "PASSED", issuedNetWeightKg: 3900, receivedNetWeightKg: 3850, destinationBinNo: "BIN-20" }),
    ];
    const back = warehouseBinStock(lots, [], new Map(), [], binDryingMovements(chain));
    expect(back.get("BIN-01")!.kg).toBe(6000);
    expect(back.get("BIN-20")).toMatchObject({ kg: 3850, lots: [], movements: [{ kind: "drying_back", kg: 3850, ref: "R1" }] });
    // Sent straight to production from the yard: it leaves the Bin and comes back to none.
    const toProduction = binDryingMovements([round({ status: "SENT TO PRODUCTION", receivedNetWeightKg: 3800 })]);
    expect(toProduction).toEqual([{ binCode: "BIN-01", kg: -4000, kind: "drying_out", ref: "R1", date: "2026-11-20" }]);
  });

  it("moves a truck loaded from a Bin out of it at dispatch, and into the receiving Bin on arrival — never at creation", () => {
    const line = { id: 1, receiptId: null, lotNumber: null, supplierName: "", vehicleNo: "", fiche: null, bags: 500, netWeightKg: 25000, moisture: 8, kor: 48, nutCount: 190, binCode: "BIN-01", receivedBinCode: null, bagsReceived: null };
    const t = (o: Partial<TransferRequest>) => ({ id: "BKT-2026-001", transferDate: "2026-11-20", fromWarehouse: "BOUAKE", toWarehouse: "YAKRO", status: "requested", lines: [line], dispatchedGrossKg: null, bagsReceived: null, receivedGrossKg: null, dispatchedAt: null, receivedAt: null, ...o }) as unknown as TransferRequest;
    expect(binTransferMovements([t({})], ["BOUAKE"])).toEqual([]);
    expect(binTransferMovements([t({ status: "dispatched", dispatchedAt: "2026-11-21T08:00:00Z" })], ["BOUAKE"])).toEqual([
      { binCode: "BIN-01", kg: -25000, kind: "transfer_out", ref: "BKT-2026-001", date: "2026-11-21" },
    ]);
    const received = t({ status: "received", dispatchedGrossKg: 25500, bagsReceived: 498, receivedGrossKg: 25400, receivedAt: "2026-11-22T10:00:00Z", lines: [{ ...line, receivedBinCode: "BIN-03B" }] });
    expect(binTransferMovements([received], ["YAKRO"])).toEqual([{ binCode: "BIN-03B", kg: 24902, kind: "transfer_in", ref: "BKT-2026-001", date: "2026-11-22" }]);
    // A Bin line is never an arrived Lot: it is counted once, as a movement.
    expect(arrivedLots([received])).toEqual([]);
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

  // Lokesh, 16 Nov 2026: once production accepts a load, "stock of RCN should be debited from warehouse stock".
  it("takes the net of every load production accepted off its bin, keeping the Lots listed", () => {
    const inBin = { "n-bin": { "Bin Number": "BIN-03B" }, ...grn("30000") };
    const stock = warehouseBinStock([receipt("A", inBin)], [], new Map(), [{ binCode: "BIN-03B", netKg: 9500.25 }, { binCode: "BIN-03B", netKg: 499.75 }]);
    expect(stock.get("BIN-03B")).toMatchObject({ kg: 20000, issuedKg: 10000, lots: [{ receiptId: "A" }] });
  });

  // The workbooks' own balances go negative; a debit past the GRN stock is a real disagreement, shown as it is.
  it("never clamps: more accepted than the bin's Lots hold leaves it below zero, and a bin with no Lots still shows its debit", () => {
    const stock = warehouseBinStock([receipt("A", { "n-bin": { "Bin Number": "BIN-03B" }, ...grn("1000") })], [], new Map(), [
      { binCode: "BIN-03B", netKg: 1200 },
      { binCode: "BIN-09", netKg: 300 },
    ]);
    expect(stock.get("BIN-03B")).toMatchObject({ kg: -200, issuedKg: 1200 });
    expect(stock.get("BIN-09")).toMatchObject({ kg: -300, issuedKg: 300, lots: [] });
  });
});

// REC-YAK-2026-0317 (Nov 2026): sun drying passed in the app, 100 kg back to BIN-001, yet "Ready for production" stayed blocked
// because only the Drying step's own "Dried quantity returned" field was read, and in-app drying never writes it.
describe("a Lot dried in the app is back once its last round passed", () => {
  const round = (sn: number, status: string, extra: Partial<DryingRoundFacts> = {}): DryingRoundFacts =>
    ({ sn, status, source: "entered", receivedNetWeightKg: 100, destinationBinNo: "BIN-001", ...extra });
  const dried = receipt("DRIED", { "n-bin": { "Bin Number": "BIN-006" }, ...grn("39700"), "n-drying": { "Decision (Direct to drying / Warehouse → Drying)": "Warehouse → Drying" } },
    { lotNo: "LOT-YAK-2026-0015", branches: { "n-qfs": "pass", "n-drying": "indirect", "n-xferdec": "production" } });
  const WAITING = "record the dried quantity returned to a Bin";

  it("opens Ready for production after a passed round, with nothing typed on the Drying step", () => {
    expect(productionReadinessGaps(dried, [round(1, "PASSED")])).toEqual([]);
    expect(productionReadinessGaps(dried, [])).toContain(WAITING); // no round recorded at all: still waiting
  });

  it("waits while any round is open, or the last one was sent for re-drying", () => {
    expect(productionReadinessGaps(dried, [round(1, "IN DRYING")])).toContain(WAITING);
    expect(productionReadinessGaps(dried, [round(1, "RE-DRY"), round(2, "QUALITY CHECK")])).toContain(WAITING);
    // Passed, then "Dry this Lot again": the new drying is open, so the Lot is out of its bin again.
    expect(productionReadinessGaps(dried, [round(1, "PASSED"), round(2, "IN DRYING")])).toContain(WAITING);
  });

  it("counts the dried quantity in the bin the last round came back to", () => {
    const stock = warehouseBinStock([dried], [], new Map([["LOT-YAK-2026-0015", [round(1, "RE-DRY", { receivedNetWeightKg: 300 }), round(2, "PASSED", { receivedNetWeightKg: 250 })]]]));
    expect(stock.has("BIN-006")).toBe(false);
    expect(stock.get("BIN-001")).toMatchObject({ kg: 250, lots: [{ receiptId: "DRIED", dried: true }] });
  });

  it("an imported workbook row doesn't stand in for the Drying step's own fields", () => {
    expect(productionReadinessGaps(dried, [round(1, "PASSED", { source: "imported" })])).toContain(WAITING);
  });
});

describe("Lots that arrived on a BKT", () => {
  const line = (receiptId: string, receivedBinCode: string | null, bagsReceived: number | null = null) => ({
    id: Number(receiptId), receiptId, lotNumber: `LOT-BKE-2026-${receiptId}`, supplierName: "S", vehicleNo: "V", fiche: null, bags: 100, netWeightKg: null,
    moisture: null, kor: null, nutCount: null, binCode: "BKE-002-BIN-01", receivedBinCode, bagsReceived,
  });
  const bkt = (id: string, status: TransferRequest["status"], lines: TransferRequest["lines"]): TransferRequest => ({
    id, transferDate: "2026-07-01", fromWarehouse: "BOUAKE", toWarehouse: "YAKRO FACTORY", toStore: null, status, remarks: null, lines,
    dispatchWhReceiptNo: "D", receiveWhReceiptNo: "R", truckNo: "T", transporter: null, driver: null, driverPhone: null,
    dispatchedGrossKg: 10100 * lines.length, dispatchedAt: null, dispatchedBy: null,
    bagsReceived: 100 * lines.length, damagedBags: null, receivedGrossKg: 10050 * lines.length, korReceived: null, moistureReceived: null,
    nutCountReceived: null, receivedComment: null, receivedLotNoRaw: null, receivedAt: "2026-07-03T09:00:00.000Z", receivedBy: null,
    state: "closed", variance: {} as TransferRequest["variance"],
  });

  it("counts a Lot alone on its truck at the net weighed on arrival, dated the day it arrived here", () => {
    const arrivals = arrivedLots([bkt("BKT-2026-001", "received", [line("0001", "bin-03b")])]);
    expect(arrivals).toEqual([{ transferId: "BKT-2026-001", receiptId: "0001", lotNo: "LOT-BKE-2026-0001", supplierName: "S", arrivalDate: "2026-07-03", binCode: "BIN-03B", kg: 9950, fromWarehouse: "BOUAKE", toWarehouse: "YAKRO FACTORY" }]);
    const stock = warehouseBinStock([receipt("LOCAL", { "n-bin": { "Bin Number": "BIN-03B" }, ...grn("1000") })], arrivals);
    expect(stock.get("BIN-03B")).toMatchObject({ kg: 10950 });
    // Where each Lot is now: a local truck at its own warehouse; a BKT's Lot at the receiving one, remembering who sent it.
    // Many imported Bin masters have no warehouse, so this is what the New run screen's Warehouse column reads.
    expect(stock.get("BIN-03B")!.lots[0]).toMatchObject({ receiptId: "LOCAL", warehouse: receipt("LOCAL", {}).warehouse });
    expect(stock.get("BIN-03B")!.lots[0]!.fromWarehouse).toBeUndefined();
    expect(stock.get("BIN-03B")!.lots[1]).toMatchObject({ receiptId: "0001", transferId: "BKT-2026-001", state: "in_bin", kg: 9950, warehouse: "YAKRO FACTORY", fromWarehouse: "BOUAKE" });
  });

  // 20 Nov 2026: an arrival records the truck's bags once (the client's sheet: one row per truck), so Lots without a count
  // of their own share the truck's net by the bags each was sent with.
  it("on a BKT received with only the truck's bags, shares the weight by bags sent, and ignores trucks not yet received or Lots with no bin", () => {
    const arrivals = arrivedLots([
      bkt("BKT-2026-002", "received", [line("0002", "BIN-03C"), line("0003", "BIN-03C")]),
      bkt("BKT-2026-003", "dispatched", [line("0004", "BIN-03C")]),
      bkt("BKT-2026-004", "received", [line("0005", null)]),
    ]);
    expect(arrivals.map((a) => [a.receiptId, a.kg, a.kgShared])).toEqual([["0002", 9950, true], ["0003", 9950, true]]);
    const lots = warehouseBinStock([], arrivals).get("BIN-03C")!;
    expect(lots.kg).toBe(19900);
    expect(lots.lots.map((l) => l.state)).toEqual(["in_bin", "in_bin"]);
  });

  // Truck: 2 Lots, 200 bags, 20,100 kg gross → 19,900 kg net at arrival, shared 150 : 50 by the bags counted off.
  it("shares a multi-Lot truck's net between its Lots by the bags counted off each, and says it is a share", () => {
    const arrivals = arrivedLots([bkt("BKT-2026-005", "received", [line("0006", "BIN-03D", 150), line("0007", "BIN-03E", 50)])]);
    expect(arrivals.map((a) => [a.receiptId, a.kg, a.kgShared])).toEqual([["0006", 14925, true], ["0007", 4975, true]]);
    const stock = warehouseBinStock([], arrivals);
    expect(stock.get("BIN-03D")!.lots[0]).toMatchObject({ state: "in_bin", kg: 14925, kgShared: true });
    // The shares add back up to what the truck weighed: nothing is invented or lost.
    expect(stock.get("BIN-03D")!.kg + stock.get("BIN-03E")!.kg).toBe(19900);
  });

  it("a Lot split across two trucks arrives once per BKT, each piece with its own weight", () => {
    const arrivals = arrivedLots([
      bkt("BKT-2026-006", "received", [line("0008", "BIN-03F")]),
      bkt("BKT-2026-007", "received", [line("0008", "BIN-03G", 40), line("0009", "BIN-03G", 160)]),
    ]);
    expect(arrivals.map((a) => [a.transferId, a.receiptId, a.binCode, a.kg])).toEqual([
      ["BKT-2026-006", "0008", "BIN-03F", 9950],
      ["BKT-2026-007", "0008", "BIN-03G", 3980],
      ["BKT-2026-007", "0009", "BIN-03G", 15920],
    ]);
  });
});
