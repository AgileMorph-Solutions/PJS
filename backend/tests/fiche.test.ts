/**
 * The CCA fiche upload: the file is kept on the receipt whether or not it could be read, what was read fills the step over
 * what was there (keeping the old values beside the fiche), the supplier is found from earlier trucks with the same CCA
 * supplier code, Origin is filled when the fiche's place is a town in Origins, and only the warehouse's own Warehouse
 * Incharge / admin can reach it. The reader is stubbed: no
 * test calls Claude.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { createReceipt, getReceipt, setStageFields } from "../src/services/receipts.js";
import { getFiche, rereadFiche, uploadFiche } from "../src/services/ficheDocuments.js";
import { FicheReadError, type FicheReader } from "../src/services/ficheReader.js";

const prisma = new PrismaClient();
const app = buildApp();
const PW = "test-password-1";
const P = "fichetest-";
const SITE = "FICHETEST-SITE";
const OTHER = "FICHETEST-OTHER";
const SUPPLIER = { code: "LBA-FT1-NOV", name: "RCN FICHETEST NOVAREA" };
const cookies: Record<string, string> = {};

// The smallest file that passes the type check: a JPEG's first bytes.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
/** A village no Origin has yet: added from the fiche panel (26 Nov 2026). */
const NEW_TOWN = "FICHETEST-NEWTOWN";
const READING = {
  isCcaTransferFiche: true, ficheNumber: "00076601", buyerCode: "9901-0004 LT-NOVAREA", storeName: "NOVAREA PF3",
  subPrefecture: "FICHETEST-SP", department: "FICHETEST-DEPT", village: "FICHETEST-VILLE", unclear: "",
};
const ORIGIN = "FICHETEST-VILLE";
const reads: FicheReader = async () => ({ reading: READING, model: "stub" });
const fails: FicheReader = async () => { throw new FicheReadError("The fiche reader is busy."); };

async function mkUser(key: string, role: string, warehouse: string | null) {
  await prisma.user.create({ data: { username: P + key, displayName: key, role, warehouse, passwordHash: hashPassword(PW) } });
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: P + key, password: PW } });
  expect(res.statusCode, `login ${key}`).toBe(200);
  cookies[key] = String(res.headers["set-cookie"]).split(";")[0]!;
}

function multipart(file: Buffer, filename: string, type: string) {
  const boundary = "----fichetest";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload: body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
const upload = (u: string, receiptId: string, file: Buffer, filename = "fiche.jpg", type = "image/jpeg") => {
  const m = multipart(file, filename, type);
  return app.inject({ method: "POST", url: `/api/receipts/${receiptId}/fiche`, payload: m.payload, headers: { ...m.headers, cookie: cookies[u]! } });
};
const wi = async () => ({ id: (await prisma.user.findFirstOrThrow({ where: { username: P + "wi" } })).id });
const get = (u: string, url: string) => app.inject({ method: "GET", url, headers: { cookie: cookies[u]! } });
const post = (u: string, url: string, payload: object) => app.inject({ method: "POST", url, payload, headers: { cookie: cookies[u]!, "content-type": "application/json" } });

async function cleanup() {
  await prisma.receipt.deleteMany({ where: { warehouse: { in: [SITE, OTHER] } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: P } } });
  await prisma.supplier.deleteMany({ where: { code: SUPPLIER.code } });
  await prisma.origin.deleteMany({ where: { name: { in: [ORIGIN, NEW_TOWN] } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [SITE, OTHER] } } });
}

let earlierTruck: string;
let truck: string;
const savedKey = process.env.ANTHROPIC_API_KEY;

beforeAll(async () => {
  // The routes use the real reader: with no key it reads nothing, which is exactly the "kept, not read" case.
  delete process.env.ANTHROPIC_API_KEY;
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "FT1" } });
  await prisma.warehouse.create({ data: { name: OTHER, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "FT2" } });
  await prisma.supplier.create({ data: SUPPLIER });
  await prisma.origin.create({ data: { name: ORIGIN } });
  await mkUser("wi", "warehouse_incharge", SITE);
  await mkUser("wiOther", "warehouse_incharge", OTHER);
  await mkUser("bm", "branch_manager", SITE);
  await mkUser("qfs", "qfs_officer", SITE);
  // An earlier truck from the same buyer: its FICHE CODE and LBA CODE are what tie the code to the supplier.
  earlierTruck = (await createReceipt(SITE, "2031-03-01")).id;
  await setStageFields(earlierTruck, "n-verify", { "SUPPLIERS NAME": "FICHETEST NOVAREA", "LBA CODE": SUPPLIER.code, "FICHE CODE": "9901-0004", FICHE: "70001" }, { bypassValidation: true });
  truck = (await createReceipt(SITE, "2031-03-02")).id;
});
afterAll(async () => {
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
  await cleanup();
  await prisma.$disconnect();
});

describe("fiche upload", () => {
  it("fills the step from the fiche — the supplier found from the earlier truck, its LBA code with it, and the Origin", async () => {
    const view = await uploadFiche(truck, { fileName: "fiche.jpg", mimeType: "image/jpeg", data: JPEG }, await wi(), reads);
    expect(view.suggestions).toEqual({
      FICHE: { value: "76601", from: "the fiche" },
      "FICHE CODE": { value: "9901-0004", from: "the fiche" },
      "SUPPLIERS NAME": { value: "FICHETEST NOVAREA", from: "CCA supplier code 9901-0004 on earlier trucks" },
    });
    expect(view.filled).toEqual(["FICHE", "FICHE CODE", "SUPPLIERS NAME", "ORIGIN"]);
    expect(view.replaced).toEqual({}); // the form was empty: nothing replaced
    expect(view.document).toMatchObject({ fileName: "fiche.jpg", mimeType: "image/jpeg", sizeBytes: JPEG.length, uploadedBy: "wi", readError: null });
    const verify = (await getReceipt(truck))!.stageData["n-verify"]!;
    expect(verify).toMatchObject({ FICHE: "76601", "FICHE CODE": "9901-0004", "SUPPLIERS NAME": "FICHETEST NOVAREA", "LBA CODE": SUPPLIER.code });
    // The sub-prefecture is a town in Origins, so it is the Origin; REF. stays the person's.
    expect(verify.ORIGIN).toBe(ORIGIN);
    expect(verify["REF."] ?? "").toBe("");
    expect(view.originHint?.match).toEqual({ origin: ORIGIN, level: "Village", exact: true });
    // Saved as the uploader's own edit, so the truck's history says who and when.
    expect(await prisma.stageFieldChange.count({ where: { receiptId: truck, stageId: "n-verify", label: "FICHE" } })).toBeGreaterThan(0);
  });

  // 26 Nov 2026 (user): after "Add … to Origins", the panel still said "Not in Masters". The fiche is matched against the master
  // each time it is read, so reading it again (what the panel now does after adding) shows the town as matched.
  it("reads a village not in Origins as not matched, and as matched once it has been added to Origins", async () => {
    const newTown = async () => ({ reading: { ...READING, village: NEW_TOWN }, model: "stub" });
    expect((await rereadFiche(truck, await wi(), newTown))!.originHint?.places[0]).toEqual({ level: "Village", name: NEW_TOWN });
    expect((await getFiche(truck)).originHint?.match?.exact).not.toBe(true);
    expect((await post("wi", "/api/masters/origins", { name: NEW_TOWN.toLowerCase() })).statusCode).toBe(201);
    expect((await getFiche(truck)).originHint?.match).toEqual({ origin: NEW_TOWN, level: "Village", exact: true });
  });

  // Team, 23 Nov 2026: the form follows the fiche; what it held before is kept so the difference shows and can be put back.
  it("puts the fiche's value over what the form had, and keeps the old value with the fiche", async () => {
    await setStageFields(truck, "n-verify", { FICHE: "77583" }, { actor: { id: (await wi()).id, via: "direct" } });
    const second = async () => ({ reading: { ...READING, ficheNumber: "00099999" }, model: "stub" });
    const view = await uploadFiche(truck, { fileName: "other.jpg", mimeType: "image/jpeg", data: JPEG }, await wi(), second);
    expect(view.filled).toEqual(["FICHE"]);
    expect(view.replaced).toEqual({ FICHE: "77583" });
    expect((await getReceipt(truck))!.stageData["n-verify"]!.FICHE).toBe("99999");
    expect((await getFiche(truck)).replaced).toEqual({ FICHE: "77583" }); // still there when the page is opened again
    // Read again: nothing left to change, and what was replaced the first time isn't forgotten.
    expect((await rereadFiche(truck, await wi(), second))!.replaced).toEqual({ FICHE: "77583" });
  });

  it("keeps the file when it can't be read, and drops the earlier file's reading", async () => {
    const view = await uploadFiche(truck, { fileName: "again.jpg", mimeType: "image/jpeg", data: JPEG }, await wi(), fails);
    expect(view.document).toMatchObject({ fileName: "again.jpg", reading: null, readError: "The fiche reader is busy." });
    expect(view.suggestions).toEqual({});
  });

  it("the incharge uploads through the API; without a reader key the file is kept, not read", async () => {
    const res = await upload("wi", truck, JPEG);
    expect(res.statusCode).toBe(200);
    expect(res.json().document).toMatchObject({ fileName: "fiche.jpg", reading: null });
    expect(res.json().document.readError).toMatch(/isn't set up/);
    expect((await get("wi", `/api/receipts/${truck}/fiche`)).json().document.fileName).toBe("fiche.jpg");
  });

  it("serves the file back as its own type, never sniffed", async () => {
    const res = await get("wi", `/api/receipts/${truck}/fiche/file`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.from(res.rawPayload).equals(JPEG)).toBe(true);
  });

  it("refuses a file that isn't what its type says, and a type a fiche can't be", async () => {
    expect((await upload("wi", truck, Buffer.from("MZ not a photo"), "fiche.jpg", "image/jpeg")).statusCode).toBe(422);
    expect((await upload("wi", truck, Buffer.from("<svg/>"), "fiche.svg", "image/svg+xml")).statusCode).toBe(422);
    // The refused uploads left the kept fiche alone.
    expect((await get("wi", `/api/receipts/${truck}/fiche`)).json().document.fileName).toBe("fiche.jpg");
  });

  it("is the warehouse's own: another warehouse, a Branch Manager and a QFS Officer can't reach it", async () => {
    expect((await get("wiOther", `/api/receipts/${truck}/fiche`)).statusCode).toBe(403);
    expect((await upload("wiOther", truck, JPEG)).statusCode).toBe(403);
    expect((await get("bm", `/api/receipts/${truck}/fiche/file`)).statusCode).toBe(403);
    expect((await upload("qfs", truck, JPEG)).statusCode).toBe(403);
  });

  it("a truck without a fiche says so", async () => {
    expect((await get("wi", `/api/receipts/${earlierTruck}/fiche`)).json()).toEqual({ document: null, suggestions: {}, originHint: null, replaced: {} });
    expect((await get("wi", `/api/receipts/${earlierTruck}/fiche/file`)).statusCode).toBe(404);
    expect(await getFiche(earlierTruck)).toEqual({ document: null, suggestions: {}, originHint: null, replaced: {} });
  });

  it("logs who uploaded which file, without the file's bytes", async () => {
    const rows = await prisma.changeLog.findMany({ where: { entity: "FicheDocument", recordId: truck } });
    expect(rows.some((r) => r.field === "fileName")).toBe(true);
    expect(rows.some((r) => r.field === "data")).toBe(false);
  });
});
