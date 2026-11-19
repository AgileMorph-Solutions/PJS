import { describe, it, expect } from "vitest";
import { decisionBranchesFor, stageForSite } from "../src/domain/decisions.js";
import { deriveStatus } from "../src/domain/receiptStatus.js";
import { siteTypeOf } from "../src/domain/siteType.js";
import { stageById } from "../src/data/stages.js";
import { canTransferBetween, formatLotPiece, lineNetAtArrival, lotPieceProblem, lotTransferProgress, pieceChanged, suggestedPiece, readyForTransfer, transferDestinationLabel, transferDestinations, transferVariance, transferState, TRANSFER_TOLERANCE, type TransferFacts } from "../src/domain/transfers.js";

describe("the last decision depends on the site", () => {
  const ids = (type: string | null) => decisionBranchesFor("n-xferdec", type)!.map((b) => b.id);

  it("Unit asks about transfer; Central asks about production and can't transfer", () => {
    expect(ids("UNIT")).toEqual(["stays", "transfer"]);
    expect(ids("CENTRAL")).toEqual(["stays", "production"]);
    expect(ids(null)).toEqual(["stays", "transfer"]);
  });

  it("names the same answer for what it means at each site", () => {
    expect(decisionBranchesFor("n-xferdec", "UNIT")![0]!.label).toMatch(/stays/);
    expect(decisionBranchesFor("n-xferdec", "CENTRAL")![0]!.label).toBe("Keep in warehouse");
  });

  it("drops the transfer wording and fields at Central only", () => {
    const stage = stageById["n-xferdec"]!;
    expect(stageForSite(stage, "CENTRAL")).toMatchObject({ title: "Send to production?", fields: [] });
    expect(stageForSite(stage, "UNIT")).toBe(stage);
  });

  it("gives a Lot marked ready its own status, and leaves a kept Lot's status alone", () => {
    const stageData = { "n-grn": {}, "n-drying": {} };
    expect(deriveStatus({ stageData, branches: { "n-qfs": "pass", "n-xferdec": "production" } })).toBe("ready_for_production");
    expect(deriveStatus({ stageData, branches: { "n-qfs": "pass", "n-xferdec": "stays" } })).toBe("in_drying");
    expect(deriveStatus({ stageData, branches: { "n-qfs": "fail", "n-xferdec": "production" } })).toBe("rejected");
  });
});

describe("a warehouse's site type", () => {
  const warehouses = [
    { name: "YAKRO FACTORY", kind: "FACTORY", type: "CENTRAL", site: null },
    { name: "ANAGROCI-01", kind: null, type: null, site: "YAKRO FACTORY" },
    { name: "BKE-04", kind: "FACTORY", type: null, site: null },
  ];
  const aliases = [{ alias: "YAMOUSSOUKRO", warehouseName: "YAKRO FACTORY" }];

  it("reads from the site, whether given the site, one of its stores or an alias", () => {
    for (const name of ["YAKRO FACTORY", "ANAGROCI-01", "YAMOUSSOUKRO"]) expect(siteTypeOf(warehouses, aliases, name), name).toBe("CENTRAL");
  });

  it("is null for a site with no type, or a name the master doesn't have", () => {
    expect(siteTypeOf(warehouses, aliases, "BKE-04")).toBeNull();
    expect(siteTypeOf(warehouses, aliases, "NOWHERE")).toBeNull();
  });
});

describe("where a BKT can go", () => {
  // The shape of the real master: two finished sites and their stores, plus top-level rows left unfinished.
  const master = [
    { name: "BOUAKE", kind: "REGIONAL_CENTRAL", type: "UNIT", code: "BKE", site: null },
    { name: "BKE-001", kind: null, type: null, site: "BOUAKE" },
    { name: "YAKRO FACTORY", kind: "FACTORY", type: "CENTRAL", code: "YAK", site: null },
    { name: "ANAGROCI-01", kind: null, type: null, site: "YAKRO FACTORY" },
    { name: "BKE-06", kind: null, type: null, site: "YAKRO FACTORY" },
    { name: "BKE-04", kind: "FACTORY", type: "UNIT", site: null },
    { name: "BKE-05", kind: "FACTORY", type: "CENTRAL", site: null },
  ];

  it("offers Central warehouses only — never their stores, a Unit site, or a site with no ID code", () => {
    expect(transferDestinations(master, "BOUAKE")).toEqual(["YAKRO FACTORY"]);
    expect(transferDestinations(master, "YAKRO FACTORY")).toEqual([]); // Central never sends RCN back
  });

  it("offers a second Central warehouse once it has its type and ID code", () => {
    const added = [...master, { name: "FACTORY-2", kind: "FACTORY", type: "CENTRAL", code: "FC2", site: null }];
    expect(transferDestinations(added, "BOUAKE")).toEqual(["FACTORY-2", "YAKRO FACTORY"]);
  });

  it("only ever moves RCN from Unit to Central", () => {
    expect(canTransferBetween("UNIT", "CENTRAL")).toBe(true);
    for (const [from, to] of [["CENTRAL", "UNIT"], ["CENTRAL", "CENTRAL"], ["UNIT", "UNIT"], [null, "CENTRAL"], ["UNIT", null]] as const) {
      expect(canTransferBetween(from, to), `${from} → ${to}`).toBe(false);
    }
  });

  it("reads as the site plus the store, or the site alone on a BKT that named no store", () => {
    expect(transferDestinationLabel({ toWarehouse: "YAKRO FACTORY", toStore: "ANAGROCI-01" })).toBe("YAKRO FACTORY · ANAGROCI-01");
    expect(transferDestinationLabel({ toWarehouse: "YAKRO FACTORY", toStore: null })).toBe("YAKRO FACTORY");
  });
});

describe("which Lots the Transfers page offers", () => {
  const passed = { lotNo: "LOT-BKE-2026-0001" };

  // The bug this guards: "Yes" hid the Lot and "No" showed it, the opposite of what the buttons say.
  it("offers a Lot marked Yes, and not one marked No or not answered yet", () => {
    expect(readyForTransfer({ ...passed, branches: { "n-qfs": "pass", "n-xferdec": "transfer" } })).toBe(true);
    expect(readyForTransfer({ ...passed, branches: { "n-qfs": "pass", "n-xferdec": "stays" } })).toBe(false);
    expect(readyForTransfer({ ...passed, branches: { "n-qfs": "pass" } })).toBe(false);
  });

  it("never offers a rejected truck or one with no Lot, even marked Yes", () => {
    expect(readyForTransfer({ ...passed, branches: { "n-qfs": "fail", "n-xferdec": "transfer" } })).toBe(false);
    expect(readyForTransfer({ lotNo: undefined, branches: { "n-xferdec": "transfer" } })).toBe(false);
  });
});

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

// The user's case (Nov 2026): a 40 t Lot on a 35 t truck, the other 5 t on the next truck with another Lot.
describe("a Lot bigger than one truck goes on several BKTs", () => {
  const lot = { bags: 800, netKg: 40000 };
  const first = { transferId: "BKT-2026-010", bags: 700, netWeightKg: 35000 };

  it("works out what is left of the Lot from its pieces", () => {
    expect(lotTransferProgress(lot, [])).toMatchObject({ leftKg: 40000, leftBags: 800, fullySent: false });
    expect(lotTransferProgress(lot, [first])).toMatchObject({ sentKg: 35000, leftKg: 5000, leftBags: 100, fullySent: false });
    expect(lotTransferProgress(lot, [first, { transferId: "BKT-2026-011", bags: 100, netWeightKg: 5000 }])).toMatchObject({ leftKg: 0, fullySent: true });
  });

  it("lets the rest go on the next truck, but never more than is left", () => {
    expect(lotPieceProblem("LOT-1", lot, [first], { bags: 100, netWeightKg: 5000 })).toBeNull();
    expect(lotPieceProblem("LOT-1", lot, [first], { bags: 100, netWeightKg: 5000.5 })).toMatch(/has 5,000 kg left to send \(of 40,000 kg\)/);
    expect(lotPieceProblem("LOT-1", lot, [first, { transferId: "BKT-2026-011", bags: 100, netWeightKg: 5000 }], { bags: 1, netWeightKg: 1 }))
      .toMatch(/already on BKT-2026-010, BKT-2026-011 in full/);
  });

  it("a second piece needs a figure, or nothing could be subtracted", () => {
    expect(lotPieceProblem("LOT-1", lot, [first], { bags: null, netWeightKg: null })).toMatch(/Enter how much of it goes on this truck/);
  });

  it("falls back to bags when the Lot's net weight was never recorded", () => {
    const bagsOnly = { bags: 800, netKg: null };
    expect(lotTransferProgress(bagsOnly, [first])).toMatchObject({ leftKg: null, leftBags: 100, fullySent: false });
    expect(lotPieceProblem("LOT-1", bagsOnly, [first], { bags: 101, netWeightKg: null })).toMatch(/100 bags left to send/);
  });

  it("a Lot whose size was never recorded, or a piece with no figure, counts as sent in full — as every BKT before splitting did", () => {
    expect(lotTransferProgress({ bags: null, netKg: null }, [first]).fullySent).toBe(true);
    expect(lotTransferProgress(lot, [{ transferId: "BKT-2026-001", bags: null, netWeightKg: null }]).fullySent).toBe(true);
  });
});

describe("a truck's net at arrival, per Lot", () => {
  const facts = (lines: { bags: number; bagsReceived: number | null }[]) => ({
    status: "received" as const, lines: lines.map((l) => ({ ...l, netWeightKg: null })),
    dispatchedGrossKg: null, bagsReceived: lines.reduce((a, l) => a + (l.bagsReceived ?? 0), 0), receivedGrossKg: 40800,
  });

  it("a Lot alone on the truck gets all of it, weighed", () => {
    expect(lineNetAtArrival(facts([{ bags: 800, bagsReceived: null }]))).toEqual([{ kg: 40800, shared: false }]);
  });

  it("several Lots share it by the bags counted off each, and the shares add up to the truck", () => {
    const got = lineNetAtArrival(facts([{ bags: 100, bagsReceived: 100 }, { bags: 700, bagsReceived: 700 }]));
    expect(got).toEqual([{ kg: 5000, shared: true }, { kg: 35000, shared: true }]);
  });

  it("without a count for every Lot, nothing is attributed", () => {
    expect(lineNetAtArrival(facts([{ bags: 100, bagsReceived: 100 }, { bags: 700, bagsReceived: null }]))).toEqual([undefined, undefined]);
  });
});

describe("a BKT line starts from the Lot's own figures, and a change is noticed", () => {
  const lot = { bags: 200, netKg: 39800 };
  const first = { transferId: "BKT-2026-015", bags: 150, netWeightKg: 30000 };

  it("starts from the whole Lot, then from what is left of it", () => {
    expect(suggestedPiece(lot, [])).toEqual({ bags: 200, netWeightKg: 39800 });
    expect(suggestedPiece(lot, [first])).toEqual({ bags: 50, netWeightKg: 9800 });
  });

  it("calls any different figure a change, but not a box left blank", () => {
    expect(pieceChanged({ bags: 200, netWeightKg: 39800 }, { bags: 200, netWeightKg: 39800 })).toBe(false);
    expect(pieceChanged({ bags: 200, netWeightKg: 39800 }, { bags: 150, netWeightKg: 39800 })).toBe(true);
    expect(pieceChanged({ bags: 200, netWeightKg: 39800 }, { bags: 200, netWeightKg: 30000 })).toBe(true);
    expect(pieceChanged({ bags: 200, netWeightKg: 39800 }, { bags: 200, netWeightKg: null })).toBe(false);
  });

  it("reads a piece the way the page and the timeline write it", () => {
    expect(formatLotPiece({ bags: 150, netWeightKg: 30000 })).toBe("150 bags · 30,000 kg");
    expect(formatLotPiece({ bags: null, netWeightKg: 9800 })).toBe("9,800 kg");
  });
});
