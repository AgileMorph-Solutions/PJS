# frontend — CLAUDE.md

Vite + React 19 + TypeScript SPA. Talks to the backend through same-origin `/api` (proxied by Vite
in dev, by nginx in the Docker image — see `vite.config.ts` / `nginx.conf`). This file is about
**component/state conventions**, not the domain model — that's `packages/contract/CLAUDE.md`.

## Layered structure

```
src/repository/api.ts       The ONLY place fetch() is called. Typed wrappers per endpoint, unwraps
                             the {data, warnings} envelope, throws ApiError on non-2xx.
src/repository/*Repo.ts     Thin re-exports of @anagroci/contract types, plus one local seed-loading
                             fallback each (loadSeed*). These are NOT where app state lives anymore
                             — TrackingContext is.
src/state/TrackingContext.tsx  The single state container. See "State shape" below before touching
                             this file — it has real concurrency handling in it, not just useState.
src/domain/*.ts             Re-exports of @anagroci/contract/domain — deriveStatus, decisions, jute
                             math. Don't reimplement any of this locally; if it's missing something,
                             it belongs in the contract package, not a local copy.
src/components/             Reusable, presentational. Take data + callbacks as props, own no
                             business logic. StageForm/FieldInput are the model to follow: driven
                             entirely by a Stage's data, so a new stage is a data change, not a new
                             component.
src/components/ui/          Generic UI primitives (DataTable, KpiTile, Pill, ...) with zero
                             domain knowledge. If a component imports from data/ or knows what a
                             "Lot" is, it doesn't belong in ui/ — e.g. ReceiptStatusPill (knows what
                             a ReceiptStatus is) lives in components/, and wraps the plain ui/Pill
                             (just a tone + a label, no domain knowledge at all).
src/pages/                  Route-level composition. Pull data from useTracking()/useDryingJobs(),
                             pass it to components. Business logic here should be "which components,
                             with which props" — not validation or derivation (that's the contract
                             package or the backend).
src/components/dashboard/   Domain-aware components scoped to one page (currently just Dashboard —
                             DateRangeFilter, the two chart components). Same reasoning as the
                             components/ vs components/ui/ split, one level more specific: a
                             component that knows about receipt statuses or jute balances belongs
                             next to the page that owns that domain, not in the shared components/
                             root. If a second page needs a genuinely reusable version of one of
                             these, promote it — don't fork it.
```

**Rule of thumb for a new UI feature:** if the same rendering logic would apply to a different
stage/ledger/entity with different data, it's a component in `components/`, parameterized by data —
not a new page-specific block. Check `StageForm`, `DataTable`, and `LedgerSection` before writing a
new table or form from scratch.

## State shape — read before editing `TrackingContext.tsx`

**Synchronous reads, asynchronous (optimistic) writes.** Every page reads `receipts` / `masters` /
`ledgerEntries` as plain synchronous values — none of the 11 consuming pages had to become
`async`/await-heavy when the backend was wired up, and new pages shouldn't need to either. Writes
apply to local state immediately (optimistic), fire the API call in the background, and reconcile
with the server's response when it arrives.

**Stage field writes are coalesced, not sent per keystroke.** `FieldInput` is a controlled input
firing `onChange` on every character. `setStageField` buffers edits per `(receiptId, stageId)` and
flushes on a short debounce, on blur, and on page unload — never issues one HTTP request per
character. If you add a new field-editing UI, wire its blur handler to `flushStage(id, stageId)`
(see `StageForm`'s `onFieldBlur` prop) so navigating away doesn't drop an unsent edit.

**A monotonic sequence number guards against stale responses.** If the user keeps typing while a
flush is in flight, the in-flight request's response is discarded rather than overwriting newer
local text. Don't "simplify" this to a plain `.then(setState)` — that reintroduces the race.

**`createReceipt()` is the one method that had to become `Promise<string>`.** Everything else on
`TrackingApi` kept its original signature. This is deliberate, not an oversight: the returned id is
server-assigned and both call sites (`DeliveryPlansPage`, `ReceiptsListPage`) navigate straight into
a URL containing it — a client-guessed provisional id would 404 on reload. If you add a new method
that needs a server-generated value before the caller can proceed, follow this pattern (async,
narrowly), rather than making unrelated methods async "for consistency."

## `TrackingApi` is a frozen interface — extend, don't reshape

Adding a capability (drying jobs, a new master type) as a *new* hook (see `useDryingJobs`) rather
than growing `TrackingApi` is the established pattern, specifically so existing consumers of the
context don't need to change when unrelated features are added. Only touch `TrackingApi` itself if
the change is genuinely about receipts, ledgers, or masters — the three things it already owns.

## Testing gap — read before assuming coverage exists

There is currently no frontend test suite (no `*.test.tsx`, no testing-library dependency). The
correctness-critical logic (`deriveStatus`, the reconciliation math, round-trip fidelity) is tested
in `packages/contract` and `backend`, where it's shared from — that's real coverage, not a gap. What
*is* untested here: the optimistic-update/coalescing behavior in `TrackingContext.tsx` itself, and
component rendering. If you're adding non-trivial logic to the provider (a new race condition to
avoid, a new buffering rule), that's the first place this repo should grow frontend tests, using
something like Vitest + Testing Library — check whether recent work has already added the
dependency before assuming a fresh setup.

## Styling / component conventions

- Design tokens live in `src/styles/tokens.css`; component styles read from CSS custom properties,
  not hardcoded values — see `KpiTile`/`Pill`'s use of `tone` props mapped to token classes.
- `tokens.css` also has a spacing/type/radius/shadow scale (`--space-*`/`--text-*`/`--radius-*`/
  `--shadow-*`), added for the Dashboard maturity pass. Only Dashboard's own CSS actually uses it
  today — this was a deliberate, scoped addition, not a signal that the rest of the app has been
  migrated onto it. Reach for these tokens in new work rather than another hardcoded pixel value;
  don't assume every existing selector already does.
- Charts (`recharts`, added for the Dashboard) use their own small token set —
  `--chart-primary`/`--danger-border`/`--chart-*-wash`/`--chart-grid`/`--chart-axis` — chosen by
  running the `dataviz` skill's `validate_palette.js` against the actual `--card` chart surface,
  not eyeballed. **Load the `dataviz` skill before adding or changing a chart color**, and if you
  change `--chart-primary` or `--danger-border`, re-run the validator (the exact command is in
  `tokens.css`'s comment above those tokens) — they're validated as a pair, not independently.
- Icons are `lucide-react` (added for the Dashboard's KPI tiles and card headings) — small,
  tree-shakeable, import only the icons actually used. Not yet adopted elsewhere in the app;
  extend deliberately, not by reflex, if another page wants icons.
- A `field.v === ""` (real vs `gap` field) or a ledger column's `real: false` drives a visible
  "workbook" vs "new" badge in the UI (`FieldInput`, `LedgerSection`) — this is intentional product
  behavior (the client can see which fields are real today vs proposed), not leftover debug UI.
  Don't strip it when refactoring those components.
