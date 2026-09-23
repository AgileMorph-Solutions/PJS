# packages/contract — CLAUDE.md

The shared source of truth between `frontend/` and `backend/`. If a fact needs to be true on both
sides of the API (a type, a field label, a business rule), it lives here exactly once. This package
exists because the backend used to hand-copy four files from the frontend — their own header
comments admitted they'd drift, and eventually they would have.

## What's here and why

```
src/types/{stage,receipt}.ts     The wire-format types. ReceiptRecord.stageData is
                                  Record<stageId, Record<fieldLabel, string>> — every value is a
                                  string on the wire, always, even numbers and dates.
src/data/stages.ts               The 16 stage records, 69 fields. THE SPEC — transcribed from real
                                  workbooks, not invented. Each field has {n, v, col}: n is the
                                  display label (exact workbook column name), v is a sample value
                                  (or "" if new), col is the storage column name.
src/data/juteBags.ts             The 4 jute ledgers' column definitions, same {label, real, col}
                                  shape, plus the sample rows and data-quality `flag` text.
src/domain/receiptStatus.ts      deriveStatus() — the ONLY place status is computed. Never let
                                  either side set status directly.
src/domain/decisions.ts          The 3 decision stages' branch options (n-qfs, n-drying, n-xferdec).
src/domain/jute.ts               Running-balance helpers + the reconciliation checker.
scripts/gen-stage-map.ts         Generates src/generated/stageFieldMap.ts from stages.ts/juteBags.ts.
scripts/gen-prisma-models.ts     Emits Prisma model blocks for the 16 stage tables from the same map,
                                  pasted into backend/prisma/schema.prisma by hand.
src/generated/stageFieldMap.ts   COMMITTED, generated. Do not hand-edit.
```

## The rule that matters most here: `col`, never a slug

Every `StageField` and `JuteLedgerColumn` declares an explicit `col` — the database column name —
separately from `n`/`label`, the human-readable text shown in the UI. **Do not try to derive one
from the other.** Three real reasons this breaks:

- One label is 77 characters (`"Activity type (discharge, weight, reconditioning, destacking,
  drying, triage, sèches)"`) — Postgres truncates identifiers at 63 bytes, *silently*.
- Five labels are non-ASCII (`é`, `—`, `→`, `è`).
- One label (`"Warehouse type (Village/Regional/Factory)"`) is reused across two different stages
  (`n-gate`, `n-stock`) — the real key is `(stageId, label)`, not `label` alone.

So: adding a field means adding `{ n: "...", v: "...", col: "camelCaseName" }` to the right stage in
`stages.ts`, then running `npm run gen` here, then adding the matching column to the stage's model
in `backend/prisma/schema.prisma` (or regenerating it — see `gen-prisma-models.ts`), then a Prisma
migration. Skipping any step is caught, not silent — see Guardrails below.

## Guardrails — why they exist, run them before you trust a change

```bash
npm run gen           # regenerate src/generated/stageFieldMap.ts from stages.ts / juteBags.ts
npm run gen:check      # CI-mode: fails if the committed generated file is stale
npm test               # this package's own fast, no-database tests
```

`gen-stage-map.ts` itself refuses to generate if: a `col` is missing, a `col` exceeds 63 bytes, a
stage reuses a `col` internally, or the same `(stageId, label)` pair appears twice. Those are
compile-time-of-the-generator guarantees — if generation succeeds, the dictionary is at least
internally consistent. It does **not** by itself guarantee the database agrees; that's
`backend/tests/roundTrip.test.ts`'s job (every `(model, col)` pair exists in the live Prisma schema).

`packages/contract/tests/stageMap.test.ts` covers the parts that don't need a database: field/label
counts (16 stages, 69 fields), the 63-byte limit, uniqueness, the cross-stage reused-label case, and
that `deriveStatus()` keys off stage *presence*, not stage *content* (see next section) — write new
cases here for any new rule in `stages.ts`, before wiring up the database side.

## `deriveStatus()`'s one non-obvious rule

```ts
if (r.stageData["n-drying"]) return "in_drying";   // presence, not truthy content
```

A stage counts as reached the moment it exists as a key in `stageData` — **even if every field
inside it is an empty string.** This is deliberate and load-bearing: the frontend's form writes a
stage key the instant a field is touched (see `frontend/CLAUDE.md`), so "stage exists but blank" is
a real, common state, not an edge case to special-case away. If you touch `deriveStatus()`, keep
this semantic and update `stageMap.test.ts`'s test for it — don't switch it to "any field is
non-empty" without checking `backend/tests/statusParity.test.ts` first; that changes real receipts'
derived status.

## Adding a new stage or ledger column — checklist

1. Confirm it belongs in the spec — is there a real workbook column, or a "Confirmed" clarification
   note backing it? If not, it's a `gap`/`real: false` field, which is fine, but say so.
2. Add `{ n, v, col }` (or `{ label, real, col }`) to `stages.ts` / `juteBags.ts`.
3. `npm run gen` — regenerates the committed map.
4. Add/extend the matching table in `backend/prisma/schema.prisma`, then `prisma migrate dev`.
5. Extend `backend/tests/roundTrip.test.ts`'s sentinel coverage if the new field has an unusual
   shape (numbers-as-strings, French decimal commas, etc.) — that test iterates
   `STAGE_FIELD_MAP` automatically, so a plain string field needs nothing extra, but anything with
   its own parsing (a `*Num` shadow column, a `*Raw` twin) needs its own assertion.
6. Both `frontend` and `backend` pick up the change automatically on next install/build — neither
   should need a matching manual edit, because neither hand-copies this package's content.
