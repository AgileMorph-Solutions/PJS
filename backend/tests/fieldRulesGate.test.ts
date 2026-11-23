/**
 * docs/procurement-field-rules.png on the server: a person's edits follow the phase order; field values are never refused,
 * only warned about in the forms (Nov 2026). An Excel upload and an imported record are never stopped (the repo's rule: real data problems are reported, not refused).
 * The rules themselves are tested in packages/contract/tests/fieldRules.test.ts; this proves the write path holds to them,
 * whatever route the write comes by.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createReceipt, setBranch, setStageFields } from "../src/services/receipts.js";

const prisma = new PrismaClient();
const W = "GATE-WH";
let person: { id: string; via: "direct" };
let upload: { id: string; via: "import" };

const ARRIVAL_GATE = { "DATE OF ARRIVAL": "2026-11-10", "CREDIT/CASH": "CASH", "WH LOCATION": W, "VEHICLE NO.": "827KT01" };
const ARRIVAL_VERIFY = { "SUPPLIERS NAME": "GATE SUPPLIER", "LBA CODE": "", "FICHE CODE": "0401-0007", FICHE: "72515", ORIGIN: "DIANRA" };

async function cleanup() {
  await prisma.receipt.deleteMany({ where: { warehouse: W } });
  await prisma.supplier.deleteMany({ where: { code: "LBA-GATE-001" } });
  await prisma.user.deleteMany({ where: { username: "gate-wi" } });
  await prisma.warehouse.deleteMany({ where: { name: W } });
}
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: W, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "GTE" } });
  await prisma.supplier.create({ data: { code: "LBA-GATE-001", name: "GATE SUPPLIER" } });
  const u = await prisma.user.create({ data: { username: "gate-wi", displayName: "Gate WI", role: "warehouse_incharge", warehouse: W, passwordHash: "x" } });
  person = { id: u.id, via: "direct" };
  upload = { id: u.id, via: "import" };
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const arrived = async () => {
  const r = await createReceipt(W, "2026-11-10");
  await setStageFields(r.id, "n-gate", ARRIVAL_GATE, { actor: person });
  await setStageFields(r.id, "n-verify", ARRIVAL_VERIFY, { actor: person });
  return r.id;
};

describe("phase order", () => {
  it("Weight is refused until Arrival is complete, and the message names what is missing", async () => {
    const r = await createReceipt(W, "2026-11-10");
    await setStageFields(r.id, "n-gate", { "VEHICLE NO.": "827KT01" }, { actor: person });
    await expect(setStageFields(r.id, "n-gross", { "GROSS WT KGS": "41300" }, { actor: person })).rejects.toThrow(/Weight is locked\. Please finish Arrival first: .*ORIGIN/);
  });

  it("opens step by step once each phase is complete; Pass needs the sample readings", async () => {
    const id = await arrived();
    await setStageFields(id, "n-gross", { "Loaded truck weight (kg)": "56000", "Tare / empty truck weight (kg)": "14700" }, { actor: person });
    await expect(setBranch(id, "n-qfs", "pass", undefined, { actor: person })).rejects.toThrow(/Can't pass this truck yet/);
    // KOR isn't typed in the app (Nov 2026): the sample cut-test grams give it.
    await setStageFields(id, "n-qfs", { "Sample moisture (%)": "9.5", "Sample nut count": "172", "Sample – Good Kernel (g)": "270", "Sample – Immature (g)": "30", "Sample – Spotted (g)": "20" }, { actor: person });
    await expect(setStageFields(id, "n-unload", { "BON SACS (good bags)": "463" }, { actor: person })).rejects.toThrow(/must pass Quality first/);
    await setBranch(id, "n-qfs", "pass", undefined, { actor: person });
    await setStageFields(id, "n-unload", { "BON SACS (good bags)": "463" }, { actor: person });
    // A truck's own drying is the one straight off the truck onto the yard: it waits for the unloading, not for a Bin or GRN.
    await expect(setStageFields(id, "n-drying", { "Moisture % — before drying": "12" }, { actor: person })).rejects.toThrow(/Drying is locked\. Please finish Unloading first/);
    await expect(setStageFields(id, "n-otheract", { Destacking: "4" }, { actor: person })).rejects.toThrow(/locked until the GRN is complete/);
  });

  it("a Fail needs only the weight, not the sample readings (a reason is still required)", async () => {
    const id = await arrived();
    await setStageFields(id, "n-gross", { "GROSS WT KGS": "41300" }, { actor: person });
    await setBranch(id, "n-qfs", "fail", "High moisture", { actor: person });
  });
});

describe("field limits only warn: every value a person types is saved", () => {
  it("a value outside the limits is saved", async () => {
    const id = await arrived();
    await setStageFields(id, "n-gross", { "Loaded truck weight (kg)": "56000", "Tare / empty truck weight (kg)": "14700" }, { actor: person });
    await setStageFields(id, "n-qfs", { "Sample moisture (%)": "195" }, { actor: person });
    const row = await prisma.stageQualityQfs.findUnique({ where: { receiptId: id } });
    expect(row?.sampleMoisture).toBe("195");
  });

  it("an empty truck heavier than the loaded one is saved too", async () => {
    const id = await arrived();
    await setStageFields(id, "n-gross", { "Loaded truck weight (kg)": "15000" }, { actor: person });
    await setStageFields(id, "n-gross", { "Tare / empty truck weight (kg)": "16000" }, { actor: person });
  });
});

describe("never stopped", () => {
  it("an Excel upload (via import) writes whatever phase it carries, out of order and outside the limits", async () => {
    const r = await createReceipt(W, "2026-11-10");
    await setStageFields(r.id, "n-qfs", { "Sample moisture (%)": "95" }, { actor: upload });
  });

  it("a record imported from the 2026 workbooks isn't gated", async () => {
    const r = await createReceipt(W, "2026-11-10");
    await prisma.receipt.update({ where: { id: r.id }, data: { source: "imported" } });
    await setStageFields(r.id, "n-gross", { "GROSS WT KGS": "41300" }, { actor: person });
  });
});

describe("auto-fill", () => {
  it("picking the supplier fills its LBA code from the master; a code of another supplier is refused", async () => {
    const id = await arrived();
    const verify = await prisma.stageVerifyDocs.findUnique({ where: { receiptId: id } });
    expect(verify?.lbaCode).toBe("LBA-GATE-001");
    await expect(setStageFields(id, "n-verify", { "LBA CODE": "LBA-999-XXX" }, { actor: person })).rejects.toThrow(/isn't GATE SUPPLIER's code/);
  });

  it("the LBA code always follows the supplier: a stale code is replaced, and clearing the supplier clears it", async () => {
    const id = await arrived();
    // A code left over from before (or sent by an older form) is replaced by the supplier's own when the supplier is saved.
    await prisma.stageVerifyDocs.update({ where: { receiptId: id }, data: { lbaCode: "LBA-OLD-999" } });
    await setStageFields(id, "n-verify", { "SUPPLIERS NAME": "GATE SUPPLIER" }, { actor: person });
    expect((await prisma.stageVerifyDocs.findUnique({ where: { receiptId: id } }))?.lbaCode).toBe("LBA-GATE-001");
    await setStageFields(id, "n-verify", { "SUPPLIERS NAME": "" }, { actor: person });
    expect((await prisma.stageVerifyDocs.findUnique({ where: { receiptId: id } }))?.lbaCode).toBe("");
  });

  it("the week fills itself from the arrival date", async () => {
    const id = await arrived();
    expect((await prisma.stageGateEntry.findUnique({ where: { receiptId: id } }))?.week).toBe("W-46 Nov");
  });
});
