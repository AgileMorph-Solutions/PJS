/**
 * 26 Nov 2026 (user): "SN should be auto fill". A truck's S N fills itself when its Arrival step is saved with none: the next
 * number at its own warehouse, after every S N there (typed, filled in or uploaded). A typed one is kept. On throwaway
 * warehouses, so the real trucks' numbers don't move the expectations.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createReceipt, getReceipt, setStageFields } from "../src/services/receipts.js";

const prisma = new PrismaClient();
const A = "GSN-SITE-A";
const B = "GSN-SITE-B";

async function cleanup() {
  await prisma.receipt.deleteMany({ where: { warehouse: { in: [A, B] } } });
  await prisma.warehouse.deleteMany({ where: { name: { in: [A, B] } } });
}

async function arrived(site: string, gate: Record<string, string>) {
  const r = await createReceipt(site, "2026-11-20");
  await setStageFields(r.id, "n-gate", { "CREDIT/CASH": "CASH", ...gate });
  return (await getReceipt(r.id))!.stageData["n-gate"]?.["S N"];
}

beforeAll(async () => {
  await cleanup();
  await prisma.warehouse.create({ data: { name: A, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "GSNA" } });
  await prisma.warehouse.create({ data: { name: B, kind: "REGIONAL_CENTRAL", type: "UNIT", code: "GSNB" } });
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("the truck's S N fills itself", () => {
  it("counts up at each warehouse on its own, from 1", async () => {
    expect(await arrived(A, {})).toBe("1");
    expect(await arrived(A, {})).toBe("2");
    expect(await arrived(B, {})).toBe("1");
  });

  it("keeps a typed S N, and carries on after it", async () => {
    expect(await arrived(A, { "S N": "50" })).toBe("50");
    expect(await arrived(A, {})).toBe("51");
  });

  it("isn't changed by a later save of the Arrival step", async () => {
    const r = await createReceipt(B, "2026-11-21");
    await setStageFields(r.id, "n-gate", { "CREDIT/CASH": "CASH" });
    const first = (await getReceipt(r.id))!.stageData["n-gate"]?.["S N"];
    await arrived(B, {});
    await setStageFields(r.id, "n-gate", { "VEHICLE NO.": "827KT01" });
    expect((await getReceipt(r.id))!.stageData["n-gate"]?.["S N"]).toBe(first);
  });
});
