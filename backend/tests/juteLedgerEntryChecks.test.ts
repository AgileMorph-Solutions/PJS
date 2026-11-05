/**
 * A person lost three Warehouse Stock entries in one day (Nov 2026): a blank or mistyped warehouse or supplier was refused
 * with "Referenced record does not exist.", which told them nothing. A refusal has to name what is wrong and write nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { listLedgerRows } from "../src/services/ledgers.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const A = "JLE-A";
const OTHER = "JLE-B";
const SUPPLIER = "JLE-SUP-1";
let cookie = "";
let wiCookie = "";

async function cleanup() {
  await prisma.juteWarehouseTransferReceipt.deleteMany({ where: { sourceWarehouse: { in: [A, OTHER] } } });
  await prisma.juteWarehouseMovement.deleteMany({ where: { whLocation: { in: [A, OTHER] } } });
  await prisma.user.deleteMany({ where: { username: { in: ["jle-admin", "jle-wi"] } } });
  await prisma.supplier.deleteMany({ where: { code: SUPPLIER } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [A, OTHER] } } });
}
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: A, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "JLE" } });
  await prisma.warehouse.create({ data: { name: OTHER, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "JLF" } });
  await prisma.supplier.create({ data: { code: SUPPLIER, name: "Test supplier" } });
  await prisma.user.create({ data: { username: "jle-wi", displayName: "Incharge", role: "warehouse_incharge", warehouse: A, passwordHash: hashPassword(PW) } });
  wiCookie = String((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "jle-wi", password: PW } })).headers["set-cookie"]);
  await prisma.user.create({ data: { username: "jle-admin", displayName: "Admin", role: "admin", passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "jle-admin", password: PW } });
  cookie = String(res.headers["set-cookie"]);
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

// What the form really sends: every field, blank ones as "".
const BLANK = {
  Date: "2026-11-05", "Activities type": "REBAGGING DURING LOADING", "Supplier code": "", "WH location": A, "Truck number": "", "W/R No.": "",
  "Bags issued": "", "Bags received": "10", "Good bags available": "", "Completely damaged/discarded": "", "Damaged/repairable": "",
};
const post = (over: object) =>
  app.inject({ method: "POST", url: "/api/jute-ledgers/warehouse-stock/entries", payload: { row: { ...BLANK, ...over } }, headers: { cookie } });

describe("adding a Warehouse Stock entry", () => {
  it("names what is wrong, and writes nothing", async () => {
    const cases: [object, RegExp][] = [
      [{ "WH location": "" }, /Choose the warehouse/],
      [{ "WH location": " " }, /Choose the warehouse/],
      [{ "WH location": "jle-a" }, /Warehouse "jle-a" isn't in the warehouse master/],
      [{ "Supplier code": "100" }, /Supplier code "100" isn't in the Suppliers list/],
    ];
    const before = (await prisma.juteWarehouseMovement.aggregate({ _max: { seq: true }, _count: true }));
    for (const [over, message] of cases) {
      const res = await post(over);
      expect(res.statusCode, JSON.stringify(over)).toBe(422);
      expect(res.json().error).toMatch(message);
    }
    const after = (await prisma.juteWarehouseMovement.aggregate({ _max: { seq: true }, _count: true }));
    expect(after).toEqual(before);
  });

  it("saves a good one, with or without a supplier, blanks and all", async () => {
    expect((await post({})).statusCode).toBe(201);
    expect((await post({ "Supplier code": SUPPLIER, "Bags received": "", "Bags issued": "4" })).statusCode).toBe(201);
    const rows = await listLedgerRows("warehouse-stock", [A]);
    expect(rows.map((r) => r["Balance"])).toEqual(["10", "6"]);
    expect(rows[1]).toMatchObject({ "Supplier code": SUPPLIER, "WH location": A });
  });
});

describe("what it refuses in the bag counts", () => {
  it("won't save text or a part bag as a blank count", async () => {
    const cases: [object, RegExp][] = [
      [{ "Bags received": "ten" }, /"Bags received" must be a whole number, not "ten"/],
      [{ "Bags received": "1,000" }, /"Bags received" must be a whole number/],
      [{ "Bags received": "1.5" }, /"Bags received" must be a whole number/],
      [{ "Bags received": "-5" }, /"Bags received" can't be negative/],
      [{ "Good bags available": "many" }, /"Good bags available" must be a whole number/],
    ];
    const before = await prisma.juteWarehouseMovement.count({ where: { whLocation: A } });
    for (const [over, message] of cases) {
      const res = await post(over);
      expect(res.statusCode, JSON.stringify(over)).toBe(422);
      expect(res.json().error).toMatch(message);
    }
    expect(await prisma.juteWarehouseMovement.count({ where: { whLocation: A } })).toBe(before);
  });

  it("wants one direction on a line, but allows a line that only records the good/damaged split", async () => {
    const both = await post({ "Bags issued": "100", "Bags received": "100" });
    expect(both.statusCode).toBe(422);
    expect(both.json().error).toMatch(/not both/);

    const neither = await post({ "Bags received": "" });
    expect(neither.statusCode).toBe(422);
    expect(neither.json().error).toMatch(/Enter bags issued or bags received/);

    expect((await post({ "Bags received": "", "Completely damaged/discarded": "3" })).statusCode).toBe(201);
    expect((await post({ "Bags received": "1 000" })).statusCode).toBe(201);
  });

  it("reports a line with both that came in another way, and leaves it as it is", async () => {
    const last = await prisma.juteWarehouseMovement.aggregate({ _max: { seq: true } });
    await prisma.juteWarehouseMovement.create({
      data: { seq: (last._max.seq ?? 0) + 1, activitiesType: "REBAGGING", whLocation: A, bagsIssued: 5, bagsReceived: 5 },
    });
    const { CHECKS } = await import("../src/domain/dataQuality/checks.js");
    const finding = await CHECKS.find((c) => c.id === "jute_movement_both_directions")!.run({ prisma });
    expect(finding?.affectedCount).toBeGreaterThanOrEqual(1);
    expect(await prisma.juteWarehouseMovement.count({ where: { whLocation: A, bagsIssued: 5, bagsReceived: 5 } })).toBe(1);
  });
});

describe("whose warehouse it is", () => {
  const asWi = (ledger: string, row: object) =>
    app.inject({ method: "POST", url: `/api/jute-ledgers/${ledger}/entries`, payload: { row }, headers: { cookie: wiCookie } });

  it("keeps a Warehouse Incharge to their own, on every ledger that says whose it is", async () => {
    expect((await asWi("warehouse-stock", { ...BLANK, "WH location": OTHER })).statusCode).toBe(403);
    expect(await prisma.juteWarehouseMovement.count({ where: { whLocation: OTHER } })).toBe(0);
    expect((await asWi("supplier-movement", { "Supplier code": SUPPLIER, Warehouse: OTHER })).statusCode).toBe(403);
    expect((await asWi("factory-production-tracking", { Warehouse: OTHER })).statusCode).toBe(403);
    expect((await asWi("warehouse-stock", BLANK)).statusCode).toBe(201);
  });

  it("lets an Admin use any warehouse", async () => {
    expect((await post({ "WH location": OTHER })).statusCode).toBe(201);
  });
});

describe("adding a Warehouse Transfers entry", () => {
  const postTransfer = (row: object) =>
    app.inject({ method: "POST", url: "/api/jute-ledgers/warehouse-to-warehouse-movement/entries", payload: { row }, headers: { cookie: wiCookie } });
  // Every field the form has, filled as a person would, with blanks as "".
  const FULL = {
    Date: "2026-11-05", "Truck registration": "TRK-1", "LOT NO": "12", "BIN NO.": "BIN-1", Origin: "MANKONO", "Bags Dispatched From Bouake": "590",
    "Received Bags": "588", "Diffrence in Bag at Receiving": "-2", "Damaged Bag": "1", "New Jute Bag Used": "0", Recondition: "", Month: "", "DRY/UNDRY": "",
    "ID transfer": "", "Lot Dry": "", "NO-FICHE": "", "CCA transferred fiche Number": "", "Transfer -Bouake": A, "FINAL BAGS AFTER REBAGGING W/H": "587", DIFF: "-1",
    "Laisse-Passer Entree (Yakro)": "", "FULLY LOADED TRUCK WEIGHT - BEFORE UNLOADING OF RCN": "48000", "EMPTRY TRUCK TARE WEIGHT - AFTER UNLOADING OF THE RCN": "12000",
    "Gross Weight (Yakro) Recived": "36000", "Weight at arrival (kg) Net": "35400", "Net Wt Dispatched (From Bouake)": "35500", "Weight Difference at Yakro": "-100",
    "KOR Received (At Yakro)": "47,5", "KOR Dispatched From BOUAKE": "47.8", "Moisture Received at YAKRO WH": "not tested", "Dispatched Moisture": "", "NC arrival": "", Comment: "",
  };

  it("saves, with every number field filled, a French comma read and a word kept as written", async () => {
    const res = await postTransfer(FULL);
    expect(res.statusCode, res.body).toBe(201);
    const row = (await listLedgerRows("warehouse-to-warehouse-movement", [A])).at(-1)!;
    expect(row).toMatchObject({
      "Transfer -Bouake": A, "Received Bags": "588", "Weight Difference at Yakro": "-100", "Gross Weight (Yakro) Recived": "36000",
      "KOR Received (At Yakro)": "47.5", "Moisture Received at YAKRO WH": "not tested",
    });
  });

  it("can be recorded by the warehouse receiving it, not only the one that sent it", async () => {
    expect((await postTransfer({ ...FULL, "Transfer -Bouake": OTHER })).statusCode).toBe(201);
  });

  it("names what is wrong", async () => {
    const cases: [object, RegExp][] = [
      [{ "Transfer -Bouake": "" }, /Source warehouse is required/],
      [{ "Transfer -Bouake": "NOWHERE" }, /Warehouse "NOWHERE" isn't in the warehouse master/],
      [{ "Gross Weight (Yakro) Recived": "heavy" }, /"Gross Weight \(Yakro\) Recived" must be a whole number/],
      [{ "Received Bags": "-1" }, /"Received Bags" can't be negative/],
    ];
    for (const [over, message] of cases) {
      const res = await postTransfer({ ...FULL, ...over });
      expect(res.statusCode, JSON.stringify(over)).toBe(422);
      expect(res.json().error).toMatch(message);
    }
  });
});
