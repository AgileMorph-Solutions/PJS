/**
 * Drying from a Bin (Sameer, 18 Nov 2026): RCN goes from a Bin to the drying yard and, once dry, is re-bagged into a NEW Bin
 * — or, as an exception, sent straight to production with no new Bin. Through the HTTP routes the Warehouse activities page
 * uses, on a throwaway warehouse, with the Bin's stock read back after each step.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const SITE = "BDRY-SITE";
const STORE = "BDRY-SITE-STORE";
const OTHER = "BDRY-OTHER";
const OTHER_STORE = "BDRY-OTHER-STORE";
const BIN = "BDRY-BIN-01";
const NEW_BIN = "BDRY-BIN-02";
const FOREIGN_BIN = "BDRY-BIN-99";
const GRN = "GRN Weight (kept separate from Gross/Net/Paid)";
const cookies: Record<string, string> = {};

const QUALITY_BEFORE = { inputMoisture: "12.5", inputNutCount: "180" };
const QUALITY_AFTER = { outputMoisture: "8.9", outputNutCount: "182" };

async function cleanup() {
  await prisma.dryingBatch.deleteMany({ where: { warehouseSite: { in: [SITE, OTHER] } } });
  await prisma.receipt.deleteMany({ where: { warehouse: { in: [SITE, STORE] } } });
  await prisma.changeLog.deleteMany({ where: { user: { username: { startsWith: "bdry-" } } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "bdry-" } } });
  await prisma.binStageEntry.deleteMany({ where: { binCode: { startsWith: "BDRY-" } } });
  await prisma.binActivityEntry.deleteMany({ where: { binCode: { startsWith: "BDRY-" } } });
  await prisma.bin.deleteMany({ where: { code: { startsWith: "BDRY-" } } });
  await prisma.warehouse.deleteMany({ where: { site: { in: [SITE, OTHER] } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [SITE, OTHER] } } });
}

const call = (who: string, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: cookies[who]!, ...(payload ? { "content-type": "application/json" } : {}) } });
const bin = async (code: string) => (await call("wi", "GET", `/api/bins/${code}`)).json();

beforeAll(async () => {
  await cleanup();
  // Central: only a Central warehouse sends dried RCN straight to production (23 Nov 2026); OTHER stays a Unit.
  await prisma.warehouse.create({ data: { name: SITE, kind: "FACTORY", type: "CENTRAL", code: "BDRY" } });
  await prisma.warehouse.create({ data: { name: STORE, site: SITE } });
  await prisma.warehouse.create({ data: { name: OTHER, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "BDRO" } });
  await prisma.warehouse.create({ data: { name: OTHER_STORE, site: OTHER } });
  await prisma.bin.createMany({ data: [
    { code: BIN, warehouseName: STORE, source: "test" },
    { code: NEW_BIN, warehouseName: STORE, source: "test" },
    { code: FOREIGN_BIN, warehouseName: OTHER_STORE, source: "test" },
  ] });
  // 20 t in the Bin: a truck that passed quality, with its GRN complete.
  const r = await createReceipt(SITE, "2026-11-01");
  await setBranch(r.id, "n-qfs", "pass");
  await setStageFields(r.id, "n-bin", { "Bin Number": BIN }, { bypassValidation: true });
  await setStageFields(r.id, "n-grn", { [GRN]: "20000", PRICE: "470" }, { bypassValidation: true });
  for (const [key, role] of [["wi", "warehouse_incharge"], ["bm", "branch_manager"]] as const) {
    await prisma.user.create({ data: { username: `bdry-${key}`, displayName: key, role, warehouse: STORE, passwordHash: hashPassword(PW) } });
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: `bdry-${key}`, password: PW } });
    cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
  }
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app.close();
});

describe("the warehouse's Bins", () => {
  it("lists each Bin of the warehouse with its stock, and shows one Bin with its Lots", async () => {
    const list = (await call("wi", "GET", "/api/bins")).json();
    expect(list.find((b: { binCode: string }) => b.binCode === BIN)).toMatchObject({ kg: 20000, lotCount: 1, store: STORE });
    expect(list.some((b: { binCode: string }) => b.binCode === FOREIGN_BIN)).toBe(false);
    expect(await bin(BIN)).toMatchObject({ binCode: BIN, kg: 20000, lots: [{ kg: 20000 }], dryings: [], activities: [] });
    expect((await call("wi", "GET", `/api/bins/${FOREIGN_BIN}`)).statusCode).toBe(404);
  });

  it("is the Warehouse Incharge's: a Branch Manager can't read or dry a Bin", async () => {
    expect((await call("bm", "GET", "/api/bins")).statusCode).toBe(403);
    expect((await call("bm", "POST", `/api/bins/${BIN}/drying`, { dryType: "SUN DRYING", issuedNetKg: "100", ...QUALITY_BEFORE })).statusCode).toBe(403);
  });
});

// 25 Nov 2026: the Bin's page asks "Does this Bin need drying?", Yes or No, as a truck's drying was asked per Lot before.
describe("does this Bin need drying?", () => {
  const answer = (who: string, code: string, a: unknown) => call(who, "PUT", `/api/bins/${code}/drying-decision`, { answer: a });

  it("is unanswered at first, keeps a No, and can be changed to Yes", async () => {
    expect((await bin(NEW_BIN)).dryingDecision).toBeNull();
    const no = await answer("wi", NEW_BIN, "no");
    expect(no.statusCode, no.body).toBe(200);
    expect(no.json().dryingDecision).toMatchObject({ answer: "no", by: "wi" });
    expect((await answer("wi", NEW_BIN, "yes")).json().dryingDecision.answer).toBe("yes");
    expect((await bin(NEW_BIN)).dryingDecision.answer).toBe("yes");
    // Each answer is in the change log.
    expect(await prisma.changeLog.count({ where: { entity: "BinStageEntry", recordId: { contains: NEW_BIN } } })).toBeGreaterThan(0);
  });

  it("takes only yes or no, only for the warehouse's own Bins, and not from a Branch Manager", async () => {
    expect((await answer("wi", NEW_BIN, "maybe")).json().error).toMatch(/"yes" or "no"/);
    expect((await answer("wi", FOREIGN_BIN, "no")).statusCode).toBe(422);
    expect((await answer("bm", NEW_BIN, "no")).statusCode).toBe(403);
  });
});

describe("drying from a Bin", () => {
  it("refuses a Bin of another warehouse, and a new Bin that is the same Bin", async () => {
    expect((await call("wi", "POST", `/api/bins/${FOREIGN_BIN}/drying`, { dryType: "SUN DRYING", issuedNetKg: "100", ...QUALITY_BEFORE })).json().error).toMatch(/isn't a Bin of this warehouse/);
    // 26 Nov 2026 (user): the dried RCN goes into one of this warehouse's own Bins, never another warehouse's.
    const elsewhere = await call("wi", "POST", `/api/bins/${BIN}/drying`, { dryType: "SUN DRYING", issuedNetKg: "100", destinationBin: FOREIGN_BIN, ...QUALITY_BEFORE });
    expect(elsewhere.statusCode).toBe(422);
    expect(elsewhere.json().error).toMatch(/BDRY-BIN-99 isn't a Bin of this warehouse/);
    // 26 Nov 2026 (user): the drying date can't be in the future.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const future = await call("wi", "POST", `/api/bins/${BIN}/drying`, { dryType: "SUN DRYING", issuedNetKg: "100", date: tomorrow, ...QUALITY_BEFORE });
    expect(future.statusCode).toBe(422);
    expect(future.json().error).toMatch(/is in the future/);
    const same = await call("wi", "POST", `/api/bins/${BIN}/drying`, { dryType: "SUN DRYING", issuedNetKg: "100", destinationBin: BIN, ...QUALITY_BEFORE });
    expect(same.statusCode).toBe(422);
    expect(same.json().error).toMatch(/new Bin: choose a Bin other than BDRY-BIN-01/);
  });

  it("takes the kg out of the Bin when issued, and puts what came back into the NEW Bin once it passed", async () => {
    const start = await call("wi", "POST", `/api/bins/${BIN}/drying`, { dryType: "SUN DRYING", issuedNetKg: "5000", issuedBags: "100", ...QUALITY_BEFORE });
    expect(start.statusCode, start.body).toBe(201);
    expect(start.json()).toMatchObject({ sourceBinNo: BIN, lotNo: null, status: "IN DRYING", round: 1 });
    expect((await bin(BIN)).kg).toBe(15000);
    expect((await call("wi", "GET", "/api/bins")).json().find((b: { binCode: string }) => b.binCode === BIN).kg).toBe(15000);

    const id = start.json().id;
    // It can't come back into the Bin it was taken from.
    expect((await call("wi", "POST", `/api/drying-batches/${id}/return`, { receivedNetKg: "4800", destinationBin: BIN })).json().error).toMatch(/new Bin/);
    expect((await call("wi", "POST", `/api/drying-batches/${id}/return`, { receivedNetKg: "4800", receivedBags: "98" })).statusCode).toBe(200);
    // Passing without a new Bin would leave it in no Bin's stock.
    expect((await call("wi", "POST", `/api/drying-batches/${id}/check`, { decision: "pass", ...QUALITY_AFTER })).json().error).toMatch(/Choose the new Bin/);
    const check = await call("wi", "POST", `/api/drying-batches/${id}/check`, { decision: "pass", destinationBin: NEW_BIN, ...QUALITY_AFTER });
    expect(check.statusCode, check.body).toBe(200);
    expect((await bin(BIN)).kg).toBe(15000);
    expect(await bin(NEW_BIN)).toMatchObject({ kg: 4800, movements: [{ kind: "drying_back", kg: 4800 }] });
    expect((await bin(BIN)).dryings.map((d: { status: string }) => d.status)).toEqual(["PASSED"]);
  });

  it("the exception: sent straight to production from the yard, it comes back to no Bin", async () => {
    const start = await call("wi", "POST", `/api/bins/${BIN}/drying`, { dryType: "SUN DRYING", issuedNetKg: "3000", ...QUALITY_BEFORE });
    const id = start.json().id;
    await call("wi", "POST", `/api/drying-batches/${id}/return`, { receivedNetKg: "2900" });
    const check = await call("wi", "POST", `/api/drying-batches/${id}/check`, { decision: "production", ...QUALITY_AFTER });
    expect(check.statusCode, check.body).toBe(200);
    expect(check.json().checked).toMatchObject({ status: "SENT TO PRODUCTION", destinationBinNo: null });
    expect((await bin(BIN)).kg).toBe(12000);
    expect((await bin(NEW_BIN)).kg).toBe(4800);
  });
});

describe("a truck unloaded straight onto the drying yard", () => {
  it("is dried from the yard — no Bin is taken from — and once passed into a Bin, counts there at what came back", async () => {
    const r = await createReceipt(SITE, "2026-11-02");
    // Arrived, weighed, passed and unloaded: a truck's own drying opens once it is off the truck (contract phaseGate).
    const by = { bypassValidation: true };
    await setStageFields(r.id, "n-gate", { "DATE OF ARRIVAL": "2026-11-02", "CREDIT/CASH": "CASH", "WH LOCATION": STORE, "VEHICLE NO.": "BDRY-1" }, by);
    await setStageFields(r.id, "n-verify", { "SUPPLIERS NAME": "S", "LBA CODE": "LBA-001-S", "FICHE CODE": "F", FICHE: "1", ORIGIN: "O" }, by);
    await setStageFields(r.id, "n-gross", { "Loaded truck weight (kg)": "48000", "Tare / empty truck weight (kg)": "8000" }, by);
    await setBranch(r.id, "n-qfs", "pass");
    await setStageFields(r.id, "n-unload", {
      "DATE OF OFFLOADING": "2026-11-02", "BON SACS (good bags)": "400", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "0", "Reconditioning of torn bags": "0", Refraction: "0",
    }, by);
    const gate = (await import("@anagroci/contract/domain/phaseGate")).stageGate;
    const { toReceiptRecord } = await import("../src/serialize.js");
    const { loadReceiptRow } = await import("../src/services/receipts.js");
    const open = gate(toReceiptRecord((await loadReceiptRow(r.id))!), "n-drying");
    expect(open.open, open.message).toBe(true);
    const lot = (await prisma.stageLotAssignment.findUnique({ where: { receiptId: r.id }, select: { lotNumber: true } }))?.lotNumber;
    expect(lot).toBeTruthy();
    const start = await call("wi", "POST", `/api/receipts/${r.id}/drying`, { route: "direct", dryType: "SUN DRYING", issuedNetKg: "8000", ...QUALITY_BEFORE });
    expect(start.statusCode, start.body).toBe(201);
    const round = await prisma.dryingBatch.findFirstOrThrow({ where: { lotNo: lot!, warehouseSite: SITE }, orderBy: { sn: "desc" } });
    expect(round).toMatchObject({ sourceBinNo: null, status: "IN DRYING" });

    expect((await call("wi", "POST", `/api/drying-batches/${round.id}/return`, { receivedNetKg: "7700" })).statusCode).toBe(200);
    expect((await call("wi", "POST", `/api/drying-batches/${round.id}/check`, { decision: "pass", destinationBin: NEW_BIN, ...QUALITY_AFTER })).statusCode).toBe(200);
    // Its GRN completes once it has its Bin; from then it is in that Bin at the dried weight, not at the GRN weight.
    await setStageFields(r.id, "n-bin", { "Bin Number": NEW_BIN }, { bypassValidation: true });
    await setStageFields(r.id, "n-grn", { [GRN]: "8000", PRICE: "470" }, { bypassValidation: true });
    expect((await bin(NEW_BIN)).lots).toEqual(expect.arrayContaining([expect.objectContaining({ receiptId: r.id, kg: 7700, dried: true })]));
  });

  // The bug this guards (23 Nov 2026, "That value is already taken"): Bouaké and Yakro trucks both typed store "123", and
  // Bouaké's next drying number was one Yakro had already used under that store.
  it("starts even when another site already used this site's next number under the same store text", async () => {
    const shared = "BDRY-123";
    const next = ((await prisma.dryingBatch.aggregate({ where: { warehouseSite: SITE }, _max: { sn: true } }))._max.sn ?? 0) + 1;
    await prisma.dryingBatch.create({ data: { sn: next, warehouseSite: OTHER, warehouse: shared, lotNo: "BDRY-OTHER-LOT", status: "PASSED", source: "entered" } });
    const r = await createReceipt(SITE, "2026-11-04");
    const by = { bypassValidation: true };
    await setStageFields(r.id, "n-gate", { "DATE OF ARRIVAL": "2026-11-04", "CREDIT/CASH": "CASH", "WH LOCATION": STORE, "WH NO.": shared, "VEHICLE NO.": "BDRY-3" }, by);
    await setStageFields(r.id, "n-verify", { "SUPPLIERS NAME": "S", "LBA CODE": "LBA-001-S", "FICHE CODE": "F", FICHE: "1", ORIGIN: "O" }, by);
    await setStageFields(r.id, "n-gross", { "Loaded truck weight (kg)": "48000", "Tare / empty truck weight (kg)": "8000" }, by);
    await setBranch(r.id, "n-qfs", "pass");
    await setStageFields(r.id, "n-unload", {
      "DATE OF OFFLOADING": "2026-11-04", "BON SACS (good bags)": "400", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "0", "Reconditioning of torn bags": "0", Refraction: "0",
    }, by);
    const start = await call("wi", "POST", `/api/receipts/${r.id}/drying`, { route: "direct", dryType: "SUN DRYING", issuedNetKg: "8000", ...QUALITY_BEFORE });
    expect(start.statusCode, start.body).toBe(201);
    const mine = await prisma.dryingBatch.findFirstOrThrow({ where: { warehouseSite: SITE, warehouse: shared } });
    expect(mine.sn).toBe(next + 1); // past the number the other site used under the same store
  });

  it("sent from the yard straight to production — with its BTM — it never gets a Bin, and its GRN goes through without one", async () => {
    const r = await createReceipt(SITE, "2026-11-03");
    const by = { bypassValidation: true };
    await setStageFields(r.id, "n-gate", { "DATE OF ARRIVAL": "2026-11-03", "CREDIT/CASH": "CASH", "WH LOCATION": STORE, "VEHICLE NO.": "BDRY-2" }, by);
    await setStageFields(r.id, "n-verify", { "SUPPLIERS NAME": "S", "LBA CODE": "LBA-001-S", "FICHE CODE": "F", FICHE: "2", ORIGIN: "O" }, by);
    await setStageFields(r.id, "n-gross", { "Loaded truck weight (kg)": "48000", "Tare / empty truck weight (kg)": "8000" }, by);
    await setBranch(r.id, "n-qfs", "pass");
    await setStageFields(r.id, "n-unload", {
      "DATE OF OFFLOADING": "2026-11-03", "BON SACS (good bags)": "400", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "0", "Reconditioning of torn bags": "0", Refraction: "0",
    }, by);
    await setStageFields(r.id, "n-qfs", { "Final moisture (%)": "8.5", "Final nut count": "180", "FINAL KOR": "48" }, by);
    const person = { id: (await prisma.user.findUniqueOrThrow({ where: { username: "bdry-wi" } })).id, via: "direct" as const };
    const grn = () => setStageFields(r.id, "n-grn", { [GRN]: "39600", PRICE: "470" }, { actor: person });
    // Before it went to production, the GRN still waits for a Bin like any truck's.
    await expect(grn()).rejects.toThrow(/finish Bin first/);

    const start = await call("wi", "POST", `/api/receipts/${r.id}/drying`, { route: "direct", dryType: "SUN DRYING", issuedNetKg: "39600", ...QUALITY_BEFORE });
    expect(start.statusCode, start.body).toBe(201);
    const lot = (await prisma.stageLotAssignment.findUniqueOrThrow({ where: { receiptId: r.id } })).lotNumber!;
    const round = await prisma.dryingBatch.findFirstOrThrow({ where: { lotNo: lot }, orderBy: { sn: "desc" } });
    await call("wi", "POST", `/api/drying-batches/${round.id}/return`, { receivedNetKg: "38900" });
    const check = await call("wi", "POST", `/api/drying-batches/${round.id}/check`, { decision: "production", btmNo: " BTM-2026-031 ", ...QUALITY_AFTER });
    expect(check.statusCode, check.body).toBe(200);
    expect(check.json().checked).toMatchObject({ status: "SENT TO PRODUCTION", destinationBinNo: null, btmNo: "BTM-2026-031" });

    await grn();
    const links = (await call("wi", "GET", `/api/receipts/${r.id}/links`)).json();
    expect(links.dryingBatches.at(-1)).toMatchObject({ btmNo: "BTM-2026-031", destinationBinNo: null });
  });
});

// 23 Nov 2026: a truck already in a Bin was also dried "straight off the truck", and its Bin offered the same RCN again.
describe("the truck's yard drying and its Bin can't both have the RCN", () => {
  const by = { bypassValidation: true };
  async function unloaded(date: string, vehicle: string) {
    const r = await createReceipt(SITE, date);
    await setStageFields(r.id, "n-gate", { "DATE OF ARRIVAL": date, "CREDIT/CASH": "CASH", "WH LOCATION": STORE, "VEHICLE NO.": vehicle }, by);
    await setStageFields(r.id, "n-verify", { "SUPPLIERS NAME": "S", "LBA CODE": "LBA-001-S", "FICHE CODE": "F", FICHE: "1", ORIGIN: "O" }, by);
    await setStageFields(r.id, "n-gross", { "Loaded truck weight (kg)": "48000", "Tare / empty truck weight (kg)": "8000" }, by);
    await setBranch(r.id, "n-qfs", "pass");
    await setStageFields(r.id, "n-unload", {
      "DATE OF OFFLOADING": date, "BON SACS (good bags)": "400", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "0", "Reconditioning of torn bags": "0", Refraction: "0",
    }, by);
    return r.id;
  }
  const yard = (id: string) => call("wi", "POST", `/api/receipts/${id}/drying`, { route: "direct", dryType: "SUN DRYING", issuedNetKg: "8000", ...QUALITY_BEFORE });
  const asWi = async () => ({ actor: { id: (await prisma.user.findFirstOrThrow({ where: { username: "bdry-wi" } })).id, via: "direct" as const, role: "warehouse_incharge" as const } });

  it("won't dry a truck from the yard once it is in a Bin: that RCN is dried from the Bin", async () => {
    const id = await unloaded("2026-11-05", "BDRY-4");
    await setStageFields(id, "n-bin", { "Bin Number": BIN }, by);
    const res = await yard(id);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(new RegExp(`is in Bin ${BIN}, so it wasn't unloaded straight onto the drying yard`));
  });

  it("keeps the Bin step closed while the RCN is out on the yard, and opens it once it has come back", async () => {
    const id = await unloaded("2026-11-06", "BDRY-5");
    expect((await yard(id)).statusCode).toBe(201);
    await expect(setStageFields(id, "n-bin", { "Bin Number": NEW_BIN }, await asWi())).rejects.toThrow(/out on the drying yard/);
    const round = await prisma.dryingBatch.findFirstOrThrow({ where: { warehouseSite: SITE, source: "entered", lotNo: { not: null } }, orderBy: { createdAt: "desc" } });
    expect((await call("wi", "POST", `/api/drying-batches/${round.id}/return`, { receivedNetKg: "7700" })).statusCode).toBe(200);
    expect((await call("wi", "POST", `/api/drying-batches/${round.id}/check`, { decision: "pass", destinationBin: NEW_BIN, ...QUALITY_AFTER })).statusCode).toBe(200);
    await setStageFields(id, "n-bin", { "Bin Number": NEW_BIN }, await asWi());
    // Dried and in its Bin now: drying it again is the Bin's, not the truck's.
    expect((await yard(id)).json().error).toMatch(/dried RCN is in Bin/);
  });

  it("won't dry from a Bin that holds nothing, nor take out more than it holds", async () => {
    await prisma.bin.create({ data: { code: "BDRY-BIN-03", warehouseName: STORE, source: "test" } });
    const empty = await call("wi", "POST", "/api/bins/BDRY-BIN-03/drying", { dryType: "SUN DRYING", issuedNetKg: "100", ...QUALITY_BEFORE });
    expect(empty.statusCode).toBe(422);
    expect(empty.json().error).toMatch(/holds no RCN right now/);
    const tooMuch = await call("wi", "POST", `/api/bins/${BIN}/drying`, { dryType: "SUN DRYING", issuedNetKg: "999999", ...QUALITY_BEFORE });
    expect(tooMuch.statusCode).toBe(422);
    expect(tooMuch.json().error).toMatch(/you can't take 999,999 kg out of it/);
  });
});

// 23 Nov 2026: the Bin's own "Other warehouse activities" and "Activity ledger", each kept on its own. 26 Nov 2026: each is a
// ledger of many entries, not one form.
describe("the Bin's own ledgers", () => {
  const add = (stageId: string, fields: Record<string, string>, code = BIN) => call("wi", "POST", `/api/bins/${code}/stages/${stageId}/entries`, { fields });
  const ACTIVITY = "Activity type (discharge, weight, reconditioning, destacking, drying, triage, sèches)";

  it("adds Other warehouse activities entries on the Bin, each its own row, with who entered it", async () => {
    const first = await add("n-otheract", { "Re-bagging (damaged/torn bags)": "3", "Movement between locations": NEW_BIN, "Linked location": "BDRY" });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toMatchObject({ stageId: "n-otheract", values: { "Re-bagging (damaged/torn bags)": "3", "Linked location": "BDRY" }, enteredBy: "wi" });
    expect((await add("n-otheract", { Destacking: "12" })).statusCode).toBe(201);
    const entries = (await bin(BIN)).entries;
    // Most recent first; the two ledgers aren't tied together.
    expect(entries["n-otheract"].map((e: { values: Record<string, string> }) => e.values)).toEqual([
      { Destacking: "12" },
      { "Re-bagging (damaged/torn bags)": "3", "Movement between locations": NEW_BIN, "Linked location": "BDRY" },
    ]);
    expect(entries["n-ledger"]).toEqual([]);
  });

  it("fills the ledger's date, place, Bin and who when they are left blank, on each entry", async () => {
    const res = await add("n-ledger", { [ACTIVITY]: "Discharge", Quantity: "41669" });
    expect(res.json().values).toMatchObject({
      Quantity: "41669", "Date/time": new Date().toISOString().slice(0, 10), Location: SITE, "Linked Lot/Bin": BIN, "Performed by": "wi",
    });
    // What a person picks stays theirs: another warehouse as the Location.
    const picked = await add("n-ledger", { [ACTIVITY]: "Weight", Location: OTHER });
    expect(picked.json().values).toMatchObject({ Location: OTHER, "Linked Lot/Bin": BIN });
    expect((await bin(BIN)).entries["n-ledger"]).toHaveLength(2);
  });

  it("changes one entry and leaves the others; a field can be emptied", async () => {
    const [latest, older] = (await bin(BIN)).entries["n-otheract"] as { id: number }[];
    const res = await call("wi", "PATCH", `/api/bins/${BIN}/entries/${latest!.id}`, { fields: { Destacking: "15", "Triage (quality + quantity + moisture check)": "" } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().values).toEqual({ Destacking: "15", "Triage (quality + quantity + moisture check)": "" });
    const after = (await bin(BIN)).entries["n-otheract"] as { id: number; values: Record<string, string> }[];
    expect(after.find((e) => e.id === older!.id)!.values["Re-bagging (damaged/torn bags)"]).toBe("3");
    // An entry of another Bin isn't reachable through this one.
    expect((await call("wi", "PATCH", `/api/bins/${NEW_BIN}/entries/${latest!.id}`, { fields: { Destacking: "1" } })).json().error).toMatch(/isn't one of Bin/);
  });

  it("won't add an empty entry", async () => {
    expect((await add("n-otheract", { Destacking: "  " })).json().error).toMatch(/Nothing to save/);
  });

  // 23 Nov 2026: a Bin with no warehouse waits until an admin gives it one — it is found under "Bins with no warehouse".
  it("refuses a Bin with no warehouse, and lists it under the Bins with no warehouse", async () => {
    await prisma.bin.create({ data: { code: "BDRY-BIN-NOWH", source: "test" } });
    expect((await add("n-otheract", { Destacking: "4" }, "BDRY-BIN-NOWH")).json().error).toMatch(/has no warehouse yet/);
    const mine = (await call("wi", "GET", "/api/bins")).json() as { binCode: string }[];
    expect(mine.some((b) => b.binCode === "BDRY-BIN-NOWH")).toBe(false);
    const none = (await call("wi", "GET", "/api/bins?unassigned=1")).json() as { binCode: string; store: string | null }[];
    expect(none.find((b) => b.binCode === "BDRY-BIN-NOWH")).toMatchObject({ store: null });
  });

  it("refuses a field that isn't the form's, and another warehouse's Bin", async () => {
    expect((await add("n-otheract", { PRICE: "1" })).json().error).toMatch(/isn't part of Other warehouse activities/);
    expect((await add("n-otheract", { Destacking: "4" }, FOREIGN_BIN)).json().error).toMatch(/isn't a Bin of this warehouse/);
    expect((await add("n-grn", { PRICE: "1" })).json().error).toMatch(/isn't one of a Bin's forms/);
  });
});

// 23 Nov 2026: production runs at a Central warehouse; a Unit's dried RCN goes into a new Bin and on to Central on a BKT.
describe("sent straight to production", () => {
  it("is refused at a Unit warehouse", async () => {
    const round = await prisma.dryingBatch.create({
      data: { sn: 9001, round: 1, warehouseSite: OTHER, warehouse: OTHER_STORE, sourceBinNo: FOREIGN_BIN, status: "QUALITY CHECK", issuedNetWeightKg: 1000, receivedNetWeightKg: 950, source: "entered" },
    });
    const { checkDrying } = await import("../src/services/dryingBatches.js");
    await expect(checkDrying(round.id, { decision: "production", ...QUALITY_AFTER }, { id: "x", displayName: "x" }))
      .rejects.toThrow(/Only a Central warehouse can send dried RCN straight to production/);
  });
});

// 23 Nov 2026: a warehouse never lists or opens another's Bins, whatever RCN is in them (Bouaké trucks in Yakro's BIN-000).
describe("a Bin of another warehouse holding this site's RCN", () => {
  it("isn't listed here, can't be opened from here, and refuses this site's forms", async () => {
    const r = await createReceipt(SITE, "2026-11-08");
    await setBranch(r.id, "n-qfs", "pass");
    await setStageFields(r.id, "n-bin", { "Bin Number": FOREIGN_BIN }, { bypassValidation: true });
    await setStageFields(r.id, "n-grn", { [GRN]: "500", PRICE: "470" }, { bypassValidation: true });
    expect((await call("wi", "GET", "/api/bins")).json().some((b: { binCode: string }) => b.binCode === FOREIGN_BIN)).toBe(false);
    expect((await call("wi", "GET", `/api/bins/${FOREIGN_BIN}`)).statusCode).toBe(404);
    expect((await call("wi", "POST", `/api/bins/${FOREIGN_BIN}/stages/n-otheract/entries`, { fields: { Destacking: "2" } })).json().error).toMatch(/isn't a Bin of this warehouse/);
  });
});
