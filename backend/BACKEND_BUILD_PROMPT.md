# Prompt: build the ANAGROCI RCN tracking backend + data models

Paste this whole file as the opening prompt to a fresh Claude Code session with working
directory `anagroci-cashew-management/` (this repo). It is self-contained — read the files it
points to before writing any code.

---

## 1. What exists today, and what you're replacing

`frontend/` is a working Vite + React + TypeScript app. It has **no backend** — every read/write
goes through `frontend/src/repository/storage.ts`, a thin `localStorage` wrapper, consumed by
`frontend/src/state/TrackingContext.tsx`. Your job is to build the real backend + database this
app should have been talking to, and it must support **exactly the operations
`TrackingContext.tsx` already performs** — that file is your API contract, not a suggestion.

The frontend's data model is not a sketch — it was built by transcribing the client's own real
Excel workbooks (`flow-xl-map/Procurement/*.xlsx`, `Production Report-Digitalization/*.xlsx`,
etc.) column-by-column, then validated stage-by-stage against the client's written process notes
and a follow-up clarification call. **Treat the frontend source files below as the primary spec.**
Do not redesign the domain model from scratch — implement what's already there faithfully, then
add the server-side pieces (persistence, validation, status derivation, auth if needed) that
`localStorage` couldn't give it.

Read these frontend files first, in this order, before anything else:

1. `frontend/src/types/stage.ts` and `frontend/src/types/receipt.ts` — the core shapes.
2. `frontend/src/data/stages.ts` — all 17 Truck Arrival/Reception stages, each with its real or
   proposed field list, which stage is `entry` (backed by a real workbook column) vs `decision` vs
   `system` (derived, never typed) vs `gap` (new requirement, nothing captures it today). The
   `file`/`sheet` properties tell you exactly which source workbook a stage's fields come from.
3. `frontend/src/data/juteBags.ts` — the four jute bag ledgers, with real/`gap` columns per
   ledger, real sample rows, and a `flag` field on each documenting data-quality issues found in
   the source workbooks (keep reading these flags — they tell you where NOT to over-trust a
   column, e.g. a running balance that goes negative, or a `DIFF` column that's a broken formula
   always equal to `-(Received Bags)`).
4. `frontend/src/domain/decisions.ts`, `frontend/src/domain/receiptStatus.ts` — the branching and
   status-derivation logic. **`deriveStatus()` must be reimplemented server-side as the single
   source of truth for a receipt's status** — never let a client set status directly, exactly as
   the frontend comment says: *"Status is always derived from the record, never hand-set, so it
   can't drift from what's actually been filled in."*
5. `frontend/src/domain/jute.ts` — the running-balance calculation for jute ledgers
   (`lastBalance`), and the universal reconciliation rule in
   `frontend/src/data/juteBags.ts`'s `juteReconciliationRule` export:
   `opening + receipts + transfers in − issues − damaged/discarded − transfers out = closing stock`.
6. `frontend/src/repository/*.ts` (`receiptsRepo.ts`, `juteRepo.ts`, `mastersRepo.ts`,
   `dryingRepo.ts`, `storage.ts`) and `frontend/src/state/TrackingContext.tsx` — this is your API
   surface. Every method on `TrackingApi` in `TrackingContext.tsx` needs a backend endpoint behind
   it once you're done: `createReceipt`, `updateReceiptField`, `setStageField`, `setBranch`,
   `addLedgerEntry`, `addSupplier`, `addWarehouse`, `addBin`, plus list/get reads.
7. `frontend/src/data/seed/*.json` — real data (50 real RCN receipts sampled from
   `Rcn Offloading Details 2026.xlsx`, 75 real suppliers/warehouses/origins, real drying-job
   history, the real 229-row jute warehouse-stock ledger). Migrate this into the database as seed
   data so the backend opens with real history, same as the frontend does today — **do not
   fabricate additional rows**. `tools/extract-seed.py` shows how it was originally extracted from
   the client's `.xlsx` files with `openpyxl`, if you need to re-derive anything.
8. `backend/README.md` (this directory) — the prior placeholder notes on scope.
9. `README.md` (repo root) — product framing: the core entity is a **Receipt**, not a truck; once
   a Lot Number is assigned the record is tracked by its Lot from then on.

Also skim, for context and traceability back to source docs (don't re-derive the model from these
— they're background, `stages.ts`/`juteBags.ts` are the model):

- `../flow-xl-map/NewProcurement.html` and `../flow-xl-map/Procurement.html` — the original
  interactive process maps `stages.ts`/`juteBags.ts` were transcribed from (`stages.ts` says to
  keep them in sync by hand if either changes — flag any drift you notice, don't silently fix one
  side).
- `../flow-xl-map/RCN Procurement Process - DIGITAL.docx` — the client's own process notes; every
  "doc §N" comment in `stages.ts` refers to a section of this file.
- `../flow-xl-map/ANAGROCI_Data_Capture_Audit_Questions.md` — real data-quality landmines found in
  the source workbooks (duplicated capture across steps, swapped columns, comma-separated values,
  fraction-vs-percent formatting, banded headers). Read this before writing any import/validation
  logic so you don't silently "clean" real client data errors away or choke on them.
- `../PG_Project_Data_Model_Overview.md` §6–§8 — a whole-plant (Procurement **and** Production)
  data model sketch with a suggested `dim_*`/`fact_*` SQL schema. This predates the
  clarification below and is broader than what you're building now (Production isn't in scope —
  see §4). Use it only as a naming/extensibility reference so you don't paint the schema into a
  corner, not as the spec.

## 2. The final clarification (binding — supersedes anything that conflicts)

The client answered three open questions after reviewing the process flow. These answers are
**already reflected in `stages.ts` and `juteBags.ts`** (search for "Confirmed" in `stages.ts`'s
`note` fields — you'll find this exact clarification quoted back), so if you've read those files
carefully you've already absorbed this. It's restated here in full because it's the binding
business logic your backend must enforce, not just describe:

### Lot vs. Bin

- A **Lot** is a traceability/identification unit linked to **one truck**. One truck = one Lot,
  always. The Lot Number is assigned by the Warehouse Team once a truck is approved for unloading.
- A **Bin** is the **physical storage location** inside the warehouse. One Bin can hold RCN from
  **multiple Lots and multiple trucks**. Bin allocation happens after the Lot Number is assigned —
  same day, or the next day if operations require it — decided by the Warehouse Team (with Quality
  Team input on moisture/quality/KOR/space where needed).
- **Enforce at the model level:** a Receipt/truck can never be split between a Lot and a Bin — it's
  always fully in one Lot; a Bin is a many-Lots-to-one-Bin relationship, never the reverse.

### Drying

- Not mandatory for every truck/Lot/Bin — done mainly when moisture is outside the acceptable
  range.
- **Drying is always issued and tracked at the specific Lot/quantity level, never at the whole-Bin
  level** — a Bin can mix multiple Lots, so "dry this Bin" is not a valid operation; only "dry this
  Lot's quantity, currently sitting in Bin X" is.
- Sequence: moisture check before → issue the specific Lot/quantity for drying → dry → moisture
  check after → dried quantity returned to warehouse → stored in a new/assigned Bin, clearly marked
  as dried stock, **while the original Lot/truck traceability is retained**.
- Triage/cleaning is a **different** activity from simple drying — quality *and* moisture can both
  change during triage, so it needs its own quality + quantity + moisture records, not just a
  before/after moisture reading.

### Jute bag management — four separate but linked ledgers

Tracked as its own stock-control process, but every movement must stay linked back to the relevant
procurement/supplier/warehouse/production activity. Four levels (these map 1:1 onto the four
ledgers in `juteBags.ts` — `warehouse-stock`, `supplier-movement`,
`factory-production-tracking`, `warehouse-to-warehouse-movement`):

1. **Warehouse-level stock** (per warehouse): opening stock, received from vendor/new purchase,
   received from another warehouse, issued to RCN suppliers, used for warehouse activities, good
   bags available, completely damaged/discarded, damaged-but-repairable, closing stock.
2. **Supplier-level movement** (per supplier): bags issued to the supplier (in advance or against
   expected deliveries), bags returned via RCN deliveries, pending/balance with the supplier,
   damaged, reusable/reconditionable.
3. **Factory/Production-level tracking**: quantity issued to Production, date/quantity issued,
   good bags recovered, completely damaged, partially damaged (repair), quantity returned to
   warehouse, closing balance.
4. **Warehouse-to-warehouse movement**: any transfer between warehouses reduces the source's stock
   and increases the destination's, recorded as its own movement record (e.g. Warehouse A →
   Warehouse B).

**Universal rule, enforce as a computed/checked invariant, not just documentation:**
`opening + receipts + transfers in − issues − damaged/discarded − transfers out = closing stock`,
per warehouse and, where applicable, per supplier/department.

**Every bag movement must be traceable to:** Warehouse → Supplier/Department → Activity →
Quantity → Movement Type → Responsible Person/Team → Date — and, where applicable, linked to the
relevant Truck/Lot/RCN delivery. Model this as real foreign keys, not free-text.

### Other standing rules already encoded in `stages.ts` — don't relitigate these

- A **rejected truck must persist** in the system (`Status = Rejected` + reason) — it must never
  disappear the way it does in the client's current sheets.
- **Gross / Net / GRN / Paid Weight / Refraction are four separate values**, never collapsed into
  one number. Net weight is system-derived (`Gross − Tare − refraction`), never hand-typed.
- Dashboard must be able to answer, for any period: total trucks received, accepted & unloaded,
  GRN completed, pending QA, pending unload after QA, rejected (with reason) — see
  `computeDashboardCounts()` in `receiptStatus.ts` for the exact logic to port server-side.
- **Inter-Warehouse Stock Transfer (general RCN stock, beyond the jute-bag ledger above) is
  explicitly out of scope.** The client's notes say to validate Truck Arrival/Reception first and
  hold this back as a separate later exercise (`n-xferdec` stage — model the decision point, but
  don't build a general transfer subsystem).
- **Production is out of scope for this pass.** The frontend's `/production` route is an explicit
  placeholder. Don't build Production tables/endpoints now — just don't design the Procurement
  schema in a way that would make adding Production later painful (e.g. don't hardcode
  assumptions that only Procurement warehouses exist).

## 3. What to actually build

1. **Pick a stack** and justify it briefly in `backend/README.md`. Given the frontend is
   TypeScript and values sharing types/validation logic (e.g. `deriveStatus`, the reconciliation
   formula) between client and server where practical, a Node/TypeScript backend (e.g. Fastify or
   Express) with PostgreSQL and an ORM with real migrations (Prisma or Drizzle) is a reasonable
   default — but decide based on what best fits a small CRUD-heavy, integrity-sensitive app; don't
   over-engineer.
2. **Schema / models** covering at minimum:
   - `Receipt` (the core entity — see `ReceiptRecord`), with per-stage data. Decide deliberately
     between one JSONB `stage_data` column (fastest to build, mirrors the frontend shape exactly)
     vs. normalized per-stage tables (better queryability/validation) — either is defensible, but
     state your reasoning.
   - `Lot`, `Bin`, with the many-Lots-to-one-Bin relationship and allocation timestamp/basis fields
     from the `n-bin` stage.
   - `Supplier`, `Warehouse`, `Origin` masters (seed from `frontend/src/data/seed/*.json`), each
     extensible via an "add new" endpoint mirroring `addSupplier`/`addWarehouse`/`addBin`.
   - `DryingJob`, scoped to a specific Lot/quantity (never a whole Bin), with before/after moisture
     and the "dried stock" Bin re-assignment.
   - The four jute bag ledgers — either one polymorphic `JuteLedgerEntry` table with a `ledger_id`
     discriminator (matching the frontend's `LedgerEntries` shape) or four dedicated tables; either
     way, implement the reconciliation formula as an enforced/checked computation, not just a
     stored `Balance` column that can drift.
   - An `ActivityLedger`/timeline table backing `ReceiptRecord.timeline` and the doc §7 activity
     ledger (`n-ledger` stage).
   - Branch/decision state (`ReceiptRecord.branches`) for `n-qfs`, `n-drying`, `n-xferdec`.
3. **API surface** matching `TrackingApi` in `TrackingContext.tsx` 1:1 — receipts CRUD +
   `setStageField` + `setBranch` (recomputing status + appending a timeline entry server-side,
   exactly like the current client-side `setBranch` does), ledger entry append + list with
   computed running balance, masters list + add.
4. **Server-side validation** enforcing every rule in §2 as real constraints, not just UI
   affordances — e.g. reject a Bin-allocation write with no prior Lot Number on that receipt;
   reject a drying job that references a Bin instead of a specific Lot; force `status=rejected` +
   require a reason when `n-qfs` branch is set to `fail`.
5. **Seed migration**: load the real data from `frontend/src/data/seed/*.json` into the database
   so the backend starts with the same real history the frontend demo currently seeds from
   `localStorage`. Preserve the `source: "imported" | "entered"` distinction.
6. **Tests**: prioritize the two places subtle bugs are most likely — the jute ledger
   reconciliation math and `deriveStatus()`/dashboard-count logic. Port the real sample rows from
   `juteBags.ts` as test fixtures.
7. **Wire it up**: uncomment and fill in the `backend:` service in `docker-compose.yml`, update
   `backend/README.md` to reflect what was actually built (replace this prompt file's role once
   the backend exists — keep or delete `BACKEND_BUILD_PROMPT.md` at your discretion), and update
   `frontend/src/repository/*.ts` to call the new API instead of `localStorage` (keep the
   `TrackingApi` interface in `TrackingContext.tsx` unchanged so this is a one-layer swap, per the
   root README's stated design intent).

## 4. Ground rules

- **Don't fabricate.** If a field has no real backing in any workbook (`kind: "gap"` in
  `stages.ts`, or `real: false` in `juteBags.ts`), it's a genuinely new field the client asked for
  — model it, but don't invent sample/seed data for it beyond what the frontend already seeds.
- **Don't silently "fix" real data-quality issues** documented in `ANAGROCI_Data_Capture_Audit_Questions.md`
  or in `juteBags.ts`'s `flag` fields (e.g. the negative running balance, the swapped
  columns) — surface them (e.g. a validation warning), don't quietly normalize them away.
- If anything in the source docs conflicts, the order of precedence is: **this clarification (§2)
  > `stages.ts`/`juteBags.ts` (already reconciled with it) > the original DIGITAL.docx > the HTML
  maps > `PG_Project_Data_Model_Overview.md`** (broadest/oldest).
- Production stays out of scope — resist the urge to build it just because the data model overview
  covers it.
