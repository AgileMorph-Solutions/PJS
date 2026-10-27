# anagroci-cashew-management

Tracking software for ANAGROCI's cashew (RCN) operations — Procurement is live, Jute Bag
Management is its own section, Production is a placeholder. Built as a follow-on from the static
process maps in `../flow-xl-map/` (`Procurement.html`, `NewProcurement.html`, `Production.html`);
those stay the source of truth for what each stage/field means, this app is where it gets tracked.

## What changed from the first pass

The first version of this app was one guided form sequence — a single implicit truck arrival,
walked stage by stage. This version is built around **records and statuses**: many RCN Receipts,
each with its own status derived from what's actually been filled in, listed/filtered/searched in a
register, with history seeded from the client's real workbooks so it opens looking like software
with data in it, not an empty demo.

The core entity is a **Receipt**, not a truck: a truck only delivers it. Once a Receipt is assigned
a Lot Number (confirmed client rule: one truck = one Lot, always), the Lot is what's tracked from
there on — through its Bin, drying, and any transfer — long after the truck itself has left. The
register, dashboard, and any place still describing "trucks" mid-lifecycle lead with the Lot
instead; the vehicle/truck is kept only as provenance on the record.

## Structure

- `frontend/` — Vite + React + TypeScript.
  - **Dashboard** (`/`) — the RCN receipt status counts doc §3 requires (total received, accepted &
    unloaded, GRN completed, pending QA, pending unload after QA, rejected), each linking into the
    register pre-filtered, plus the jute warehouse-stock running balance and recent activity.
    Aggregates both sites below — there's no single site to scope a dashboard KPI to.
  - **Two site sections** (Sept 2026: the client's own process genuinely splits here — each site has
    its own source workbooks, and a Lot number only means something together with its warehouse; see
    `docs/UPLOAD_GUIDE.md`'s "Lot uniqueness is enforced per warehouse" and
    `packages/contract/src/data/warehouseKinds.ts`). Both render through one `/:site/*` route tree
    (`frontend/src/config/sites.ts`, `frontend/src/state/SiteContext.tsx`), not two duplicated page
    trees — a page reads `useSite()` for which warehouse to scope its API calls to, never a
    hardcoded name:
    - **Unit / Regional Warehouse — Bouaké** (`/unit/*`) and **Central Warehouse — Yakro Factory**
      (`/central/*`) each expose exactly **Reception, Lots & Bins, Drying** — three sidebar entries,
      not six. Dispatch to Central (`WarehouseDispatchLine`/CHARGEMENT), Receiving from Unit
      (`WarehouseDischarge`/Warehouse Receiving) and Issue to Production (`IssuedToProduction`) used
      to be their own standalone pages; that data is now surfaced from Reception instead — a
      per-receipt "Downstream" status column (dispatched/received/dried/issued, computed by
      `backend/src/services/receiptsDownstream.ts`), full linked rows on that receipt's own detail
      page (`backend/src/services/receiptLinks.ts`), and an "Import ..." card per workbook shape
      that belongs on Reception (see `docs/UPLOAD_GUIDE.md`'s mapping table).
    - Within each: Reception is the register (search, filter by status, filter by store — Bouaké
      has 3 real physical stores under one site, Yakro Factory has one, so the store filter is real
      for one section and absent for the other, not a placebo control); Receipt detail is the
      canonical record — **one page, not forked per site** — all 16 stages as collapsible sections
      editable **in any order**, decision controls for QFS/Drying/Transfer, an activity timeline, and
      a "Linked records" card that can legitimately show a DIFFERENT Lot Number for the same physical
      batch at the other site (that's the point of tracking Lot per-warehouse, not a bug), plus the
      dispatch/warehouse-receiving/drying-batch/production rows reached via FICHE or Lot; Lots &
      Bins and Drying are filtered views scoped to that site.
    - Old `/procurement/*` URLs redirect into the right site (a receipt's own `warehouse` field where
      one exists, the larger/Bouaké section otherwise) — see `frontend/src/pages/LegacyRedirects.tsx`.
  - **Jute Management** — the four ledgers as their own pages, top-level (not site-forked, for the
    same ledger-4-spans-both-sites reason above; Warehouse Stock and Warehouse Transfers each carry
    their own in-page site filter instead). Warehouse Stock is backed by real data from
    `ANAGROCI DATA PROCUREMENT 2026.xlsx`'s "Jute Bags movement" sheet — 298 rows; that export
    carries no BALANCE column at all, so the running balance is entirely computed server-side by a
    SQL window function (never read from a stored column, so nothing to drift). Warehouse-to-
    warehouse is backed by 415 real rows from "Bouake RCN Receiving at Factory Report.xlsx" (now
    with a real `destinationWarehouse`, header-inferred — see `transfer_destination_inferred`); the
    other two have no row-level source in the client's workbooks yet and are flagged as such rather
    than filled with invented rows.
  - **Production** (`/production`) — explicit placeholder: not built, phases/workbooks listed so the
    module list stays honest about what's coming rather than hiding it.
  - **Masters** — Suppliers, Warehouses, Bins, seeded from the real LBA codes and warehouse/bin
    codes in the workbook, with an add form for anything new. Warehouses now carry a real typology
    (`kind`: Village/Regional Central/Factory, set only on site rows) and a `site` self-reference (a
    store's parent site) rather than one flat name list.
  - Every read/write goes through `src/repository/` — now `api.ts` against the backend. That swap
    landed as designed: it touched the repository layer and `TrackingContext`, and of the eleven
    consumer pages, seven needed no change at all. `TrackingApi` kept its shape, with reads staying
    synchronous and writes going optimistic; only `createReceipt` became async, because the id is
    assigned by the server and its call site navigates straight to it.
- `backend/` — **built**: Fastify + Prisma + PostgreSQL, with the 16 stages normalized into real
  tables and the jute reconciliation as a SQL view. See `backend/README.md`.
- `packages/contract/` — the shared source of truth for both sides: the stage/ledger dictionaries,
  the domain types, and `deriveStatus()`. The backend used to hand-copy these files; now there is
  one copy, and a codegen step plus four tests keep the field dictionary and the database schema
  from drifting apart.
- `tools/extract-seed.py` — regenerable: reads the real client workbooks with openpyxl and writes
  `frontend/src/data/seed/*.json`. Re-run it and rebuild if the source workbooks change; the app
  never reads `.xlsx` directly.
- `tools/extract-jute.py` — the same, for the two jute ledgers that have real row-level source data
  (298 warehouse movements, 367 transfer receipts). Mixed-type cells are kept verbatim in a `*Raw`
  twin rather than coerced.
- `tools/extract-application-view.py` — the client's APPLICATION VIEW workbook (Oct 2026): their 10
  Delivery Plans and, per truck, the plan, rejection, GRN quantity, Bin and approval it records, written
  to `applicationView.json` and applied on top of the receipts by `backend/scripts/applyApplicationView.ts`
  (fill blanks only, report every conflict). It also writes the test fixture of what that workbook shows,
  which `backend/tests/applicationViewParity.test.ts` holds the app's derived values against.

## Running it

The whole stack, from an empty database:

```bash
docker compose up --build
# http://localhost:8080
```

This is the **dev** stack, with hot reload: `./backend`, `./frontend` and `./packages/contract` are
bind-mounted into the containers, the frontend runs the Vite dev server and the backend runs
`tsx watch`, so a saved file shows up in the browser within a second or two — no rebuild. Rebuild
(`docker compose up --build -V`, the `-V` renews the containers' `node_modules`) only when a
`package.json` dependency changes; restart the backend (`docker compose restart backend`) after a new
Prisma migration or a `schema.prisma` change. Production is `docker-compose.prod.yml` (see DEPLOY.md).

That starts Postgres, waits for it to be healthy, applies the migrations, sets up the two sites and the
user accounts (no data is loaded since Oct 2026 — the team starts from an empty database), and serves the app with `/api` proxied same-origin — so the browser never needs CORS.

For development, with hot reload:

```bash
npm install                  # workspace root: packages/contract, backend, frontend
docker compose up -d db
npm -w backend run prisma:migrate
npm -w backend run seed
npm -w backend run dev       # :3000
npm -w frontend run dev      # :5173, proxies /api to :3000
```

Tests and the codegen drift check:

```bash
npm -w backend test          # needs the db running
npm run gen:check            # fails if the generated stage map is stale
```

## Demo accounts (dev only)

`docker compose up --build` seeds one account per role per site, all sharing one password —
`demo-pass-123` unless `DEMO_PASSWORD` is set. They are created only when `SEED_DEMO_USERS=true` and
a `DEMO_PASSWORD` is present, and an existing username is never reset.

| Username | Role | Warehouse |
|---|---|---|
| `admin` | Admin | all |
| `incharge.bouake` | Warehouse Incharge | BOUAKE (Unit) |
| `manager.bouake` | Branch Manager | BOUAKE (Unit) |
| `qfs.bouake` | QFS Officer | BOUAKE (Unit) |
| `incharge.yakro` | Warehouse Incharge | YAKRO FACTORY (Central) |
| `manager.yakro` | Branch Manager | YAKRO FACTORY (Central) |
| `qfs.yakro` | QFS Officer | YAKRO FACTORY (Central) |

The password is publicly known — for anything shared or deployed set `SEED_DEMO_USERS=false` and
create real accounts (first admin via `ADMIN_USERNAME`/`ADMIN_PASSWORD`). See `docs/usermanagement.md`.

## Seed data

**No longer loaded into the database (Oct 2026):** the team started fresh, and `prisma/seed.ts` now sets up only
the sites and user accounts. The files below are kept as the record of the client's workbooks.

`frontend/src/data/seed/` is committed, generated by `tools/extract-seed.py` and
`tools/extract-jute.py` from the real workbooks under `docs/Procurement/new sheets/` — not
fabricated, and not a demo sample:

- `applicationView.json` — what the client's APPLICATION VIEW workbook adds (see
  `docs/system-ids-and-reception-flow.md`): 10 Delivery Plans that the workbook itself says were
  *reconstructed from 2026 receipts*, so each keeps that as its planning basis; nothing in it replaces a
  value the app already holds.
- All 986 real RCN receipt rows from `ANAGROCI DATA PROCUREMENT 2026.xlsx`'s "Truck Reception"
  sheet — every stage a receipt gets is one its own row actually supports (see
  `docs/UPLOAD_GUIDE.md`'s "per-stage presence rule"); no branch/decision is ever fabricated, so the
  seed alone never shows a "rejected" or "in drying" receipt — those only appear once a real
  decision or a later import (Lot assignment, Drying Batch, …) adds them.
- 78 real suppliers (from the sheet's own dedicated "Suppliers" tab, unioned with any code only
  ever seen on a receipt row), warehouses (Bouaké BKE-001/002/003, Yakro Factory), and origins.
- Jute Bag warehouse-stock ledger (298 rows) and warehouse-to-warehouse transfers (415 rows) from
  the same consolidated workbook's "Jute Bags movement" sheet and "Bouake RCN Receiving at Factory
  Report.xlsx" respectively — see `docs/UPLOAD_GUIDE.md`'s mapping table for the rest.
- `DryingJob` is deliberately NOT seeded any more — `DryingBatch` (from the "Drying Batch" sheet,
  imported separately through the UI) is its replacement source; see
  `backend/src/services/dryingBatches.ts`'s header comment for why the two were never merged.

Every receipt record carries `source: "imported" | "entered"` so seeded history stays distinguishable
from anything typed into the app.
