# ANAGROCI backend — RCN procurement tracking

Fastify + Prisma + PostgreSQL. Serves the API behind `frontend/`'s `TrackingApi`, and owns the
rules that `localStorage` could never enforce: derived status, lot/bin ordering, lot uniqueness,
and the jute reconciliation arithmetic.

## Run it

```bash
docker compose up --build          # db + backend (:3000) + frontend (:8080) — hot reload, see ../README.md
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
| **Normalized per-stage tables** | Chosen over one JSONB `stage_data` column. 16 stage tables, 69 typed columns, queryable and constrainable. The cost is a label↔column mapping, which is generated, and a round-trip test proving nothing is lost. |

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
| GET | `/api/receipts`, `/api/receipts/:id` | Full `ReceiptRecord` with derived `status`. List accepts `?warehouse=` (a site name — see below) |
| POST | `/api/receipts` | Server-assigned `REC-<year>-NNNN`, serializable |
| POST | `/api/receipts/batch` | `{warehouse, rows}` — several trucks (gate + supplier-document fields) in one transaction, all or nothing; a bad row is a 422 naming it and creates none. Warehouse Incharge / admin |
| PATCH | `/api/receipts/:id` | Top-level fields; `lotNo`/`binNo` route to their stage rows |
| PATCH | `/api/receipts/:id/stages/:stageId` | **Batched** — the client coalesces per stage |
| POST | `/api/receipts/:id/branch` | Recomputes status + appends a timeline entry |
| GET | `/api/receipts/:id/activities` | Full 1:N history for `n-otheract` / `n-ledger` |
| GET | `/api/receipts/:id/links` | Cross-site by design — deliberately does **not** accept `?warehouse=` (see below) |
| GET/POST | `/api/jute-ledgers[/:id/entries]` | Server assigns `S N` and the running balance. GET accepts `?warehouse=` |
| GET | `/api/jute-ledgers/reconciliation` | Per warehouse and period. Accepts `?warehouse=` |
| GET | `/api/masters`, POST `/api/masters/{suppliers,warehouses,bins}` | `warehouses` is `{name, kind, site}[]`, not a bare string list — see "Sites, not just warehouses" below |
| GET/POST | `/api/drying-jobs` | Rejects a job with no Lot. GET accepts `?warehouse=` |
| GET | `/api/dashboard?from=&to=` | Doc §3's six figures, for any period. Also accepts `?warehouse=` |
| GET | `/api/warehouse-dispatches` | Unit-warehouse dispatch out (CHARGEMENT), one row per line. Accepts `?warehouse=` |
| GET | `/api/warehouse-activity-ledger` | Its own table — the source sheet has no site column, so this one can't be scoped |
| GET | `/api/data-quality` | |
| GET | `/api/workbook?warehouse=&from=&to=` | **The ANAGROCI workbook**: ONE .xlsx in plain words, used for both Export and Upload — sheet titles like `Truck Reception` / `Warehouse Receiving` and headers like `Arrival Date` (defined in `domain/workbook/fields.ts`), not table or column names. Which sheets it carries and whose rows it holds depends on the section (the warehouse's Unit/Central type). `?from=&to=` (inclusive, `YYYY-MM-DD`, either optional) filters each dated sheet on its own date; Suppliers is never filtered. Rows with no usable date are left out under a range and counted in `X-Rows-Without-Date`. Warehouse Incharge (own warehouse) / admin (names a warehouse) |
| GET | `/api/workbook/template`, `/api/workbook/info` | The same workbook with headers only (the Upload dialog's sample); the section's sheet list |
| POST | `/api/workbook/preview` | Multipart `file` (+ `warehouse` for an admin). **Writes nothing**: returns, per sheet, new / changed / unchanged counts, sample changes and every problem (sheet, row, column, message), under a token |
| POST | `/api/workbook/:token/commit` | Re-checks and writes in **one transaction**, all or nothing. Upsert, never delete: a blank id adds a row, a known id is updated (only cells that differ), a missing row is left alone. Receipts go through the same stage-write code as every other edit |
| GET/POST | `/api/imports/*` | The earlier **client-workbook** importers (Truck Reception, CHARGEMENT, …). Kept — the seed and the real data came in this way and their tests guard the parsers — but the UI no longer offers them; Upload is the workbook above. See `docs/UPLOAD_GUIDE.md` |

### Auth and user management

Every `/api/*` route except `/api/health` and `/api/auth/login` needs a session (httpOnly cookie,
12h, only its SHA-256 stored). Four roles — `admin`, `warehouse_incharge`, `branch_manager`,
`qfs_officer` — defined with their forms in `packages/contract/src/data/roles.ts`; the design and
the reasoning are in `../docs/usermanagement.md`.

| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/login`, `/api/auth/logout`; GET `/api/auth/me` | anyone / signed in |
| GET/POST/PATCH | `/api/users[/:id]` | admin — role, one warehouse (a typed site), active, password reset |
| PATCH | `/api/masters/warehouses/:name` | admin — sets a site's Unit/Central `type` |
| POST | `/api/receipts/:id/submissions` | Branch Manager (reception form) / QFS Officer (jute check) |
| GET | `/api/submissions?status=&receiptId=` | reviewers: their warehouse; submitters: their own |
| POST | `/api/submissions/:id/approve`, `/reject` | Warehouse Incharge / admin. Reject needs `{reason}` and is final |
| GET/PUT | `/api/branch-managers`, `/api/branch-managers/:id/suppliers` | Warehouse Incharge — assign suppliers (whole set) |
| GET | `/api/my-suppliers` | Branch Manager |
| GET/POST | `/api/supplier-requests`, POST `.../:id/approve`, `.../:id/reject` | Branch Manager requests; Warehouse Incharge decides |

- **Scope.** `?warehouse=` goes through `auth/scope.ts`'s `scopedSite()`, which wraps `resolveSite()`:
  admin may ask for any warehouse; everyone else is pinned to their own (naming another is 403).
- **Default-deny for the narrow roles.** `auth/policy.ts` lists the only requests a Branch Manager or
  QFS Officer may make; a new route is closed to them until it's listed there.
- **Submissions are staged.** A submission is stored as-is and touches no stage table, so it can't
  move derived status. Approval applies it through `applyStageFields` in one transaction with the
  status/timeline change. Every changed field (direct edit or approval) lands in `StageFieldChange`.
- **First admin.** The seed creates one from `ADMIN_USERNAME` / `ADMIN_PASSWORD` while no admin
  exists; with no password set, nothing is created. Set `COOKIE_SECURE=true` behind HTTPS.
- **Demo users.** `prisma/demoUsers.ts` seeds one account per role when `SEED_DEMO_USERS=true` and
  `DEMO_PASSWORD` is set — docker-compose.yml turns it on (password `demo-pass-123`), dev only.
- Old data has no actor: seeded/imported receipts and their timeline entries stay `actorId = NULL`.

Hard rules answer **422** (lot-before-bin, lot uniqueness, rejection-needs-reason,
drying-needs-lot); a missing/expired session answers **401**, a role or warehouse the caller isn't allowed **403**; an unknown stage or field label answers **400** rather than silently dropping
the write. See `../docs/UPLOAD_GUIDE.md` for which real workbook feeds which endpoint above, what's
deliberately not importable, and the dedup rules each importer applies.

### Sites, not just warehouses

The client's real hierarchy is **Site → Store → Bin** (`BOUAKE → BKE-002 → BKE-002-BIN-026`), and
the two sites — `BOUAKE` (Regional Central) and `YAKRO FACTORY` (Factory) — are what the frontend's
two top-level sections scope to. `Warehouse.kind`/`Warehouse.site` (nullable, reported not guessed
— see `packages/contract/src/data/warehouseKinds.ts`) carry that hierarchy; `domain/site.ts`'s
`resolveSite(name)` expands a site to itself + its stores + its aliases (e.g. `?warehouse=BOUAKE`
also matches rows stored under the store code `BKE-002`, and `?warehouse=YAKRO FACTORY` also
matches `ANAGROCI-01`/`YAMOUSSOUKRO`), which is what every `?warehouse=` param above actually filters
on — never a raw string match. `/api/receipts/:id/links` is the one deliberate exception: it's the
endpoint that proves the same physical batch is a different Lot Number at each site, so scoping it
by site would defeat its own purpose.

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
prisma/schema.prisma        31 models; the 16 stage tables are generated from stages.ts
prisma/migrations/          init + the partial index and the four views
prisma/seed.ts              real data, via the service layer with bypassValidation
src/stageStore.ts           stageData <-> per-stage tables; where round-trip fidelity lives
src/services/               receipts, ledgers — shared by the routes and the seeder
src/domain/juteBalance.ts   reads the SQL views
src/domain/dataQuality/     one file per check, plus a registry
tests/                      44 tests; roundTrip and statusParity are the load-bearing ones
```
