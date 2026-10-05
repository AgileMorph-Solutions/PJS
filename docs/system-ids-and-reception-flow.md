# System IDs and the reception flow

Written from the Anagroci team's review of the Unit Warehouse workbook (Oct 2026). It covers what the
system now issues and calculates itself, the step-by-step reception flow, and how existing data was moved
onto the new IDs. The code is the source of truth — `packages/contract/src/domain/ids.ts` and
`receiptMath.ts` — this is the plain-language version.

## The reception flow

Arrival → Weight → Quality → Unloading → Lot → Bin → GRN. The information arrives at different times,
so each step is filled on its own (`RECEPTION_STEPS` in `packages/contract/src/data/stages.ts`; the receipt
page and the intake wizard both group the stages under these headings). The Warehouse Incharge fills every
step; the Branch Manager and QFS forms are unchanged apart from the fields listed in `usermanagement.md`.

| Step | Stages | Notes |
|---|---|---|
| Arrival | `n-gate`, `n-verify` | Recording it issues the **Receipt ID**. Optionally against a Delivery Plan |
| Weight | `n-gross` | The **loaded** truck is weighed here |
| Quality | `n-qfs` | **Pass** issues the **Lot Number**. Fail → rejected, with a reason, and no Lot |
| Unloading | `n-unload`, `n-tare`, `n-netwt` | The **empty** truck is weighed after unloading; bags, gross, net and paid weight are calculated |
| Lot | `n-lot` | Read-only: shows the Lot the system issued |
| Bin | `n-bin` | Needs a Lot first, as before |
| GRN | `n-grn` | Amount is calculated |

A truck may arrive with **no Delivery Plan** — that is allowed, never blocked.

## IDs

| ID | Format | Issued when | Counter restarts |
|---|---|---|---|
| Receipt | `REC-BKE01-2027-001` | the arrival is recorded | per warehouse code and year |
| Lot | `LOT-BKE01-2027-001` | the truck passes quality (one accepted truck = one Lot) | per warehouse code and year |
| Delivery Plan | `DP-BKE01-2027-001` | the plan is created | per warehouse code and year |
| Transfer | `BKT-2027-001` | the transfer request is created | per year |

- **The year** is the year of the arrival date (plan: expected arrival date; transfer: transfer date), not
  the day the record was typed.
- **The code** comes from the Warehouse master (Masters › Warehouses, admin). Only `BOUAKE = BKE01` was given
  by the team; every other warehouse stays blank until an admin sets it, and **a warehouse with no code
  refuses to issue an ID** rather than guessing one. A code can't be changed once an ID carries it.
- IDs are never reused and never edited. A gap (a cancelled receipt) is fine.
- Nobody types a Lot: the system issues it, and the API refuses a write to the Lot stage. If quality is
  later switched to Fail, the truck keeps its Lot — it is never taken back or handed out again.

## Calculated values

Nobody types these; the server rewrites them whenever an input changes, and the form shows them read-only.
Each formula was checked against the real 2026 workbook first.

| Value | Formula | Real rows that agree |
|---|---|---|
| Gross | loaded truck − empty truck | (the weighbridge readings) |
| Total bags (SACS) | good + damp + torn | 645 of 689 — 44 disagree |
| Net | gross − 1 kg per bag | 728 of 728 |
| Paid weight | net − refraction | 716 of 716 |
| Amount | price × paid weight | 715 of 715 |
| Drying loss | issued net − received net (and ÷ issued) | 138 of 138 |

Imported rows keep exactly what the workbook recorded — they are not recalculated. Where a stored value
disagrees with its formula (the 44 bag totals) the data-quality finding
`stored_value_disagrees_with_formula` reports it.

## Moving existing data onto the new IDs

`backend/scripts/renumberIds.ts` (service: `backend/src/services/renumber.ts`):

```bash
npx tsx scripts/renumberIds.ts                  # dry run: writes renumber-plan.csv, changes nothing
npx tsx scripts/renumberIds.ts --apply          # writes exactly what the dry run listed
```

- Receipts `REC-2026-0001` → `REC-BKE01-2026-001`, in their old order, per warehouse. The old ID is kept in
  `Receipt.legacyId`, and an old link still opens the receipt.
- Lots `17` → `LOT-BKE01-2026-017` — the **same number** in every table that holds one — and BKT numbers
  `BKT001` / `BKT-414` → `BKT-2026-001` / `BKT-2026-414`. The workbook's own text is kept beside the new
  value (`lotNoRaw`, `vyogeNumberRaw`).
- A warehouse with no code is **skipped and listed**. After an admin sets its code, run the script again; it
  finishes that warehouse and leaves the rest alone.
- Also skipped and listed, never guessed: rows with no readable date, values that aren't one lot (`12,5`),
  and the warehouse activity ledger, whose sheet names no warehouse (re-upload it choosing the warehouse).
- `docker compose up` on an empty database ends up with the same IDs (the seed runs the same renumber).

New Lots and BKT numbers continue after the highest existing one, whether or not the renumber has run, so
issuing before it can't collide with an old Lot 1 or BKT001.

## Linked records after the renumber

Receipts are linked to transfers, drying and receiving rows on their **exact Lot or their Fiche**.
Before the renumber a Lot was a bare number, so Bouaké's Lot 17 matched Yakro's Lot 17 — a coincidence
(each warehouse numbers its own lots), and the old code already flagged most of those links as wrong:
about 410 receipts linked to a transfer and only 5 of those links were confirmed by the fiche. With the
warehouse code inside the Lot, an exact match can only be within one warehouse, so those coincidences
are gone. The Fiche, which really does travel with a batch, now carries the cross-warehouse link:
366 receipts link to a transfer and **every** link is fiche-confirmed (369 of 369), and the Reception
list's "issued" flag moved from 51 to 43 for the same reason. Yakro's receipts, which have no Lot, now link
through their Fiche too. `ficheAgrees` on each linked row still says which are confirmed.

## Uploads name their warehouse

The workbook upload is already scoped to the section's warehouse, and `POST /api/imports/preview` now takes
a `warehouse` field. Rows whose own warehouse column names a different site are flagged in the preview and
skipped by default instead of being filed under the chosen one.
