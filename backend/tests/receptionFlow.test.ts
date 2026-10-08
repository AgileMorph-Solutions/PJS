/**
 * Oct 2026 client feedback on the reception flow, through the service layer: KOR calculated from the
 * cut test (and typed when there is none), data entered once reaching the places that need it, and a
 * Bin being a physical location rather than a store. Runs on a throwaway site so the live data is
 * never touched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createReceipt, setStageFields, setBranch, getReceipt } from "../src/services/receipts.js";
import { ValidationError } from "../src/domain/validation.js";

const prisma = new PrismaClient();
const SITE = "RCPFLOW-SITE";
const STORE = "RCPFLOW-STORE-1";
const CODE = "RCF1";
const BIN = `${STORE}-BIN-012`;
const BIN2 = `${STORE}-BIN-013`;
const D = "2032-04-04";

async function cleanup() {
  await prisma.receipt.deleteMany({ where: { warehouse: SITE } });
  await prisma.bin.deleteMany({ where: { code: { in: [BIN, BIN2] } } });
  await prisma.warehouse.deleteMany({ where: { site: SITE } });
  await prisma.warehouse.deleteMany({ where: { name: SITE } });
  await prisma.user.deleteMany({ where: { username: "rcpflow-wi" } });
}
beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: SITE, kind: "REGIONAL_CENTRAL", type: "UNIT", code: CODE } });
  await prisma.warehouse.create({ data: { name: STORE, site: SITE } });
  await prisma.bin.createMany({ data: [{ code: BIN, source: "test" }, { code: BIN2, source: "test" }] });
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const SAMPLE = { "Sample – Good Kernel (g)": "270", "Sample – Immature (g)": "30", "Sample – Spotted (g)": "20" };

describe("KOR from the cut test", () => {
  it("is calculated from the grams as they are recorded, and audited like any other change", async () => {
    const user = await prisma.user.create({ data: { username: "rcpflow-wi", passwordHash: "x", displayName: "Incharge", role: "warehouse_incharge", warehouse: SITE } });
    const id = (await createReceipt(SITE, D)).id;
    await setStageFields(id, "n-qfs", SAMPLE, { actor: { id: user.id, via: "direct" } });
    expect((await getReceipt(id))!.stageData["n-qfs"]["KOR"]).toBe("52.03"); // (270 + ½ × 50) × 0.17637
    const changes = await prisma.stageFieldChange.findMany({ where: { receiptId: id, label: "KOR" } });
    expect(changes).toMatchObject([{ oldValue: null, newValue: "52.03", via: "direct" }]);

    await setStageFields(id, "n-qfs", { "Sample – Good Kernel (g)": "280" });
    expect((await getReceipt(id))!.stageData["n-qfs"]["KOR"]).toBe("53.79"); // (280 + ½ × 50) × 0.17637 — follows a corrected reading
  });

  it("the sample panel gives KOR and the final panel gives FINAL KOR, independently", async () => {
    const id = (await createReceipt(SITE, D)).id;
    await setStageFields(id, "n-qfs", { ...SAMPLE, "Final – Good Kernel (g)": "280", "Final – Immature (g)": "10", "Final – Spotted (g)": "10" });
    expect((await getReceipt(id))!.stageData["n-qfs"]).toMatchObject({ KOR: "52.03", "FINAL KOR": "51.15" });
  });

  it("stays typeable until the grams exist — a truck with only the final KOR (every 2026 truck) can still be recorded", async () => {
    const id = (await createReceipt(SITE, D)).id;
    await setStageFields(id, "n-qfs", { KOR: "47.69", "FINAL KOR": "48.4" });
    expect((await getReceipt(id))!.stageData["n-qfs"]).toMatchObject({ KOR: "47.69", "FINAL KOR": "48.4" });
    // Two of three grams is still "not enough" — nothing is calculated and nothing is locked.
    await setStageFields(id, "n-qfs", { "Sample – Good Kernel (g)": "270", "Sample – Immature (g)": "30" });
    await setStageFields(id, "n-qfs", { KOR: "47.7" });
    expect((await getReceipt(id))!.stageData["n-qfs"]["KOR"]).toBe("47.7");
  });

  it("is refused once the grams are recorded — typed on its own, or sent together with them", async () => {
    const id = (await createReceipt(SITE, D)).id;
    await setStageFields(id, "n-qfs", SAMPLE);
    await expect(setStageFields(id, "n-qfs", { KOR: "40" })).rejects.toThrow(/KOR is calculated/);

    const other = (await createReceipt(SITE, D)).id;
    await expect(setStageFields(other, "n-qfs", { ...SAMPLE, KOR: "40" })).rejects.toThrow(ValidationError);
    // FINAL KOR is separate: the sample grams don't lock it.
    await setStageFields(id, "n-qfs", { "FINAL KOR": "48.4" });
    expect((await getReceipt(id))!.stageData["n-qfs"]["FINAL KOR"]).toBe("48.4");
  });

  it("the grams replace a KOR that was typed before them", async () => {
    const id = (await createReceipt(SITE, D)).id;
    await setStageFields(id, "n-qfs", { KOR: "40" });
    await setStageFields(id, "n-qfs", SAMPLE);
    expect((await getReceipt(id))!.stageData["n-qfs"]["KOR"]).toBe("52.03");
  });
});

describe("what is entered once reaches where it is needed", () => {
  it("typing the supplier or truck on a stage updates the receipt the list shows", async () => {
    const id = (await createReceipt(SITE, D)).id;
    await setStageFields(id, "n-verify", { "SUPPLIERS NAME": " Stage Supplier ", "LBA CODE": "LBA-STG" });
    await setStageFields(id, "n-gate", { "VEHICLE NO.": "1234AB01" });
    expect(await getReceipt(id)).toMatchObject({ supplierName: "Stage Supplier", lbaCode: "LBA-STG", vehicleNo: "1234AB01" });
  });

  it("never changes the arrival date from a stage — the year in the IDs is the arrival date's", async () => {
    const id = (await createReceipt(SITE, D)).id;
    await setStageFields(id, "n-gate", { "DATE OF ARRIVAL": "2033-01-01" });
    expect((await getReceipt(id))!.arrivalDate).toBe(D);
  });

  it("the Lot records which truck it belongs to, taken from the gate", async () => {
    const id = (await createReceipt(SITE, D)).id;
    await setStageFields(id, "n-gate", { "VEHICLE NO.": "9876ZZ02" });
    const r = await setBranch(id, "n-qfs", "pass");
    expect(r.stageData["n-lot"]["Truck reference"]).toBe("9876ZZ02");
    expect(r.lotNo).toMatch(new RegExp(`^LOT-${CODE}-2032-\\d{4}$`));
  });

  it("a Lot with no truck typed yet is still issued, with no truck reference invented", async () => {
    const id = (await createReceipt(SITE, D)).id;
    const r = await setBranch(id, "n-qfs", "pass");
    expect(r.lotNo).toBeTruthy();
    expect(r.stageData["n-lot"]["Truck reference"] ?? "").toBe("");
  });
});

describe("a Bin is a place inside a store, not the store", () => {
  let id: string;
  beforeAll(async () => {
    id = (await createReceipt(SITE, D)).id;
    await setBranch(id, "n-qfs", "pass");
  });

  it("refuses a store code, and says what a Bin looks like", async () => {
    await expect(setStageFields(id, "n-bin", { "Bin Number": STORE })).rejects.toThrow(/is a store .* not a Bin.*-BIN-012/);
  });

  it("refuses a Bin the master doesn't hold", async () => {
    await expect(setStageFields(id, "n-bin", { "Bin Number": `${STORE}-BIN-999` })).rejects.toThrow(/isn't in the Bin master/);
  });

  it("accepts a Bin from the master, and several for one Lot as the client writes them", async () => {
    await setStageFields(id, "n-bin", { "Bin Number": BIN });
    expect((await getReceipt(id))!.binNo).toBe(BIN);
    await setStageFields(id, "n-bin", { "Bin Number": `${BIN} / ${BIN2}` });
    expect((await getReceipt(id))!.binNo).toBe(`${BIN} / ${BIN2}`);
    await expect(setStageFields(id, "n-bin", { "Bin Number": `${BIN} / ${STORE}-BIN-404` })).rejects.toThrow(/isn't in the Bin master/);
  });

  it("clearing a Bin is allowed, and imports keep whatever the workbook recorded", async () => {
    await setStageFields(id, "n-bin", { "Bin Number": "" });
    expect((await getReceipt(id))!.binNo ?? "").toBe("");
    await setStageFields(id, "n-bin", { "Bin Number": STORE }, { bypassValidation: true }); // history is kept as written
    expect((await getReceipt(id))!.binNo).toBe(STORE);
  });
});
