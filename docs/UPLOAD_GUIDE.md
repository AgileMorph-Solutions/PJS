# Uploading real workbooks — what goes where, and why

This app can import 5 real workbook shapes directly through the UI (**Import Data** in the sidebar,
or `POST /api/imports/preview` → `POST /api/imports/:token/commit` if you're calling the API
directly). This document is the map: which file feeds which part of the app, what's deliberately
*not* supported, and the rules the importer enforces so an upload can't silently corrupt real data.

Every upload is **preview → commit**, never a direct write. Preview parses the file, checks its
shape, and reports findings (possible duplicates, odd rows) without touching the database. Nothing
is written until you explicitly commit that preview.

## The mapping table

| Source file (as seen from the client) | Sheet, header row | Feeds | Dedup key |
|---|---|---|---|
| `Rcn Offloading Details 2026.xlsx` | `OFFLOADINGS`, row 2 | `Receipt` + its stage tables (RCN Receipts) | none in the source — a content-key heuristic (vehicle + arrival date + supplier), flagged for review |
| `Drying Report_Factory warehouse.xlsx` | `FINAL DRY RCN-YAKRO-2026`, row 2 | `DryingJob` (Drying Jobs) | the sheet's own S.No. (`id`), a real source key |
| `BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx` | `JUTE BAGS ISSUED`, row 2 | `JuteWarehouseMovement` (Warehouse Stock) | none in the source — a content-key heuristic (date + activity + bag counts + truck/W-R no.), flagged for review |
| `BOUAKE RCN RECEIVING at Yamoussoukro as on 9.9.2026.xlsx` | `Bouake Stock Reciving`, row 6 | `JuteWarehouseTransferReceipt` (Warehouse Transfers) | the sheet's own SN, a real source key |
| `Suppliers Offloading_Bouake Warehouse Report.xlsx` | `DISCHARGEMENT`, row 4 | `WarehouseDischarge` (new, verbatim) **+ writes the real Lot Number onto the matching Receipt** | the sheet's own Lot No, a real source key — see "The Lot write-back" below |

A file's actual name doesn't have to match the examples above exactly — detection reads the sheet
name and header row, not the filename. What has to match is the **shape**: the right sheet name
present, with the right header labels in the right order at the right row. See "The corruption
case" below for why that check exists and isn't just a sheet-name match.

## What's explicitly not supported, and why

- **`ANAGROCI RCN Purchase Supply chain.xlsx`** — a flowchart diagram, not tabular data. Nothing to
  import.
- **`SUPPLIER OFFLOADING - Factory warehouse 9.9.2026.xlsx`** and
  **`drive-download-.../SUPPLIER OFFLOADING -FACTORY.xlsx`** — an undated hand tally with no
  per-row transaction structure. The original seed script (`tools/extract-jute.py`) never
  row-extracts these either, for the same reason. **This was fixed in a later export** —
  `Suppliers Offloading_Bouake Warehouse Report.xlsx`'s `DISCHARGEMENT` sheet is the same real data
  properly dated and structured, and is importable (see the mapping table above). If the client
  keeps sending the old undated shape alongside the new one, only the new one should be uploaded.
- **`Dispatch RCN from Bouake Warehouse Report.xlsx`** (`CHARGEMENT`) — the unit-warehouse's own
  outbound/dispatch log. Real, dated, and well-formed, but **not yet wired to an importer**: it has
  no Lot column at all (only Bin + W/H Receipt No.), so it can't feed the Lot-first model the same
  way `DISCHARGEMENT` does. Left for a later pass — see the plan history for what was measured
  against it.
- **`Bouake RCN Receiving at Factory Report.xlsx`** — a newer export of the *same shape* the
  `Warehouse Transfers` row above already imports (`Bouake Stock Reciving`, 39 columns, header row
  6, byte-identical to `juteWarehouseTransferImporter`'s expected header). Upload it as
  **Warehouse Transfers** — no separate row or importer needed; the existing SN-keyed dedup means a
  second upload only adds what's genuinely new.
- Everything else under `docs/Procurement/drive-download-.../`, e.g.
  `Compressor Running Hours.xlsx`, `SHIPPING INS LIST.xlsx`, and the `Maintenance
  Report-Digitalization/` files — maintenance, shipping, and utility logs with no relationship to
  any model this app tracks. No importer reads them, and none is planned.

## The corruption case that shapes this whole design

While building this, checking every real file under `docs/Procurement/` directly (not just by
name) turned up a real problem: `drive-download-.../BOUAKE RCN RECEIVING.xlsx` has a sheet also
named `Bouake Stock Reciving` — but with **33 columns instead of 39**, missing `DRY/UNDRY` and
`Transfer -Bouake`. If detection matched on sheet name alone, this file would be accepted as a
warehouse-transfer upload, and every field read from column 15 onward would silently come from the
*wrong* column — not a parse error, a fully-populated-looking row with every field quietly wrong.

Because of this, **no importer here ever matches on sheet name alone.** Every one of the 5 shapes
also verifies the exact header-row label list — trimmed, in order — at the sheet's expected header
row, on both auto-detection and a manual shape override. A mismatch is a hard rejection, shown as
expected-vs-actual header text, never a best-effort guess. Uploading that exact corrupted file as
"Warehouse Transfers" is rejected this way — see `backend/src/domain/imports/headerCheck.ts` and
`backend/tests/imports.test.ts` for the enforcement and the regression test.

**A second, narrower variant of the same problem showed up in `DISCHARGEMENT`.** That sheet has two
quality-reading panels side by side — the same 16 column labels, twice (`"BROWNS/Rejection (gm)"`,
`"KOR"`, `"Moisture"`, …), distinguished only by a banner one row above each block (`"…(Sampling
Report)"` vs `"…(Final Offloading Report)"`). The header-row check alone can't tell them apart: if
the two blocks were ever swapped, the header row would still fingerprint as a perfect match while
every quality reading was filed under the wrong sampling pass. So the importer framework grew a
second, optional check — `expectedAnchors` — that pins specific cells *outside* the header row for
shapes where the header alone is ambiguous. `warehouseDischargesImporter` is the one importer that
uses it today; every other importer passes none and behaves exactly as before.

## The receipts importer's per-stage presence rule

`OFFLOADINGS` doesn't record which of the ~16 process stages a truck reached — it just has whatever
columns it has. Rather than fabricate a spread of progress (the original seed script's `TIERS`
system does this, but only to make a 50-row *demo* sample look realistic — it is demo scaffolding,
not a model of real truck progress, and the importer does not use it), each stage is created for an
imported receipt **if and only if at least one of its mapped source columns is non-empty** in that
row. Two deliberate exceptions:

- **Tare weighing (`n-tare`) is always created, present but empty.** The client's own process notes
  confirm every truck physically passes tare weighing, even though `OFFLOADINGS` has no column for
  it — this already matches the existing `tare_never_recorded` data-quality finding.
- **Bin, Stock, Drying, Other Activity, Ledger, Transfer decision, and Rejection
  (`n-bin`/`n-stock`/`n-drying`/`n-otheract`/`n-ledger`/`n-xferdec`/`n-reject`) are never created
  by the receipts importer.** `OFFLOADINGS` captures none of them, so creating them would invent
  progress that never happened. Quality analysis (`n-qfs`) is created when moisture/KOR fields are
  present, but its pass/fail branch is deliberately left **unset** — the sheet has no real
  pass/fail signal to read, and guessing one would be fabrication. An admin records that decision
  afterward through the normal receipt UI, exactly as with any other receipt.
- **Lot (`n-lot`) is the one exception, and it comes from a different importer, not this one.**
  `OFFLOADINGS` still has no Lot column, so the receipts importer itself never creates `n-lot` —
  but the `DISCHARGEMENT` sheet (the `WarehouseDischarge` row above) is where a Lot is actually
  *assigned*, and importing it writes the real Lot Number onto the matching receipt. See "The Lot
  write-back" below.

## The Lot write-back (client call, Sept 2026: Lot, not FICHE, is the tracking key)

`DISCHARGEMENT` is the unit-warehouse offloading record — the point in the client's own process
where a Lot Number is assigned. Every one of its 454 rows carries both a Lot and the truck's
arrival FICHE, so importing it does two things, in order:

1. **Stores the sheet verbatim** in `WarehouseDischarge`, all 64 real columns — the same
   fabricate-nothing rule every other importer here follows.
2. **Writes that Lot onto the Receipt** the FICHE identifies — the only way a receipt ever gets a
   real Lot Number, since `OFFLOADINGS` has none. This is a genuine write-back, not just a new
   table, so it has its own conflict rules, all reported and never silently applied:
   - **FICHE doesn't match any receipt** → skipped, reported (`fiche_not_matched`). Expected the
     first time a newer workbook arrives ahead of the receipts sheet.
   - **Two rows in the sheet claim the same FICHE** → skipped for both, reported
     (`fiche_duplicated_in_sheet`). Which Lot belongs to the receipt is unknowable; never
     "first row wins".
   - **That Lot is already held by a different receipt** in the same warehouse → skipped, reported.
     Reassigning would silently move a Lot between trucks.
   - **The receipt already holds that exact Lot** → a genuine no-op — this is what makes
     re-uploading the same file safe to do repeatedly.

**Lot uniqueness is enforced per warehouse, not globally.** Measured directly: the same physical
batch is a *different* Lot Number at each site — e.g. fiche `72566` is Lot 17 at the unit warehouse
and Lot 20 at the central warehouse (334 of 339 fiche-matched transfers, and 12 of 12 drying rows,
disagree this way). Each site runs its own 1..N sequence, so a Lot number only means something
together with its warehouse — the `lot_namespace_disagreement` data-quality check reports every
disagreement it finds, and the receipt detail page's "Linked records" card shows both numbers side
by side rather than picking one.

## Dedup policy, per importer

- **Drying Jobs, Warehouse Transfers, and Warehouse Discharges (Lot assignment)** have a real
  source-provided unique key (the sheet's own S.No. / SN / Lot No). Re-uploading the same file is a
  plain database-level skip: rows whose key already exists are silently not re-inserted, and this
  is safe to do repeatedly. The Lot write-back on top of the discharge import has its own separate
  conflict handling — see above.
- **RCN Receipts and Warehouse Stock have no such key** in the source — a receipt is identified by
  vehicle + date + supplier, and a warehouse-stock row's own `S N` column has real duplicates in the
  source data, so it can't serve as one either (its `seq` is an artificial ordering key this app
  assigns, not something the sheet provides). For these two, a likely-duplicate row is **flagged as
  a finding, never silently dropped or silently written** — matching this app's standing rule that a
  data-quality concern surfaces rather than blocks. At commit time, "skip rows that look like
  duplicates" is on by default; turning it off writes them anyway, since a flagged row might
  legitimately not be a duplicate.

## If the client sends an updated or reshaped version of one of these files

Update the corresponding `expectedHeader` list in `backend/src/domain/imports/registry.ts` (in the
specific importer file — `offloadings.ts`, `drying.ts`, `juteWarehouseStock.ts`,
`juteWarehouseTransfer.ts`, or `warehouseDischarges.ts`) and this document together, so they can't
drift apart. This is the same "keep in sync by hand" discipline `packages/contract/src/data/stages.ts`
already asks for with the client's original HTML process maps — there is no automatic way to detect
that a real-world sheet changed shape, so the header-fingerprint check (see "The corruption case"
above) is what catches a mismatch at upload time rather than a schema diff at review time.

**Reproducing the current numbers.** Everything measured in this document and in the tests that
assert it comes from one fixed sequence: `npm -w backend run seed`, then import the 4 original
shapes (receipts, drying, warehouse-stock, warehouse-transfer) in any order, then import
`DISCHARGEMENT` last (it writes onto receipts the earlier imports must already exist). Importing it
before the receipts it should match onto would just report more `fiche_not_matched` rows — safe,
but re-uploading afterward is what actually attaches the Lots.
