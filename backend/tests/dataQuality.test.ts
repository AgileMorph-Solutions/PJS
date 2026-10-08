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

    // The new Truck Reception importer (and tools/extract-seed.py) never writes a branch decision
    // at all — rejection is always a human decision recorded later, never inferred from a column.
    // With 0 receipts carrying an n-qfs "fail" branch, this check has nothing to report; the old
    // 6-receipt figure came from the previous demo seed's fabricated branch data, not this source.
    expect(by["rejected_without_reason"]).toBeUndefined();
    // The DIFF column is degenerate on every one of ledger 4's rows (415, not 367, since ledger 4's
    // source became the newer, larger Bouake RCN Receiving at Factory Report.xlsx).
    expect(by["ledger4_diff_degenerate"]?.affectedCount).toBe(415);
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
    // back to the sheet's own verbatim "YAMOUSSOUKRO" the moment anyone re-uploads that file —
    // observed directly this session: 0 right after a container restart (backfill ran last), 1
    // once Warehouse Receiving is (re-)imported afterward (import ran last). Asserting the
    // structural fact (never more than the single ANAGROCI-01 row) rather than picking one side of
    // a flip this suite doesn't control the ordering of.
    expect(by["store_site_not_canonical"]?.affectedCount ?? 0).toBeLessThanOrEqual(1);
    // All 415 ledger-4 rows arrive at Yakro by column-header inference only ("Gross Weight (Yakro)
    // Recived" etc.), never a per-row cell — stays at the full row count until a sheet variant
    // states it per row.
    expect(by["transfer_destination_inferred"]?.affectedCount).toBe(415);
    // Ledger 1 (warehouse-stock) is BOUAKE-only (all 298 rows) — Yakro has no ledger of its own, so
    // all 415 TRANSFER_IN movements the destinationWarehouse column surfaces are unreconcilable
    // against anything. Real and expected, not a regression: TRANSFER_IN wasn't attributed to any
    // warehouse before this column existed.
    expect(by["transfer_in_has_no_ledger1_counterpart"]?.affectedCount).toBe(415);

    // The same physical batch is numbered differently at each site — e.g. one fiche is Lot 20 at
    // the unit warehouse and a different lot downstream. Measured per batch, joined on fiche; if
    // this ever drops to 0 the client has unified their numbering, which is a real event worth
    // noticing. Re-measured at 362 against the regenerated 986-receipt seed plus the real
    // DISCHARGEMENT/Warehouse Receiving imports (was 345 against the old, smaller data).
    expect(by["lot_namespace_disagreement"]?.affectedCount).toBe(362);

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
    // RETIRED, deliberately: this check compares DryingJob against DryingBatch for the same fiche,
    // but prisma/seed.ts no longer seeds DryingJob at all (DryingBatch is the sole replacement
    // source — see dryingBatches.ts's header) and no importer writes to DryingJob any more either.
    // With 0 DryingJob rows to compare, the check's own `if (!jobs.length...) return null` makes it
    // permanently inert — kept as dead code with this comment (like jute_balance_drift's own
    // retirement) rather than deleted, so the 33-of-81 finding that used to justify keeping
    // DryingJob as the live source stays legible even though it can no longer fire.
    expect(by["drying_batch_vs_drying_job_drift"]).toBeUndefined();
    // Issued to Production: its own "Fiche No" column is 109/125 dry-bin-code strings, not fiches —
    // verified directly, never joined on.
    expect(by["production_issue_fiche_column_contaminated"]?.affectedCount).toBe(109);
    // 18 distinct (Source Bin, DRY BIN) pairs observed — reported only, never normalised.
    expect(by["production_issue_source_dry_bin_pairs"]?.affectedCount).toBe(18);
    // 8 of the distinct BTMs in the sheet have no matching BtmIntake in the live production master
    // (104 rows, seeded by prisma/seedProduction.ts) — btmNo stays a soft reference; never
    // auto-created. Re-measured at 8 (was 9) against the current production seed.
    expect(by["production_issue_btm_not_in_production_master"]?.affectedCount).toBe(8);
  });

  it("reports what the client's Oct 2026 feedback found in the real data, with measured counts", async () => {
    const { checks } = await scanAll();
    const by = Object.fromEntries(checks.map((c) => [c.id, c]));
    // The 3 stores BKE-001/002/003 that seed/bins.json built the Bin master from — "BKE-001" isn't a place in a store.
    expect(by["bin_code_is_store_code"]?.affectedCount).toBe(3);
    // One voyage number is on two different trucks in the dispatch report.
    expect(by["transfer_voyage_multiple_trucks"]?.affectedCount).toBe(1);
    // 347 of ledger 4's 415 transfer rows carry a bare number (or another prefix), not a BKT number.
    expect(by["transfer_id_not_bkt"]?.affectedCount).toBe(347);
    // Two receiving-warehouse Lot numbers each sit on two different transfers.
    expect(by["received_lot_on_multiple_voyages"]?.affectedCount).toBe(2);
    // 935 imported receipts have a GRN stage (a price) and no GRN quantity: the 2026 sheet has no such column.
    expect(by["grn_quantity_not_recorded"]?.affectedCount).toBe(935);
    // Nothing was applied from the client's workbook here (the parity test applies it inside a rolled-back
    // transaction), so no placeholder reasons and no plan without a store exist yet.
    expect(by["rejection_reason_is_placeholder"]).toBeUndefined();
    expect(by["delivery_plan_missing_store"]).toBeUndefined();
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
