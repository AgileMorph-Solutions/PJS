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
  - **Procurement**
    - RCN Receipts (`/procurement/receipts`) — the register: search, filter by status/warehouse, sort. Once a receipt has a Lot Number, it's known by that Lot from then on, not by the truck that delivered it.
    - Receipt detail (`/procurement/receipts/:id`) — the canonical record. All 16 stages as collapsible
      sections editable **in any order**, decision controls for QFS/Drying/Transfer, and an activity
      timeline (doc §7's activity ledger).
    - New RCN receipt (`/procurement/receipts/new/:id/:stageId`) — the guided intake wizard, for a
      gate operator entering a brand-new truck end to end. Writes into the same record the detail
      page shows.
    - Delivery Plans, Lots & Bins, Drying Jobs — filtered views over the same receipt records (Lots &
      Bins), plus real drying-job history from `Drying_Report_Factory_warehouse.xlsx`.
  - **Jute Management** — the four ledgers as their own pages. Warehouse Stock is backed by real
    data from `BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx` with a running balance that
    continues correctly when you add an entry; the other three are ready for data, flagged as such.
  - **Production** (`/production`) — explicit placeholder: not built, phases/workbooks listed so the
    module list stays honest about what's coming rather than hiding it.
  - **Masters** — Suppliers, Warehouses, Bins, seeded from the real LBA codes and warehouse/bin
    codes in the workbook, with an add form for anything new.
  - Every read/write goes through `src/repository/` (localStorage today, versioned key) so swapping
    in a real backend later touches one layer, not every page.
- `backend/` — placeholder only, not started. See `backend/README.md`.
- `tools/extract-seed.py` — regenerable: reads the real client workbooks with openpyxl and writes
  `frontend/src/data/seed/*.json`. Re-run it and rebuild if the source workbooks change; the app
  never reads `.xlsx` directly.

## Running it

```bash
cd frontend
npm install
npm run dev       # http://localhost:5173
```

Or via Docker:

```bash
docker compose build
docker compose up
# http://localhost:8080
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
