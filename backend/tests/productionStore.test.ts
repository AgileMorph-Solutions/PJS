/**
 * Round-trip proof for productionStore.ts — the production twin of roundTrip.test.ts's sentinel
 * loop, driven off PRODUCTION_FIELD_MAP the same way so a newly-added table/field is covered
 * automatically. There is no seeded production data yet (see the plan's "Deferred" section), so
 * this uses disposable fixture rows created and deleted within the test, exactly like
 * roundTrip.test.ts's own sentinel describe block does for its disposable receipt.
 */
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PRODUCTION_FIELD_MAP } from "@anagroci/contract/generated/productionFieldMap";
import { createProductionRow, PRODUCTION_MODEL_DELEGATE } from "../src/productionStore.js";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

const SENTINELS = ["sentinel-value", "", "0", "9.50"];

describe("production store round-trip", () => {
  for (const sentinel of SENTINELS) {
    it(`survives a write of ${JSON.stringify(sentinel)} in every production table`, async () => {
      for (const [tableId, spec] of Object.entries(PRODUCTION_FIELD_MAP)) {
        // The parent key column itself is excluded from `fields` (see productionStore.ts —
        // createProductionRow sets it separately), so only the remaining fields get the sentinel.
        const parentCol = spec.spine === "btm" ? "btmNo" : spec.spine === "lot" ? "lotNo" : spec.spine === "bin" ? "binNo" : null;
        const fields = Object.fromEntries(
          spec.fields.filter((f) => f.col !== parentCol).map((f) => [f.label, sentinel])
        );
        const parentKey = `TEST-${tableId}`;
        const row = await createProductionRow(tableId, parentKey, fields);
        for (const f of spec.fields) {
          if (f.col === parentCol) continue;
          expect((row as Record<string, unknown>)[f.col], `${tableId} / ${f.label}`).toBe(sentinel);
        }
        // Clean up immediately — these tables have no receiptId-style cascade delete to rely on.
        const delegate = (prisma as unknown as Record<string, { delete: (a: unknown) => Promise<unknown> }>)[PRODUCTION_MODEL_DELEGATE[tableId]];
        await delegate.delete({ where: { id: (row as { id: string }).id } });
      }
    });
  }
});
