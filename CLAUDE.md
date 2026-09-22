# ANAGROCI RCN tracking — repo guide

Cashew (RCN) procurement tracking for ANAGROCI: truck arrival, quality check, weighing, Lot/Bin
assignment, drying, and the four jute-bag ledgers. Domain model is transcribed from the client's
real Excel workbooks — see `README.md` and `backend/README.md` for the full story. This file is
about **how to work in this repo**, not what it does.

## Layout

```
packages/contract/   Shared source of truth: types, the 17-stage/4-ledger field dictionaries,
                      deriveStatus(), decision branches, jute math. Both frontend and backend
                      depend on this — see packages/contract/CLAUDE.md.
backend/              Fastify + Prisma + PostgreSQL API. See backend/CLAUDE.md.
frontend/             Vite + React + TypeScript SPA. See frontend/CLAUDE.md.
tools/                Python extractors (openpyxl) that regenerate frontend/src/data/seed/*.json
                      and juteLedgers.json from the client's real .xlsx files. Re-run + rebuild
                      seed data if the source workbooks change; nothing else reads .xlsx directly.
docker-compose.yml    db (Postgres) + backend (:3000) + frontend (:8080, nginx proxies /api).
```

It's an npm workspace (`workspaces: ["packages/*", "backend", "frontend"]`). `npm install` at the
root installs all three. `npm test` / `npm run gen:check` at the root run every workspace's checks.

## The rule everything else follows from

**`packages/contract/src/data/stages.ts` and `juteBags.ts` are the spec, not a sketch.** They were
transcribed column-by-column from the client's real workbooks and validated against their process
notes. Every stage field, every ledger column, every business rule (one truck = one Lot always; a
Bin holds many Lots; drying is issued at Lot level, never Bin level; a rejected truck must persist
with a reason) traces back to those two files' comments. If you're about to add a field or change a
rule, find its home there first — don't invent structure that isn't grounded in a real source.

**Never fabricate data.** A field with `real: false` (juteBags.ts) or `kind: "gap"` (stages.ts) is a
genuinely new requirement with no real backing — model it, but don't invent sample values beyond
what's already seeded. `tools/extract-seed.py` used to fabricate Lot Numbers (`LOT-2026NNNN`); that
was a bug, not a pattern to repeat — it shared zero keys with the real drying-job/ledger-4 lot
numbers and made a fake namespace indistinguishable from real data. If a source workbook has no
value for something, leave it blank and let `/api/data-quality` report the gap.

**Never silently "fix" a data-quality issue.** The real workbooks have a negative running balance,
a `DIFF` column that's a broken formula (`= −Received Bags`, 367/367), duplicate `S N` values,
disjoint bin/warehouse namespaces across sheets. These get stored verbatim and reported as findings
(`backend/src/domain/dataQuality/`), never cleaned, coerced, or dropped. If you find a new one, add
a check — don't patch the importer to make it disappear.

## Precedence when sources conflict

The Sept 2026 clarification (quoted in `stages.ts`'s `note` fields, search "Confirmed") > `stages.ts`
/ `juteBags.ts` (already reconciled with it) > the original process docs in `../flow-xl-map/` >
`PG_Project_Data_Model_Overview.md` (broadest, oldest, background only).

## Cross-cutting engineering standards

These apply in every package here, not just one:

- **One source of truth per fact.** If a value could be derived (a status, a running balance, a
  net weight), derive it — don't store a copy that can drift from what it's derived from. This
  repo has been burned by exactly that pattern once already (`backend` used to hand-copy four files
  from `frontend`; they're both re-exports of `packages/contract` now).
- **Modular, not monolithic.** Group code by what it's responsible for (a route, a service, a
  domain rule, a UI component) and keep each piece small enough to read in one sitting. A file that
  both validates input, talks to the database, and formats the response is three files.
- **Write the test that would have caught the last bug**, not just the one that exercises the happy
  path. This repo's two most valuable tests exist because a migration could silently corrupt data
  in ways that look fine at a glance: `backend/tests/roundTrip.test.ts` (does normalized storage
  reproduce the exact input?) and `backend/tests/statusParity.test.ts` (did derived status change
  for any existing record?). When you change how data is stored or derived, ask what the equivalent
  guard is for your change.
- **Reuse before you rebuild.** Before writing a new component, hook, validation function, or type,
  search for one that already does most of it. Generic-but-parameterized beats
  copy-pasted-and-tweaked (see `StageForm`/`FieldInput` in frontend, or `checks.ts`'s per-check
  functions in backend — one shape, many instances, not seventeen near-duplicate files).
- **Comments explain *why*, not *what*.** The code already says what it does. A comment earns its
  place by recording a decision, a constraint, or a piece of real-world data that isn't visible in
  the code itself (e.g. "the workbook's own balance goes negative — that's real, don't clamp it").
- **Don't add a dependency, table, or endpoint for something not asked for.** Production is
  explicitly out of scope for this build (`frontend/src/pages/ProductionPage.tsx` is a placeholder
  on purpose) — don't build toward it speculatively; keep the schema extensible instead (see how
  `backend/prisma/schema.prisma`'s masters aren't hard-coded to only Procurement's needs).

## Commands

```bash
npm install                  # workspace root — installs contract, backend, frontend together
npm test                     # every workspace's test suite
npm run gen:check            # fails if packages/contract's generated stage map is stale
docker compose up --build    # full stack from an empty database: migrate, seed, serve
```
