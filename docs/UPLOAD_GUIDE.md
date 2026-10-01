# Uploading real workbooks — what goes where, and why

## The ANAGROCI workbook (what Upload and Export use now)

There is **one file format**, in plain words — not the client's Excel layouts, and not database
names. Export downloads it; Upload takes the same file back. It is one `.xlsx` with one sheet for each
kind of record, and every column header is ordinary words ("Arrival Date", "Price (CFA/kg)"). It
opens on **Truck Reception**. The headers follow the client's own sheets in
`docs/Procurement/new sheets/`, minus their pivot-table leftovers and duplicate columns.

**It differs only by section.** Which warehouse you are in decides which sheets the file carries and
whose rows it holds:

| Sheet | Unit | Central | What it is |
|---|---|---|---|
| **Truck Reception** | ✓ | ✓ | One row per truck: dates, supplier, truck, fiche, quality (moisture, nut count, KOR), weights, bags, price, lot, bin |
| **Warehouse Receiving** | ✓ | ✓ | Per lot: bins, bags by type, weights, GRN, and the lab results in full — Bouaké's **Sample** and **Final** panels, or Yakro's (which add Murli) |
| **Drying** | ✓ | ✓ | Drying batches |
| **Stock Transfers** | ✓ | ✓ | Bouaké → Yakro transfers |
| **Activity Ledger** | ✓ | ✓ | The warehouse activity log |
| **Suppliers** | ✓ | ✓ | Supplier code and name |
| **Drying & Sorting**, **Dispatch**, **Jute Bags** | ✓ | | Unit only |
| **Issued to Production** | | ✓ | Central only |

**What it asks for, and what it doesn't.** Only what people provide. It leaves out the app's own
columns (where a row came from, timestamps, internal numbers), anything the app works out (a
receipt's status, a jute running balance, weight and bag differences, loss %), and the warehouse a row
belongs to — the section already decides that, and a new row gets this warehouse. Where the database
holds a hand-typed value only as text (a date written "13-01-2026"), it appears in an extra
"… (as written)" column so it isn't hidden. Bins, origins and warehouses are managed in the app, not
in the file (a new origin town typed on Truck Reception is simply added).

**The rules** (the same in both directions):
- **Leave the first column empty to add a row** (Receipt ID / Row ID); the app assigns it, and the next
  "No" where a sheet has one. A known id updates that row. An id that doesn't exist is an error, never
  a quiet create.
- **Nothing is ever deleted.** A row missing from the file stays in the database — so a date-filtered
  export is safe to upload.
- **Only cells that differ are written.** Exporting and uploading a file unchanged writes nothing — no
  row, no audit entry, no `updatedAt`. That is also why a record that already breaks a rule (a rejected
  truck with no reason) isn't re-judged by an upload that doesn't touch it. A column you delete from
  the file leaves that field alone; it never blanks it.
- **Nothing is guessed.** Dates must be `YYYY-MM-DD`, numbers use a decimal point; a value that doesn't
  fit is reported with its sheet, row and the column's own header. Sheet and column names are matched
  ignoring case and spacing; a sheet or column we don't use is ignored, with a notice.
- **Preview first, then apply.** Upload shows new / changed / unchanged per sheet and every problem.
  **Apply** re-checks against the database and writes in ONE transaction: any problem writes nothing.
- **Truck Reception goes through the app's own stage code**, so the lot-uniqueness, lot-before-bin and
  "a failed quality check needs a reason" rules apply, each change is audited (`via = import`), and
  there is one timeline entry per receipt. Changing a receipt's supplier, supplier code, truck no or
  arrival date also updates the matching step, so the two never disagree. Quality Result is typed as
  Pass or Fail.
- **Scope.** A Warehouse Incharge works on their own warehouse; an admin picks one. A row must belong to
  that warehouse — before and after the change. Rows with no warehouse set aren't in a section's file.

Everything below this line documents the **earlier client-workbook importers** (Truck Reception,
CHARGEMENT, Jute Bags movement, …). They are no longer offered in the UI; the code, the `/api/imports/*`
routes and their tests remain because the real data came in through them.

---

# Client-workbook importers (history)

This app can import 11 real workbook shapes directly through the UI — each importer panel lives
embedded on the one page its rows belong to (Reception, Lots & Bins, Drying, Jute ▸ Warehouse
Stock/Transfers, Masters ▸ Suppliers — see each page's own "Import ..." card), or
`POST /api/imports/preview` → `POST /api/imports/:token/commit` if you're calling the API directly.
This document is the map: which file feeds which part of the app, what's deliberately *not*
supported, and the rules the importer enforces so an upload can't silently corrupt real data.

**Only the workbooks under `docs/Procurement/new sheets/` are referenced anywhere in this app.**
The earlier client exports (`Rcn Offloading Details 2026.xlsx`, `Drying Report_Factory
warehouse.xlsx`, `BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx`, and everything under the old
`drive-download-.../` folder) have been deleted from the repo entirely — they're superseded by the
6 files below, not a second valid source to keep uploading alongside them.

Every upload is **preview → commit**, never a direct write. Preview parses the file, checks its
shape, and reports findings (possible duplicates, odd rows) without touching the database. Nothing
is written until you explicitly commit that preview.

## The mapping table

| Source file (`docs/Procurement/new sheets/`) | Sheet, header row | Feeds | Dedup key |
|---|---|---|---|
| `ANAGROCI DATA PROCUREMENT 2026.xlsx` | `Truck Reception`, row 1 | `Receipt` + its stage tables (Reception, 986 real rows) | none in the source — a content-key heuristic (vehicle + arrival date + supplier), flagged for review |
| `ANAGROCI DATA PROCUREMENT 2026.xlsx` | `Jute Bags movement`, row 1 | `JuteWarehouseMovement` (Jute ▸ Warehouse Stock, 298 real rows) — no BALANCE column in this export, so `reportedBalance` stays null on every row | none in the source — a content-key heuristic, flagged for review |
| `ANAGROCI DATA PROCUREMENT 2026.xlsx` | `Suppliers`, row 1 | `Supplier` (Masters ▸ Suppliers) — the canonical supplier master, 58 real rows | the sheet's own supplier code |
| `ANAGROCI DATA PROCUREMENT 2026.xlsx` | `Drying Batch`, row 1 | `DryingBatch` (Drying page's primary source, both sites — 138 rows = 57 Bouaké + 81 central) | `(warehouse, sn)` — not `(warehouseSite, sn)`: every central row's `warehouseSite` cell is blank, and Postgres never treats two NULLs as a duplicate |
| `ANAGROCI DATA PROCUREMENT 2026.xlsx` | `Warehouse Receiving`, row 1 | `WarehouseDischarge` (verbatim only — never writes a Lot back onto a receipt, unlike the `DISCHARGEMENT` importer below) — 710 rows = the same 454 Bouaké rows `DISCHARGEMENT` already has, plus 256 genuinely new Yamoussoukro-side rows | the sheet's own (site, Lot No) — the same composite key `DISCHARGEMENT` uses, which is exactly what makes committing both safe |
| `ANAGROCI DATA PROCUREMENT 2026.xlsx` | `Warehouse activity Ledger`, row 1 | `WarehouseActivityLedgerEntry` (its own table, not a receipt stage — this sheet has no site column at all, verified, so it can't be scoped to a warehouse) — 787 rows | `(source, sheetRow)` — a surrogate key; no natural one exists |
| `Suppliers Offloading_Bouake Warehouse Report.xlsx` | `DISCHARGEMENT`, row 4 | `WarehouseDischarge` (new, verbatim) **+ writes the real Lot Number onto the matching Receipt** | the sheet's own Lot No, a real source key — see "The Lot write-back" below |
| `Dispatch RCN from Bouake Warehouse Report.xlsx` | `CHARGEMENT`, row 4 | `WarehouseDispatchLine` (Reception's "dispatched" status flag) — one row per LINE, not per document; 544 real lines, only 424 carry a clean S.No | `(source, sheetRow)` — a surrogate key. Neither the sheet's own S.No. (10 duplicates) nor its voyage number (40 lines lack one) is unique enough on its own |
| `Bouake RCN Receiving at Factory Report.xlsx` | `Bouake Stock Reciving`, row 6 | `JuteWarehouseTransferReceipt` (Jute ▸ Warehouse Transfers, ledger 4) — 415 real rows | the sheet's own SN, a real source key |
| `Bouake RCN Drying Report.xlsx` | `Drying & Sorting Report`, row 2 | `DryingSortingReport` (Drying page's secondary, Bouaké-only detail) — 57 real rows (columns 1-31 only; 32-33 are a stray duplicate-label pair, 36-41 an embedded pivot) | `(source, sheetRow)` — a surrogate key |
| `Factory Warehouse RCN Transfer to Production Report.xlsx` | `Issued to Production Section`, row 5 | `IssuedToProduction`, a BTM-spine production table (125 real rows / ~112 distinct BTMs; `btmNo` is a **soft** reference — some have no matching `BtmIntake`, reported not fabricated) | `(source, sheetRow)` — a surrogate key |

A file's actual name doesn't have to match the examples above exactly — detection reads the sheet
name and header row, not the filename. What has to match is the **shape**: the right sheet name
present, with the right header labels in the right order at the right row. See "The corruption
case" below for why that check exists and isn't just a sheet-name match.

## What's explicitly not supported, and why

- **`Delivery Plan` / `Quality Inspection`** (two more sheets inside `ANAGROCI DATA PROCUREMENT
  2026.xlsx`) — empty templates with no real rows. Documented as such, never imported.
- Anything outside `docs/Procurement/new sheets/` — the earlier client exports this app used to
  read have been deleted from the repo (see the note at the top of this document). If the client
  sends a workbook under some other name, check its actual sheet/header shape against the mapping
  table above rather than assuming it's a new source.

## The corruption case that shapes this whole design

While building this, checking a real early client export directly (not just by name) turned up a
real problem: a file had a sheet also named `Bouake Stock Reciving` — but with **32 columns instead
of 34**, missing `DRY/UNDRY` and `Transfer -Bouake`. If detection matched on sheet name alone, this
file would be accepted as a warehouse-transfer upload, and every field read from column 15 onward
would silently come from the *wrong* column — not a parse error, a fully-populated-looking row with
every field quietly wrong.

Because of this, **no importer here ever matches on sheet name alone.** Every one of the 11 shapes
also verifies the exact header-row label list — trimmed, in order — at the sheet's expected header
row, on both auto-detection and a manual shape override. A mismatch is a hard rejection, shown as
expected-vs-actual header text, never a best-effort guess. See
`backend/src/domain/imports/headerCheck.ts` and `backend/tests/imports.test.ts` (which reproduces
this exact shape synthetically, in memory, now that the original corrupt file is gone) for the
enforcement and the regression test.

**One consolidated workbook, `ANAGROCI DATA PROCUREMENT 2026.xlsx`, legitimately matches SIX
different importers** (`Truck Reception`, `Jute Bags movement`, `Suppliers`, `Drying Batch`,
`Warehouse Receiving`, `Warehouse activity Ledger` all live in it as separate sheets) —
`detectImporter`'s auto-detection tries every known shape and reports however many genuinely match;
a file matching more than one importer is not a bug to fix, it's what a single client export
containing several real sheets looks like. This is also exactly why every import panel in the UI
pins an explicit `importerId` rather than relying on auto-detection for this file: dropping it on
Reception imports `Truck Reception`, dropping the same file on Drying imports `Drying Batch`, no
sheet picker needed. See `backend/tests/importerRegistry.test.ts`, which asserts this multi-match
count directly rather than assuming every file resolves to exactly one importer.

**A second, narrower variant of the same problem showed up in `DISCHARGEMENT`.** That sheet has two
quality-reading panels side by side — the same 16 column labels, twice (`"BROWNS/Rejection (gm)"`,
`"KOR"`, `"Moisture"`, …), distinguished only by a banner one row above each block (`"…(Sampling
Report)"` vs `"…(Final Offloading Report)"`). The header-row check alone can't tell them apart: if
the two blocks were ever swapped, the header row would still fingerprint as a perfect match while
every quality reading was filed under the wrong sampling pass. So the importer framework grew a
second, optional check — `expectedAnchors` — that pins specific cells *outside* the header row for
shapes where the header alone is ambiguous. `warehouseDischargesImporter` is the one importer that
uses it today; every other importer passes none and behaves exactly as before. The same trap
recurs in `Drying & Sorting Report` — `"Draige Loss Kg's"` appears twice, at columns 21 and 23 —
which is why `dryingSorting.ts` parses by column index, never by label lookup.

## The receipts importer's per-stage presence rule

`Truck Reception` doesn't record which of the ~16 process stages a truck reached — it just has
whatever columns it has. Each stage is created for an imported receipt **if and only if at least
one of its mapped source columns is non-empty** in that row — never a fabricated spread of
progress. Two deliberate exceptions:

- **Gate entry (`n-gate`) and tare weighing (`n-tare`) are always created.** `n-tare` is present but
  empty — the client's own process notes confirm every truck physically passes tare weighing, even
  though `Truck Reception` has no column for it — this already matches the existing
  `tare_never_recorded` data-quality finding.
- **Bin, Stock, Drying, Other Activity, Ledger, Transfer decision, and Rejection
  (`n-bin`/`n-stock`/`n-drying`/`n-otheract`/`n-ledger`/`n-xferdec`/`n-reject`) are never created
  by the receipts importer.** `Truck Reception` captures none of them, so creating them would
  invent progress that never happened. Quality analysis (`n-qfs`) is created when moisture/KOR
  fields are present, but its pass/fail branch is deliberately left **unset** — the sheet has no
  real pass/fail signal to read, and guessing one would be fabrication. An admin records that
  decision afterward through the normal receipt UI, exactly as with any other receipt.
- **Two real stage fields have no equivalent in this export at all: `RM/FG` (`n-gate`) and `REF.`
  (`n-verify`).** They carry `v: ""` in `stages.ts` (the repo's own "no workbook backing" marker),
  not a guessed value.
- **Lot (`n-lot`) is the one exception, and it comes from a different importer, not this one.**
  `Truck Reception` still has no Lot column, so the receipts importer itself never creates
  `n-lot` — but the `DISCHARGEMENT` sheet (the `WarehouseDischarge` row above) is where a Lot is
  actually *assigned*, and importing it writes the real Lot Number onto the matching receipt. See
  "The Lot write-back" below.

## The Lot write-back (client call, Sept 2026: Lot, not FICHE, is the tracking key)

`DISCHARGEMENT` is the unit-warehouse offloading record — the point in the client's own process
where a Lot Number is assigned. Every one of its 454 rows carries both a Lot and the truck's
arrival FICHE, so importing it does two things, in order:

1. **Stores the sheet verbatim** in `WarehouseDischarge`, all 64 real columns — the same
   fabricate-nothing rule every other importer here follows.
2. **Writes that Lot onto the Receipt** the FICHE identifies — the only way a receipt ever gets a
   real Lot Number, since `Truck Reception` has none. This is a genuine write-back, not just a new
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

**`Warehouse Receiving` (also `WarehouseDischarge`, above) deliberately does NOT do this write-back.**
It shares a table with `DISCHARGEMENT` — safe only because both key on the same
`(warehouseSite, Lot No)` composite — but it's a separate importer with its own commit function that
never calls the write-back step. Its 256 genuinely-new Yamoussoukro-side rows have no matching
receipt to write a Lot onto in this pass anyway; adding a second importer that could move a Lot
already assigned by `DISCHARGEMENT` was judged not worth the risk for this round.

**Lot uniqueness is enforced per warehouse, not globally.** Measured directly: the same physical
batch is a *different* Lot Number at each site — e.g. one fiche is Lot 20 at the unit warehouse and
a different lot at the central warehouse (measured at hundreds of fiche-matched rows disagreeing
this way — see `lot_namespace_disagreement`'s own affected count for the current figure). Each site
runs its own 1..N sequence, so a Lot number only means something together with its warehouse — the
`lot_namespace_disagreement` data-quality check reports every disagreement it finds, and the
receipt detail page's "Linked records" card shows both numbers side by side rather than picking
one.

## Dedup policy, per importer

- **Warehouse Transfers, Drying Batch, and Warehouse Discharges (Lot assignment)** have a real
  source-provided unique key (the sheet's own SN / Lot No). Re-uploading the same file is a plain
  database-level skip: rows whose key already exists are silently not re-inserted, and this is safe
  to do repeatedly. The Lot write-back on top of the discharge import has its own separate conflict
  handling — see above.
- **Truck Reception and Jute Bags movement have no such key** in the source — a receipt is
  identified by vehicle + date + supplier, and a jute-movement row's own `No` column has real
  duplicates in the source data, so it can't serve as one either. For these two, a likely-duplicate
  row is **flagged as a finding, never silently dropped or silently written** — matching this app's
  standing rule that a data-quality concern surfaces rather than blocks. At commit time, "skip rows
  that look like duplicates" is on by default; turning it off writes them anyway, since a flagged
  row might legitimately not be a duplicate.
- **Warehouse Receiving** keys on `(warehouseSite, Lot No)`, same as `DISCHARGEMENT` — the two
  importers share a table safely because they share that composite key.
- **Dispatch to Central, Drying Batch, Drying & Sorting Report, Warehouse activity Ledger, and
  Issued to Production** have no real source-provided key that's unique on its own (a voyage
  number, a Lot cell, or an S.No. each have real gaps or duplicates in these sheets — see the
  mapping table above for the specifics per sheet), so each gets a surrogate key scoped to
  `(source, sheetRow)` (Drying Batch instead uses `(warehouse, sn)` — see its table's own comment
  for why `sheetRow` alone isn't enough there). Re-uploading the identical file is still a safe
  no-op; a genuinely reshaped file gets new rows.
- **Suppliers** upserts per-row on the sheet's own supplier code — the canonical master, safe to
  re-upload any number of times.

## If the client sends an updated or reshaped version of one of these files

Update the corresponding `expectedHeader` list in `backend/src/domain/imports/registry.ts` (in the
specific importer file — `truckReception.ts`, `juteBagsMovement.ts`, `dryingSorting.ts`,
`suppliersMaster.ts`, `juteWarehouseTransfer.ts`, `warehouseDischarges.ts`,
`warehouseDispatches.ts`, `dryingBatch.ts`, `warehouseReceiving.ts`, `warehouseActivityLedger.ts`,
or `issuedToProduction.ts`) and this document together, so they can't drift apart. This is the same
"keep in sync by hand" discipline `packages/contract/src/data/stages.ts` already asks for with the
client's original HTML process maps — there is no automatic way to detect that a real-world sheet
changed shape, so the header-fingerprint check (see "The corruption case" above) is what catches a
mismatch at upload time rather than a schema diff at review time.

**Reproducing the current numbers.** Everything measured in this document and in the tests that
assert it comes from `npm -w backend run seed` (which reads `frontend/src/data/seed/*.json`,
regenerated from `Truck Reception`/`Jute Bags movement`/`Suppliers`/`Bouake Stock Reciving` by
`tools/extract-seed.py` and `tools/extract-jute.py`), followed by importing the remaining new
sheets through the UI: `DISCHARGEMENT` first (it writes onto receipts the seed must already
contain — importing it before the receipts it should match onto would just report more
`fiche_not_matched` rows, safe but incomplete until re-uploaded), then `Warehouse Receiving`,
`Drying Batch`, `Drying & Sorting Report`, `CHARGEMENT`, `Issued to Production Section`, and
`Warehouse activity Ledger` in any order — none of these six write onto a receipt stage, so their
order relative to each other and to `DISCHARGEMENT` doesn't matter. **Note:** with the seed already
containing all 986 receipts, re-uploading `Truck Reception` afterwards will flag all 986 rows as
likely duplicates (this importer has no natural key, only the vehicle + date + supplier
content-key heuristic) — correct existing behaviour, not a bug; `skipFlagged` defaults to true.
