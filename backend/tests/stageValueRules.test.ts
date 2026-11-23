/**
 * What a person may type into a truck's stages: a field with a fixed list takes one of its answers, and a FICHE belongs to
 * one truck at a warehouse. Both showed up in QA: "cach" was saved as the way a truck was paid, and two trucks with the same
 * fiche each showed the other's drying and transfer records. Runs on throwaway sites.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createReceipt, setStageFields, getReceipt } from "../src/services/receipts.js";
import { ValidationError } from "../src/domain/validation.js";

const prisma = new PrismaClient();
const SITE = "SVR-SITE";
const OTHER = "SVR-OTHER";
const D = "2032-06-06";
let userId: string;
const person = () => ({ actor: { id: userId, via: "direct" as const } });

async function cleanup() {
  await prisma.receipt.deleteMany({ where: { warehouse: { in: [SITE, OTHER] } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [SITE, OTHER] } } });
  await prisma.user.deleteMany({ where: { username: "svr-user" } });
}
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "SV1" } });
  await prisma.warehouse.create({ data: { name: OTHER, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "SV2" } });
  userId = (await prisma.user.create({ data: { username: "svr-user", passwordHash: "x", displayName: "Svr", role: "admin" } })).id;
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("a field picked from a fixed list", () => {
  it("refuses a typo, naming the answers, and saves nothing", async () => {
    const id = (await createReceipt(SITE, D)).id;
    await expect(setStageFields(id, "n-gate", { "CREDIT/CASH": "cach" }, person())).rejects.toThrow(/CREDIT\/CASH must be one of: CREDIT, CASH/);
    expect((await getReceipt(id))!.stageData["n-gate"]?.["CREDIT/CASH"]).toBeUndefined();
  });

  it("stores the list's own spelling when the case differs", async () => {
    const id = (await createReceipt(SITE, D)).id;
    await setStageFields(id, "n-gate", { "CREDIT/CASH": " cash " }, person());
    expect((await getReceipt(id))!.stageData["n-gate"]["CREDIT/CASH"]).toBe("CASH");
  });

  it("lets a blank through (nothing chosen yet) and leaves an upload alone (reported, never refused)", async () => {
    const id = (await createReceipt(SITE, D)).id;
    await setStageFields(id, "n-gate", { "CREDIT/CASH": "" }, person());
    await setStageFields(id, "n-gate", { "CREDIT/CASH": "cach" }, { actor: { id: userId, via: "import" } });
    expect((await getReceipt(id))!.stageData["n-gate"]["CREDIT/CASH"]).toBe("cach");
  });

  it("does not refuse a record for a value it already holds: an older value stays as it is until someone changes it", async () => {
    const id = (await createReceipt(SITE, D)).id;
    await setStageFields(id, "n-gate", { "CREDIT/CASH": "cach" }, { actor: { id: userId, via: "import" } });
    await setStageFields(id, "n-gate", { "CREDIT/CASH": "cach", "VEHICLE NO.": "SVR1" }, person());
    expect((await getReceipt(id))!.vehicleNo).toBe("SVR1");
  });
});

describe("a FICHE", () => {
  it("can't be on two trucks at the same warehouse, however it is spelled, and the message says which truck has it", async () => {
    const first = (await createReceipt(SITE, D)).id;
    const second = (await createReceipt(SITE, D)).id;
    await setStageFields(first, "n-verify", { FICHE: "SVR-F-1" }, person());
    const err = await setStageFields(second, "n-verify", { FICHE: " svr-f-1 " }, person()).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain(`already on truck ${first}`);
    expect((await getReceipt(second))!.stageData["n-verify"]?.["FICHE"]).toBeUndefined();
  });

  it("can be saved again on its own truck, and is free to use at another warehouse", async () => {
    const mine = (await createReceipt(SITE, D)).id;
    await setStageFields(mine, "n-verify", { FICHE: "SVR-F-2" }, person());
    await setStageFields(mine, "n-verify", { FICHE: "SVR-F-2", "FICHE CODE": "x" }, person());
    const elsewhere = (await createReceipt(OTHER, D)).id;
    await setStageFields(elsewhere, "n-verify", { FICHE: "SVR-F-2" }, person());
    expect((await getReceipt(elsewhere))!.stageData["n-verify"]["FICHE"]).toBe("SVR-F-2");
  });
});
