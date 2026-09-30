# backend — CLAUDE.md

Fastify + Prisma + PostgreSQL. See `backend/README.md` for the "what and why" (stack rationale, the
normalization decision, the jute reconciliation views, the full endpoint list, known data-quality
findings). This file is about **how code here is organized and what conventions to follow**.

## Layered structure — keep new code in the right layer

```
src/routes/*.ts        Thin. Parse the request, call a service, map errors to HTTP codes, return
                        JSON. No Prisma calls, no business logic here — if a route file is doing
                        either, that logic belongs one layer down.
src/services/*.ts       The actual work. receipts.ts and ledgers.ts are shared by BOTH the routes
                        and prisma/seed.ts — that sharing is why they exist as a separate layer:
                        the seeder needs the same writes the API does, minus the hard validation
                        (see bypassValidation below).
src/domain/             Pure-ish logic that isn't Prisma-shaped: validation.ts (hard rules that
                        reject a write), dataQuality/ (soft findings that never block),
                        juteBalance.ts (reads the SQL views).
src/stageStore.ts       The bridge between the 16 normalized stage tables and the wire-format
                        stageData object. This is where round-trip fidelity lives or dies — read
                        its header comment before changing it.
src/serialize.ts        toReceiptRecord(): row -> wire shape, with status attached (never stored).
prisma/schema.prisma    63 models. The 16 stage tables and 25 production tables are GENERATED (see
                        packages/contract's gen-prisma-models.ts / gen-production-map.ts) — don't
                        hand-edit their columns; regenerate.
prisma/seed.ts          Loads real data via the service layer with bypassValidation: true. See
                        "Why bypassValidation exists" below before assuming it's a shortcut to copy.
```

**When adding a feature: route → service → (domain rule or Prisma call).** Never route → Prisma
directly for anything beyond the simplest read. The service layer is what makes the seeder able to
reuse the same write path the API uses — losing that means the seeder and the API can drift.

## Two kinds of "this data is wrong," handled differently

- **Hard rules** (`src/domain/validation.ts`) reject a write with 422: Bin before Lot, a rejected
  truck with no reason, a drying job with no Lot. These protect **new** writes.
- **Data-quality findings** (`src/domain/dataQuality/`) never block anything. They exist because the
  *real, already-imported* client data violates some of the hard rules (6 receipts are rejected
  with no reason; every receipt has a Bin but no Lot, because the source sheet has no Lot column at
  all). Findings are surfaced two ways: inline `warnings[]` on a successful write, and the
  aggregate `GET /api/data-quality` audit. **Never make a finding block a write** — that would make
  the real seed data unimportable, which is the opposite of the point.

If you're adding a new rule and unsure which bucket it belongs in, ask: would applying this rule to
the 50 real seeded receipts reject or discard any of them? If yes, it's a finding, not a validator
(or the seeder needs `bypassValidation`, see below).

### Why `bypassValidation` exists on service functions

`prisma/seed.ts` calls `setStageFields`/`setBranch` with `{ bypassValidation: true }`. This is not a
backdoor to reach for casually — it exists for exactly one reason: the real workbook data predates
these rules and genuinely breaks them (see above). Application code (routes) should never pass
`bypassValidation: true`. If you find yourself wanting to for a new route, that's a sign the rule
you're bypassing should be a data-quality finding instead of a hard validator.

## Testing conventions

```
tests/roundTrip.test.ts       THE load-bearing test. Proves the 17-table normalization loses
                               nothing: every seeded receipt reassembles byte-identical to its
                               pre-normalization JSON (stageDataShadow), and all 74 (stage, field)
                               pairs survive "", "0", and "9.50" round-trips. Extend this whenever
                               you add a stage field with non-trivial parsing.
tests/statusParity.test.ts    Proves deriveStatus() gives the same answer before and after any
                               storage change. If you touch stageStore.ts, stage presence logic, or
                               the seeder, run this — a silent status change on real receipts is
                               the single worst failure mode in this codebase.
tests/juteBalance.test.ts     The reconciliation math against the real 298/367-row imports. Asserts
                               balance_delta = 0 across all rows — that's both the import-fidelity
                               proof AND a standing regression guard. If this ever goes non-zero,
                               something is silently rewriting the workbook's own numbers.
tests/dataQuality.test.ts     Asserts each check's affectedCount against the MEASURED real count
                               (6 rejected-without-reason, 367 degenerate DIFF rows, etc.). These
                               numbers are not arbitrary — they came from counting the real
                               workbooks. If a count changes, figure out whether the data changed
                               or a check started silently "fixing" something before touching it.
```

**Pattern to follow for new tests:** prefer proving an invariant over the real seeded/imported data
(50 receipts, 298+367 jute rows) over hand-built fixtures. Fixtures can't catch what the real data
actually contains; the measured-count tests above have already caught real problems this way.

## Prisma conventions

- Stage tables are `String?` columns, always — never `Decimal`/`Int` for a field that lives in
  `stageData`. The wire format is all-strings, and typed columns silently break round-trip
  (`"9.50"` → `9.5`, `""` and `"0"` both collapse to `0`). Add a `*Num` **shadow** column alongside
  for reporting/DQ only, written in the same transaction, never read back into `stageData`.
- Anything genuinely mixed-type in a source workbook (a comma-decimal string next to real numbers)
  gets a `*Raw` twin column holding the original text — see `korReceived`/`korReceivedRaw` on
  `JuteWarehouseTransferReceipt`. Don't coerce and lose the original.
- Hard FKs only where the seed data is provably 100% clean (checked before writing the FK, not
  assumed). Anything spanning the two disjoint bin/warehouse namespaces (Bouaké's `BKE-*` vs
  Yakro's `BIN-*`/`ANAGROCI-01`) or the unresolved lot-number question stays a soft string
  reference with a nullable resolved id, not a hard FK — see `schema.prisma`'s header comment.
- Anything Prisma's schema DSL can't express (partial indexes, views, window functions) is a
  hand-written raw-SQL migration, not a workaround bolted onto application code. See the
  `lot_unique_and_jute_views` migration for the pattern: comment explaining *why* the DSL couldn't
  do it, then plain SQL.

## Error handling convention

`app.ts`'s error handler maps exception types to HTTP codes in one place:
`ValidationError` → 422, `UnauthorizedError` → 401, `ForbiddenError` → 403, `UnknownStageFieldError` → 400, Prisma `P2002`/`P2003`/`P2025` → 409/422/404.
New domain errors should be a typed class thrown from the service/domain layer and added there —
not a `reply.code(...)` scattered inline in a route, which is how the codes drift from each other.

## Auth

`auth/plugin.ts`'s `registerAuth(app)` must be called **before** the route registrations in `app.ts`
(its hook only covers routes added after it). New site-scoped reads use `scopedSite(req, warehouse)`,
never `resolveSite` directly; new writes for Warehouse Incharge/admin only need nothing extra, and a
route a Branch Manager / QFS Officer should reach must be added to `auth/policy.ts`. Route tests
that need a session use `buildApp().inject()` — see `tests/userManagement.test.ts`.
