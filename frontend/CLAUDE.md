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
src/state/AuthContext.tsx   `useAuth()` / `useMe()` — who is signed in. App.tsx renders LoginPage until
                             there is one, and keys TrackingProvider by user id. Role-gated routes use
                             `components/RequireRole`, nav items carry `roles` (config/nav.ts) — both
                             are courtesy; backend/src/auth/policy.ts is the real gate. Non-admins are
                             pinned to their own warehouse's section in SiteContext.
src/config/sites.ts          The two real sites (Bouaké/Yakro Factory) as URL slugs + the real
                             `Warehouse.name` each one scopes API reads by. Adding a third site is
                             meant to be one more entry here — see its own header comment.
src/state/SiteContext.tsx   `useSite()` — reads the `/:site/*` route's own param, resolves it via
                             `config/sites.ts`, 404s on an unrecognized slug. Every page under
                             `pages/warehouse/`, `pages/unit/`, `pages/central/` calls this for
                             which warehouse to scope its own API calls by — never a hardcoded site
                             name in a page component.
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
                             package or the backend). `pages/warehouse/` is site-scoped (rendered
                             under `/:site/*`, reads useSite()); `pages/unit/` and `pages/central/`
                             hold the one page each site has that the other doesn't (Dispatch,
                             Issue to Production). Where a page's columns genuinely differ per site
                             (check by comparing real stage fields in stages.ts — most pages don't),
                             it gets a sibling `columns.tsx` exporting `Record<SiteSlug, Column[]>`
                             — see `pages/warehouse/columns.tsx` — never an inline
                             `site === "unit" ? ... : ...` in JSX.
src/components/dashboard/   Domain-aware components scoped to one page (Dashboard — DateRangeFilter,
                             the two chart components). Same reasoning as the components/ vs
                             components/ui/ split, one level more specific: a component that knows
                             about receipt statuses or jute balances belongs next to the page that
                             owns that domain, not in the shared components/ root. If a second page
                             needs a genuinely reusable version of one of these, promote it — don't
                             fork it.
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
server-assigned and its call site (`ReceiptsListPage`) navigates straight into a URL containing it
— a client-guessed provisional id would 404 on reload. If you add a new method that needs a
server-generated value before the caller can proceed, follow this pattern (async, narrowly),
rather than making unrelated methods async "for consistency."

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

## Styling — Tailwind v4, a warm terracotta/warmstone identity

The app was rebuilt end to end (Sept 2026) on **Tailwind CSS v4** (`@tailwindcss/vite`, wired in
`vite.config.ts`) with **Material Symbols Outlined** for icons, replacing the earlier hand-rolled
CSS-custom-property system (`tokens.css` — deleted) and `lucide-react`. This is the current, only
styling approach; there is no legacy CSS to bridge or migrate away from anymore.

- **Theme lives in `src/styles/global.css`'s `@theme` block** — `@import "tailwindcss";` at the top,
  then every custom color/shadow token as a `--color-*`/`--shadow-*` CSS variable, which Tailwind
  v4 auto-generates utility classes from (`--color-brand-700` → `bg-brand-700`/`text-brand-700`/
  etc., no `tailwind.config.js` needed). Five semantic color families: `brand` (terracotta —
  primary actions, the active/current step), `warmstone` (neutrals — surfaces, borders, muted
  text, "automatic/system" states), `ambernut` (highlights, pending/decision states), `success`
  (passed/done/good), `danger` (rejected/critical — kept deliberately distinct from `brand` so a
  primary-action button and a "rejected" badge never share a color).
- **`Pill`'s tone prop** (`entry`/`decision`/`system`/`term`/`gap`) maps onto that palette —
  `entry`→success, `decision`→ambernut, `system`→warmstone, `term`→brand (muted weight, never the
  vivid CTA weight, so a terminal-state badge never reads as a button), `gap`→danger. See
  `Pill.tsx`'s header comment before changing the mapping.
- **Chart colors are their own dedicated tokens** (`--color-chart-primary` plus its wash
  variants), not reused from `brand`/`success` — both were tried first and failed the CVD-safety
  check against `danger` (classic red/green and red/red-adjacent confusion), which is exactly why
  a separate, validated pair exists. **Load the `dataviz` skill before adding or changing a chart
  color**, and re-run the validator (the exact command is in `global.css`'s comment above those
  tokens) before changing `--color-chart-primary` or `--color-danger-700` — they're validated as a
  pair, not independently.
- **Icons are Material Symbols Outlined**, loaded as a variable web font in `index.html` (alongside
  Plus Jakarta Sans for headings/UI and Inter for body text — also replaced Spectral/IBM Plex
  Mono). Used as `<span className="material-symbols-outlined">icon_name</span>`; add `.fill` for
  the filled variant. Numeric alignment uses `.tabular-nums` (or Tailwind's `tabular-nums`
  utility) on values that need to line up in a column — not a dedicated mono typeface anymore.
- **This redesign is style-only, real data only** — it took its color/type/icon/card language from
  a Stitch mockup of the Receipt Detail page, but every invented field in that mockup (Crop Year,
  Harvest Batch, a National Board Code, a security seal, per-layer bag-stacking detail, a
  fictional fixed "5 steps") was left out. `ReceiptDetailPage.tsx` still walks the real ~16-stage
  model from `stages.ts`, and every stat block only renders when the underlying stage field is
  actually present — never a placeholder number. Follow this precedent for future design
  references: take the visual language, not whatever data the reference happened to display.
- A `field.v === ""` (real vs `gap` field) or a ledger column's `real: false` drives a visible
  "workbook" vs "new" badge in the UI (`FieldInput`, `LedgerSection`) — this is intentional product
  behavior (the client can see which fields are real today vs proposed), not leftover debug UI.
  Don't strip it when refactoring those components.
