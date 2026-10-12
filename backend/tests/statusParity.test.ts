/**
 * Status parity: the normalization must not change any receipt's derived status.
 *
 * deriveStatus() keys off the PRESENCE of a stage, so this is the test that would catch an
 * "optimisation" like skipping all-blank stage rows on import, or auto-creating a system stage —
 * either of which silently reclassifies real trucks. (Auto-creating n-stock whenever n-grn exists,
 * for instance, moves four seeded receipts from grn_completed to in_stock.)
 */
import { supplierNameKey } from "@anagroci/contract/domain/supplierCode";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { deriveStatus, computeDashboardCounts } from "@anagroci/contract/domain/receiptStatus";
import { RECEIPT_INCLUDE, assembleStageData, assembleBranches } from "../src/stageStore.js";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

// Scopes every query below to the seeded cohort — stageDataShadow is set only by prisma/seed.ts,
// never by the interactive create-receipt path or the excel-importer's commitReceipts(), so this
// stays exactly the golden cohort no matter how much real data is imported later (see
// backend/tests/roundTrip.test.ts's beforeAll for the same reasoning). It now covers the full
// 986-row Truck Reception register, not a 50-row demo sample.
const SEED_ONLY = { stageDataShadow: { not: null } } as const;

describe("status parity with the pre-normalization data", () => {
  it("every receipt derives the same status from the tables as from the original JSON", async () => {
    const rows = await prisma.receipt.findMany({ where: SEED_ONLY, include: RECEIPT_INCLUDE });
    const drift: string[] = [];
    for (const row of rows) {
      const source = row.source as "imported" | "entered";
      const before = deriveStatus({
        stageData: JSON.parse(row.stageDataShadow!),
        branches: assembleBranches(row),
        source,
      });
      const after = deriveStatus({ stageData: assembleStageData(row), branches: assembleBranches(row), source });
      if (before !== after) drift.push(`${row.id}: ${before} -> ${after}`);
    }
    expect(drift).toEqual([]);
  });

  it("the dashboard counts are unchanged (self-consistency only — see below for why the six\n     hardcoded figures this used to assert were removed)", async () => {
    const rows = await prisma.receipt.findMany({ where: SEED_ONLY, include: RECEIPT_INCLUDE });
    const after = computeDashboardCounts(
      rows.map((r) => ({ stageData: assembleStageData(r), branches: assembleBranches(r), source: r.source as "imported" | "entered" }))
    );
    const before = computeDashboardCounts(
      rows.map((r) => ({ stageData: JSON.parse(r.stageDataShadow!), branches: assembleBranches(r), source: r.source as "imported" | "entered" }))
    );
    expect(after).toEqual(before);
    // The six hardcoded figures this test used to assert (totalReceived: 50, acceptedUnloaded: 35,
    // grnCompleted: 27, pendingQa: 5, pendingUnload: 4, rejected: 6) were never a real measurement
    // of any workbook — the original 50-receipt demo seed's status spread came from a
    // random.seed(42) generator (tools/extract-seed.py's old TIERS/pick_tier), not real branch
    // decisions. Asserting them here gave a false impression of doc §3 conformance. The
    // self-consistency check above (after === before) is the real invariant this test protects —
    // that a receipt's derived status is unaffected by normalization — and it needs no fixed
    // baseline to stay meaningful.
  });

  it("the GRN-quantity rule leaves every imported receipt where its workbook put it", async () => {
    // Oct 2026: a receipt is GRN-completed only once its GRN quantity is recorded. The real 2026 Truck
    // Reception sheet has no such column, so most imported receipts have a price and no quantity —
    // applying the rule to them would silently demote them all. They are reported (data quality), not changed.
    const rows = await prisma.receipt.findMany({ where: { ...SEED_ONLY, stageEntries: { some: { stageId: "n-grn" } } }, include: RECEIPT_INCLUDE });
    const withoutQuantity = rows.filter((r) => !(((r as { grn?: { grnWeight: string | null } | null }).grn?.grnWeight) ?? "").trim());
    expect(withoutQuantity.length).toBeGreaterThan(500); // the gap is real and large — keep it visible
    for (const r of withoutQuantity) {
      const status = deriveStatus({ stageData: assembleStageData(r), branches: assembleBranches(r), source: r.source as "imported" | "entered" });
      expect(["grn_completed", "in_stock", "in_drying", "transferred_out", "rejected"], `${r.id} is ${status}`).toContain(status);
    }
  });

  it("n-stock is never auto-created — real data confirms zero stock postings today", async () => {
    const withGrn = await prisma.stageEntry.findMany({
      where: { stageId: "n-grn", receipt: SEED_ONLY }, select: { receiptId: true },
    });
    const withStock = new Set(
      (await prisma.stageEntry.findMany({
        where: { stageId: "n-stock", receipt: SEED_ONLY }, select: { receiptId: true },
      })).map((e) => e.receiptId)
    );
    // The new Truck Reception importer (truckReception.ts / tools/extract-seed.py's
    // build_stage_data) never produces an n-stock stage at all — Lot/Bin/Drying/Transfer stages
    // are only ever written by their own dedicated importers (DISCHARGEMENT, Drying Batch, etc.),
    // never inferred from a GRN. So every one of the 935 seeded receipts with a GRN stage stays
    // capped at grn_completed; withStock is always empty until a later stage is imported for one.
    expect(withStock.size).toBe(0);
    const grnOnly = withGrn.filter((e) => !withStock.has(e.receiptId));
    expect(grnOnly.length).toBe(935);
  });

  it("cross-checks derived status against the real pre-migration live-DB snapshot, matched by " +
     "content (vehicleNo/arrivalDate/supplierName), not by id", async () => {
    // tests/fixtures/pre-migration-status-oracle.json was captured from the live dev DB's 986
    // receipts BEFORE this seed was regenerated from the new sheets — at that point, many receipts
    // had accumulated real interactive progress (QFS decisions, unloading, GRN entry, drying,
    // transfers) through actual day-to-day use of the app, entered progressively as trucks moved
    // through each physical step. The regenerated seed instead bulk-imports the client's completed
    // Truck Reception workbook, which already has columns like PRICE/AMOUNT filled in retrospectively
    // for nearly every real row — so a receipt that the oracle caught mid-workflow (still
    // pending_qa, still awaiting unloading, etc.) now derives straight to grn_completed, its true
    // final state per the finished spreadsheet. That is a real, expected consequence of moving from
    // "a live app's in-progress state" to "a bulk import of a retrospectively-completed workbook" —
    // not a normalization defect. What WOULD be a defect: a mismatch landing anywhere other than
    // grn_completed (the ceiling truckReception.ts's importer can reach on its own, since it never
    // writes Lot/Drying/Transfer stages or any branch decision).
    const oracle = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, "fixtures/pre-migration-status-oracle.json"), "utf8")
    ) as { vehicleNo: string; arrivalDate: string; supplierName: string; status: string }[];

    const rows = await prisma.receipt.findMany({ include: RECEIPT_INCLUDE });
    // The supplier compares without its old "RCN" prefix: the fixture predates dropping it, and the database may be either side of that change.
    const key = (v: string, a: string, s: string) => `${v.trim()}|${a.trim()}|${supplierNameKey(s)}`;

    const dbByKey = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = key(r.vehicleNo ?? "", r.arrivalDate ?? "", r.supplierName ?? "");
      (dbByKey.get(k) ?? dbByKey.set(k, []).get(k)!).push(r);
    }
    const oracleByKey = new Map<string, typeof oracle>();
    for (const o of oracle) {
      const k = key(o.vehicleNo, o.arrivalDate, o.supplierName);
      (oracleByKey.get(k) ?? oracleByKey.set(k, []).get(k)!).push(o);
    }

    // Real truck data has occasional genuine duplicate (vehicle, date, supplier) triples — same
    // truck, same supplier, more than one load the same day. Only compare where the key is unique
    // on BOTH sides, so a comparison is never scrambled by picking the wrong one of several
    // same-key candidates.
    let compared = 0, matched = 0;
    const unexpectedMismatches: string[] = [];
    for (const [k, oEntries] of oracleByKey) {
      if (oEntries.length !== 1) continue;
      const dEntries = dbByKey.get(k);
      if (!dEntries || dEntries.length !== 1) continue;
      compared++;
      const r = dEntries[0];
      const now = deriveStatus({ stageData: assembleStageData(r), branches: assembleBranches(r), source: r.source as "imported" | "entered" });
      if (now === oEntries[0].status) { matched++; continue; }
      if (now !== "grn_completed") unexpectedMismatches.push(`${k}: oracle=${oEntries[0].status} now=${now}`);
    }

    expect(compared).toBeGreaterThan(900); // the join itself must still work at scale
    expect(unexpectedMismatches).toEqual([]);
    // Measured directly against the live snapshot: 931 of 976 uniquely-matched receipts derive the
    // exact same status; the other 45 all move forward to grn_completed for the reason above.
    expect(matched).toBe(931);
  });
});
