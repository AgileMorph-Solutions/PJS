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
    - **Unit / Regional Warehouse — Bouaké** (`/unit/*`): Truck Reception, Lots & Bins, Drying,
      Dispatch to Central (`WarehouseDispatchLine`, the CHARGEMENT sheet — 544 lines, one row per
      line, grouped by voyage number).
    - **Central Warehouse — Yakro Factory** (`/central/*`): Truck Reception, Receiving from Unit
      (a scoped deep link into Warehouse Transfers — ledger 4 genuinely spans both sites per row, so
      it isn't forked into the site tree), Lots & Bins, Drying, Issue to Production (the BTM-spine
      `issued-to-production` table, viewed per BTM).
    - Within each: RCN Receipts is the register (search, filter by status, filter by store — Bouaké
      has 3 real physical stores under one site, Yakro Factory has one, so the store filter is real
      for one section and absent for the other, not a placebo control); Receipt detail is the
      canonical record — **one page, not forked per site** — all 16 stages as collapsible sections
      editable **in any order**, decision controls for QFS/Drying/Transfer, an activity timeline, and
      a "Linked records" card that can legitimately show a DIFFERENT Lot Number for the same physical
      batch at the other site (that's the point of tracking Lot per-warehouse, not a bug); Lots &
      Bins and Drying are filtered views scoped to that site.
    - Old `/procurement/*` URLs redirect into the right site (a receipt's own `warehouse` field where
      one exists, the larger/Bouaké section otherwise) — see `frontend/src/pages/LegacyRedirects.tsx`.
  - **Jute Management** — the four ledgers as their own pages, top-level (not site-forked, for the
    same ledger-4-spans-both-sites reason above; Warehouse Stock and Warehouse Transfers each carry
    their own in-page site filter instead). Warehouse Stock is backed by real data from `BOUAKE
    WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx` — all 298 rows, with the running balance computed
    server-side by a SQL window function so it has no stored column to drift. Warehouse-to-warehouse
    is backed by its own 367 real rows (now with a real `destinationWarehouse`, header-inferred —
    see `transfer_destination_inferred`); the other two have no row-level source in the client's
    workbooks yet and are flagged as such rather than filled with invented rows.
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

## Running it

The whole stack, from an empty database:

```bash
docker compose up --build
# http://localhost:8080
```

That starts Postgres, waits for it to be healthy, applies the migrations, seeds the real data, and
serves the app with `/api` proxied same-origin — so the browser never needs CORS.

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

## Seed data

`frontend/src/data/seed/` is committed, generated from real client workbooks — not fabricated:

- 50 real RCN receipt rows sampled from `Rcn Offloading Details 2026.xlsx` (987 total rows available),
  spread across every status so the register and dashboard show a realistic mix on first load.
- 75 real suppliers (LBA codes), warehouses (Bouaké BKE-001/002/003, Yakro Factory), and origins.
- Real drying-job history from `Drying_Report_Factory_warehouse.xlsx`.
- Jute Bag warehouse-stock ledger seeded from `BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx`.

Every receipt record carries `source: "imported" | "entered"` so seeded history stays distinguishable
from anything typed into the app.
