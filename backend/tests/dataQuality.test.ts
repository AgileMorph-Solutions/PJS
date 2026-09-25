/**
 * The data-quality audit, asserted against the measured reality of the client's workbooks.
 *
 * These counts are not arbitrary: each was measured from the source data. If one changes, either
 * the data changed or something started silently "cleaning" it — both worth failing over.
 */
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { scanAll } from "../src/domain/dataQuality/index.js";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe("data-quality audit", () => {
  it("reports the known findings with their measured counts", async () => {
    const { checks } = await scanAll();
    const by = Object.fromEntries(checks.map((c) => [c.id, c]));

    // 6 receipts arrive already rejected with no reason in the source sheet.
    expect(by["rejected_without_reason"]?.affectedCount).toBe(6);
    // The DIFF column is degenerate on every one of ledger 4's rows.
    expect(by["ledger4_diff_degenerate"]?.affectedCount).toBe(367);
    // The negative running balance is real and preserved.
    expect(by["jute_balance_negative"]?.affectedCount).toBe(35);
    // Ledger 1 records 3 transfers out against ledger 4's 367 inbound.
    expect(by["transfer_out_undercounted"]).toBeTruthy();
    // Origins observed in an upload but not in the curated master: 7 from the transfer sheet, 11
    // from the unit-warehouse discharge sheet (two of those 11 are one town spelled two ways), and
    // — the step 8 re-baseline the plan itself predicted — 41 more from Warehouse Receiving's
    // Yamoussoukro-side rows (18 -> 59). Drying Batch's own originRaw is deliberately NOT promoted
    // to this master (it's a "raw" column for reporting only, same discipline as its lotNoRaw).
    expect(by["origin_not_in_master"]?.affectedCount).toBe(59);
    // Ledgers 2 and 3 have no row-level source at all.
    expect(by["ledger_has_no_row_level_source"]?.affectedCount).toBe(2);
    // Closed by prisma/seed.ts's backfillWarehouseTypology: the ANAGROCI-01 -> Yakro mapping used
    // to be a filename-only inference; the consolidated workbook states it in a real column, so the
    // alias row was upgraded to "stated-in-source" and this check has nothing left to report.
    expect(by["warehouse_alias_inferred"]).toBeUndefined();
    // The upgrade above shows up here instead: 2 real alternate names for one site (ANAGROCI-01 as
    // a store, YAMOUSSOUKRO as the receiving sheet's own site name), both stated, not guessed.
    expect(by["warehouse_site_name_variants"]?.affectedCount).toBe(2);
    // The two free-text "Warehouse type" stage columns are never written — the kind comes from the
    // Warehouse master instead. Stays 0 unless something starts hand-typing a second copy.
    expect(by["stage_warehouse_type_shadows_master"]).toBeUndefined();
    // This one OSCILLATES, genuinely, and that's a real bug worth fixing (not this pass — no
    // backend changes were in scope here): prisma/seed.ts's backfillWarehouseTypology() sets
    // ANAGROCI-01.site to the canonical "YAKRO FACTORY" on every container start, unconditionally;
    // committing the real Warehouse Receiving workbook (services/imports.ts's
    // upsertObservedStores(), `update: { site }` with no "already canonical?" check) overwrites it
    // back to the sheet's own verbatim "YAMOUSSOUKRO" the moment anyone re-uploads that file. This
    // assertion reflects state right after a fresh seed (0); re-committing Warehouse Receiving
    // flips it to 1 again without any code change here. resolveSite() is unaffected either way
    // (WarehouseAlias covers both names) — only Warehouse.site itself flaps.
    expect(by["store_site_not_canonical"]).toBeUndefined();
    // All 367 ledger-4 rows arrive at Yakro by column-header inference only ("Gross Weight (Yakro)
    // Recived" etc.), never a per-row cell — stays 367 until a sheet variant states it per row.
    expect(by["transfer_destination_inferred"]?.affectedCount).toBe(367);
    // Ledger 1 (warehouse-stock) is BOUAKE-only (all 298 rows) — Yakro has no ledger of its own, so
    // all 367 TRANSFER_IN movements the new destinationWarehouse column surfaces are unreconcilable
    // against anything. Real and expected, not a regression: TRANSFER_IN wasn't attributed to any
    // warehouse before this column existed.
    expect(by["transfer_in_has_no_ledger1_counterpart"]?.affectedCount).toBe(367);

    // The same physical batch is numbered differently at each site — e.g. fiche 72566 is Lot 17 at
    // the unit warehouse and Lot 20 downstream. Measured per batch, joined on fiche; if this ever
    // drops to 0 the client has unified their numbering, which is a real event worth noticing.
    expect(by["lot_namespace_disagreement"]?.affectedCount).toBe(345);

    // The import-fidelity guard: the workbook's balance never disagrees with its own arithmetic.
    expect(by["jute_balance_drift"]).toBeUndefined();
    // Closed by the unit-warehouse discharge import: every binned receipt now has a real Lot.
    // A reappearance means bins are being allocated before the Lot that makes them traceable.
    expect(by["bin_allocated_without_lot"]).toBeUndefined();

    // Step 8's four new importers — all measured against the real workbooks, same discipline.
    // Drying Batch: 22 rows carry a genuinely unsplittable lot value (11 comma/slash-joined, 11
    // numerically concatenated 6-digit values) — lotNo stays null for all of them.
    expect(by["drying_batch_multi_lot"]?.affectedCount).toBe(22);
    // A THIRD, separate contamination: 41 rows hold a bin code in the lot column, not a lot at all.
    expect(by["drying_batch_lot_column_holds_bin_code"]?.affectedCount).toBe(41);
    // The reconciliation the plan required before considering DryingBatch a DryingJob replacement:
    // 33 of the 81 central DryingJob rows disagree with their matched DryingBatch row on date,
    // status, and/or destination — NOT clean, so DryingJob stays the live source (see that check's
    // own evidence text, and this suite's final report, for the full reasoning).
    expect(by["drying_batch_vs_drying_job_drift"]?.affectedCount).toBe(33);
    // Issued to Production: its own "Fiche No" column is 109/125 dry-bin-code strings, not fiches —
    // verified directly, never joined on.
    expect(by["production_issue_fiche_column_contaminated"]?.affectedCount).toBe(109);
    // 18 distinct (Source Bin, DRY BIN) pairs observed — reported only, never normalised.
    expect(by["production_issue_source_dry_bin_pairs"]?.affectedCount).toBe(18);
    // 9 of the 112 distinct BTMs in the sheet have no matching BtmIntake in the live production
    // master (103 rows) — btmNo stays a soft reference; never auto-created.
    expect(by["production_issue_btm_not_in_production_master"]?.affectedCount).toBe(9);
  });

  it("findings are aggregate, never one per row", async () => {
    const { checks } = await scanAll();
    for (const c of checks) expect(c.sampleIds.length).toBeLessThanOrEqual(5);
  });

  it("sorts the most serious findings first", async () => {
    const { checks } = await scanAll();
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    const seq = checks.map((c) => rank[c.severity]);
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
  });
});
