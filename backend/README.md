# ANAGROCI backend — RCN procurement tracking

Fastify + Prisma + PostgreSQL. Serves the API behind `frontend/`'s `TrackingApi`, and owns the
rules that `localStorage` could never enforce: derived status, lot/bin ordering, lot uniqueness,
and the jute reconciliation arithmetic.

## Run it

```bash
docker compose up --build          # db + backend (:3000) + frontend (:8080)
open http://localhost:8080
```

The backend container runs `prisma migrate deploy`, then the seeder (idempotent), then the server.
On an empty volume that brings up the full real dataset: 50 receipts, 74 suppliers, 37 drying jobs,
298 jute warehouse movements, 367 transfer receipts.

For local development against the compose database:

```bash
docker compose up -d db
npm install                        # workspace root — installs all three packages
npm -w backend run prisma:migrate
npm -w backend run seed
npm -w backend run dev             # :3000
npm -w frontend run dev            # :5173, proxies /api to :3000
npm -w backend test
```

## Stack, and why

| Choice | Reason |
|---|---|
| **TypeScript / Fastify** | The frontend is TypeScript, and `deriveStatus()` must be identical on both sides. Sharing the module is better than reimplementing it — the previous version hand-copied four files and their headers admitted they would drift. |
| **PostgreSQL** | Needed for things SQLite only approximates: the **partial unique index** that makes "one truck = one Lot" expressible without rewriting `''`→`NULL` on every write, **window functions** for the jute running balance, and real FK enforcement. |
| **Prisma** | Real migrations, and a DMMF that tests can introspect — that's what lets `stageMap.schema.test.ts` prove the field dictionary matches the database. |
| **Normalized per-stage tables** | Chosen over one JSONB `stage_data` column. 17 stage tables, 74 typed columns, queryable and constrainable. The cost is a label↔column mapping, which is generated, and a round-trip test proving nothing is lost. |

## How stage data works

`ReceiptRecord.stageData` is `Record<stageId, Record<fieldLabel, string>>`, where the labels are
the client's own column names — misspellings, accents and all. That is the API contract and the
frontend renders it directly.

Those labels can't be database columns: one of them slugs to 77 characters (Postgres truncates
identifiers at 63 bytes, silently), five are non-ASCII, and one is reused across two stages. So
`StageField` in `@anagroci/contract` carries an explicit `col`, and
`packages/contract/scripts/gen-stage-map.ts` generates `STAGE_FIELD_MAP` from it.

Four guards keep the dictionary honest:

1. `npm run gen:check` — fails if the generated map is stale.
2. `stageMap.schema.test.ts` — every `(model, col)` exists in the live Prisma DMMF.
3. `roundTrip.test.ts` — all 74 pairs survive a write/read cycle, including `""`, `"0"` and `"9.50"`.
4. The golden-seed test — all 50 receipts reassemble byte-identically to their pre-normalization JSON.

`Receipt.stageDataShadow` holds that original JSON. It is read-only, exists purely as the oracle for
guard 4, and is dropped once the migration has been in production for a release.

### Status is derived, never stored

`deriveStatus()` is the single source of truth and runs from the shared contract module. It keys off
the **presence** of a stage, not its contents — a stage with every field blank still counts. That's
deliberate: the form writes a field as soon as it's touched, so this is the existing behaviour, and
the migration preserves it exactly. `StageEntry` records presence as a fact rather than inferring it
from "does a payload row exist". `statusParity.test.ts` proves no receipt's status changed.

## The jute ledgers

Four tables, one per ledger. The reconciliation rule —
`opening + receipts + transfers in − issues − damaged/discarded − transfers out = closing` — is a
**SQL view**, not a column:

- A generated column can't express a running balance (it depends on every prior row).
- A CHECK constraint would *reject* the real negative rows, which is backwards.
- A materialized view goes stale the moment someone appends.

`jute_warehouse_movement_balance` computes the running balance with a window function, so there is
no column anyone can write to. The workbook's own `BALANCE` is stored untouched in
`reportedBalance`, and `balance_delta` compares them. It is **0 across all 298 imported rows** —
that zero is both the proof the import was faithful and a permanent regression guard.

The rule is not expressible over ledger 1 alone (it has no damaged/discarded column), so
`jute_movement_stream` projects all four ledgers into one movement stream that `jute_reconciliation`
aggregates.

## Data quality

`GET /api/data-quality` returns aggregate findings; writes also return inline `warnings[]`.
Warnings never block — the real client data violates these rules, and refusing it would make the
import impossible. That is the point: **surface problems, don't silently normalize them away.**

Fifteen findings ship against the real data, including:

- `net_uses_bag_count_not_tare` — `stages.ts` documents `Net = Gross − Tare`, but on all 19 receipts
  with the values present, `NET = GROSS − SACS` (bag count) exactly. Net is therefore **not**
  computed server-side; doing so would overwrite real imported numbers with a contradicted formula.
- `rejected_without_reason` — 6 imported receipts are rejected with no reason. The API refuses new
  ones (422); these are reported rather than given an invented reason.
- `transfer_out_undercounted` — ledger 1 records 3 transfers out against ledger 4's 367 inbound.
  This comparison is impossible in the client's current sheets.
- `ledger4_diff_degenerate` — `DIFF` equals `−(Received Bags)` on all 367 rows. Stored verbatim,
  flagged; not dropped (loses data), not generated (enshrines the bug).
- `bin_allocated_without_lot` — the source sheet has no Lot column at all, which is precisely the
  traceability gap the `n-lot` stage exists to close.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | |
| GET | `/api/receipts`, `/api/receipts/:id` | Full `ReceiptRecord` with derived `status` |
| POST | `/api/receipts` | Server-assigned `REC-<year>-NNNN`, serializable |
| PATCH | `/api/receipts/:id` | Top-level fields; `lotNo`/`binNo` route to their stage rows |
| PATCH | `/api/receipts/:id/stages/:stageId` | **Batched** — the client coalesces per stage |
| POST | `/api/receipts/:id/branch` | Recomputes status + appends a timeline entry |
| GET | `/api/receipts/:id/activities` | Full 1:N history for `n-otheract` / `n-ledger` |
| GET/POST | `/api/jute-ledgers[/:id/entries]` | Server assigns `S N` and the running balance |
| GET | `/api/jute-ledgers/reconciliation` | Per warehouse and period |
| GET | `/api/masters`, POST `/api/masters/{suppliers,warehouses,bins}` | |
| GET/POST | `/api/drying-jobs` | Rejects a job with no Lot |
| GET | `/api/dashboard?from=&to=` | Doc §3's six figures, for any period |
| GET | `/api/data-quality` | |
| GET | `/api/imports/types` | The 4 known workbook shapes this app can import |
| POST | `/api/imports/preview` | Multipart `.xlsx` upload → parsed rows + findings, cached under a token |
| POST | `/api/imports/:token/commit` | Writes the previewed rows — see `docs/UPLOAD_GUIDE.md` |

Hard rules answer **422** (lot-before-bin, lot uniqueness, rejection-needs-reason,
drying-needs-lot); an unknown stage or field label answers **400** rather than silently dropping
the write. See `../docs/UPLOAD_GUIDE.md` for which real workbook feeds which endpoint above, what's
deliberately not importable, and the dedup rules each importer applies.

## Known deviations from the source documents

Raised rather than resolved — see `/api/data-quality` for the measured evidence:

1. **Net weight** — `Gross − Tare` (per `stages.ts`) vs `Gross − SACS` (per the data, 19/19).
2. **Lot namespace** — the receipts' `LOT-2026NNNN` values were fabricated by `extract-seed.py`
   and shared zero keys with the drying jobs. They are no longer generated. Ledger 4's integer
   `LOT NO` contains duplicates, which would contradict "one truck = one Lot", so no `Lot` entity
   is built until the client confirms the real namespace.
3. **`ANAGROCI-01`** — mapped to the Yakro factory warehouse by inference only, recorded with
   provenance and flagged for confirmation.
4. **Ledgers 2 and 3** — no row-level source exists, only an undated hand tally. The tables are
   intentionally empty; the real figures are in `JuteTallySnapshot`.
5. **Ledger 4** — the sheet has 34 columns; `juteBags.ts` models 12 for the UI form. All 34 are
   stored so normalization doesn't discard 22 columns; the extra 22 are import-and-report only.

## Layout

```
prisma/schema.prisma        32 models; the 17 stage tables are generated from stages.ts
prisma/migrations/          init + the partial index and the four views
prisma/seed.ts              real data, via the service layer with bypassValidation
src/stageStore.ts           stageData <-> per-stage tables; where round-trip fidelity lives
src/services/               receipts, ledgers — shared by the routes and the seeder
src/domain/juteBalance.ts   reads the SQL views
src/domain/dataQuality/     one file per check, plus a registry
tests/                      44 tests; roundTrip and statusParity are the load-bearing ones
```
