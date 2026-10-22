# System IDs and the reception flow

Written from the Anagroci team's review of the Unit Warehouse workbook (Oct 2026), and then of their
APPLICATION VIEW workbook and email. It covers what the system now issues and calculates itself, the
step-by-step reception flow, the Delivery Plan before it and the BKT transfer after it, and how existing
data was moved onto the new IDs. The code is the source of truth — `packages/contract/src/domain/ids.ts` and
`receiptMath.ts` — this is the plain-language version.

## The whole flow

Delivery Plan → Truck Arrival → Reception → Quality → Weighing → Unloading → GRN → Lot → Bin → Stock → BKT transfer

A **Delivery Plan** is a pre-alert: what Procurement expects (supplier, origin, store, delivery window,
quantity, number of trucks, funding reference) so the warehouse can prepare space, people, the weighbridge
and quality control. It does **not** create stock and is not the reception. One plan covers several trucks;
each truck's reception is linked to it, and the plan then shows — never typed — what has arrived, what is
still expected, and any difference or delay. A truck with **no plan** is always accepted, flagged
*Unplanned*, and can be linked to its plan afterwards.

Each truck reads as **Planned**, **Planned with exception** or **Unplanned**. An exception is any way it
differs from its plan: a different origin, a different store, early or late, over the planned quantity, or
the plan was cancelled. A truck that needs a decision is approved once by the Warehouse Incharge (who and
when are recorded); approval never holds the truck up. A rejected truck needs none.

## The reception flow

Arrival → Weight → Quality → Unloading → Lot → Bin → GRN. The information arrives at different times,
so each step is filled on its own (`RECEPTION_STEPS` in `packages/contract/src/data/stages.ts`; the receipt
page and the intake wizard both group the stages under these headings). The Warehouse Incharge fills every
step; the Branch Manager and QFS forms are unchanged apart from the fields listed in `usermanagement.md`.

| Step | Stages | Notes |
|---|---|---|
| Arrival | `n-gate`, `n-verify` | Recording it issues the **Receipt ID**. Optionally against a Delivery Plan |
| Weight | `n-gross` | The **loaded** truck is weighed here |
| Quality | `n-qfs` | **Pass** issues the **Lot Number**. Fail → rejected, with a reason, and no Lot. Record the **cut test** (sample and final grams) and **KOR is calculated** from it |
| Unloading | `n-unload`, `n-netwt` | Bags are counted; net and paid weight are calculated. (Oct 2026: the **empty** truck (tare) reading is recorded in the weight step `n-gross`, with the loaded one; gross is calculated from the two, or typed from the ticket.) |
| Lot | `n-lot` | Read-only: shows the Lot the system issued |
| Bin | `n-bin` | Needs a Lot first. A Bin is a place **inside** a store (`BKE-002-BIN-012`), chosen from the Bin master — never the store code itself |
| GRN | `n-grn` | **GRN Quantity** is suggested from the net weight and confirmed; the receipt only reads *GRN completed* once it is recorded. Amount is calculated |

A truck may arrive with **no Delivery Plan** — that is allowed, never blocked.

## IDs

| ID | Format | Issued when | Counter restarts |
|---|---|---|---|
| Receipt | `REC-BKE-2027-0001` | the arrival is recorded (every truck, rejected or not) | per warehouse code and year |
| Lot | `LOT-BKE-2027-0001` | the truck passes quality (one accepted truck = one Lot) | per warehouse code and year |
| Delivery Plan | `DP-BKE-2027-001` | the plan is created | per warehouse code and year |
| Transfer | `BKT-2027-001` | the transfer request is created | per year |

- **The year** is the year of the arrival date (plan: expected arrival date; transfer: transfer date), not
  the day the record was typed.
- **The code** comes from the Warehouse master (Masters › Warehouses, admin). The client has given two:
  `BOUAKE = BKE` and `YAKRO FACTORY = YAK` (their APPLICATION VIEW workbook, Oct 2026 — it supersedes the
  `BKE01` in their earlier email). Every other warehouse stays blank until an admin sets it, and **a
  warehouse with no code refuses to issue an ID** rather than guessing one. Receipts and Lots are padded to
  four digits, plans and transfers to three, exactly as in the client's workbook; past that the number just grows.
- **IDs issued under `BKE01`** keep their number and move to `BKE` when `renumberIds.ts` runs; an old
  `REC-BKE01-…` link still opens the receipt. Until it has run, new IDs continue after the highest number held
  under any code, so a new receipt can never take a number the renumber is about to give an old one.
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
| Net | gross − 1 kg per bag | 728 of 728; 58 of 58 in the client's APPLICATION VIEW workbook |
| Paid weight | net − refraction | 716 of 716 |
| Amount | price × paid weight | 715 of 715 |
| Drying loss | issued net − received net (and ÷ issued) | 138 of 138 |
| KOR / Final KOR | (good kernel + ½ × (immature + spotted)) × 0.17637 — sample and final cut test | the client's own Warehouse Receiving formula |

**Net, GRN Quantity and Paid Weight are three different values.** Net is what the scale says less the bags;
GRN Quantity is what the warehouse officially recognises into stock (suggested from Net, confirmed by a
person); Paid Weight is the commercial quantity the supplier is paid for (Net less refraction). KOR is
calculated only once all three of good, immature and spotted are recorded — until then it is typed, because
the 2026 Truck Reception sheet only ever held the final KOR.

Imported rows keep exactly what the workbook recorded — they are not recalculated. Where a stored value
disagrees with its formula (the 44 bag totals) the data-quality finding
`stored_value_disagrees_with_formula` reports it.

## Transfers: one BKT, one truck

A BKT (`BKT-2026-001`) is one truck / one voyage — the same BKT number everywhere, in Dispatch and in Stock
Transfers. A truck loading from several Bins is several lines under the one BKT, and the truck stays the same;
a truck can't be dispatched on a second BKT while its first hasn't arrived.

The two warehouses each write their own half and never the other's:

- **Bouaké dispatches** — the truck, the driver, the loaded weight at its scale, and the Lots (with their Bins).
- **Yamoussoukro receives** — bags received, gross weight at *its* scale, damaged bags, KOR, moisture, nut count.
  All of this is **blank until the truck actually arrives**.

The system then works out the bag variance, the net weight at arrival (gross − 1 kg per bag) and the weight
variance, and the transfer reads **Requested → In transit → Closed** (what arrived matches what left) or
**Discrepancy** (any difference — the client's own rule; a tolerance is a decision they haven't made yet).

## What the client's APPLICATION VIEW workbook added to the data

`backend/scripts/applyApplicationView.ts` (service `backend/src/services/applicationView.ts`; extractor
`tools/extract-application-view.py`) applies it on top of the receipts already held, and `docker compose up`
on an empty database runs it from the seed. It fills what is blank and **reports, never overwrites**:

- the 10 Delivery Plans (the workbook says they were *reconstructed from 2026 receipts*, and stores that in
  each plan's planning basis), which plan each truck arrived against, the 18 trucks it marks rejected, the GRN
  Quantity and Bin it records, and the exception approvals (with no approver or date — the workbook names none);
- **not applied**: its typed Plan Status / Reception Type / flags (the app derives them, and the parity test
  holds the two to account), its Lot and Receipt IDs (the app keeps the real warehouse lots), and its 25 BKT
  transfers (its rows identify the transfer's paperwork, not the supplier Lots on the truck — linking them
  would mean inventing the link);
- 10 plan-linked trucks were **received at Yakro Factory** but belong to Bouaké plans; the app never links a
  truck to another site's plan, so they are listed, not moved.

The audit (`GET /api/data-quality`) also reports what this surfaced in the real data: 257 trucks whose remarks
say REJECT but aren't marked rejected, 877 receipts with a price and no GRN quantity, a store code used as a
Bin, one BKT on two trucks, one receiving Lot number on two BKTs.

## Moving existing data onto the new IDs

`backend/scripts/renumberIds.ts` (service: `backend/src/services/renumber.ts`):

```bash
npx tsx scripts/renumberIds.ts                  # dry run: writes renumber-plan.csv, changes nothing
npx tsx scripts/renumberIds.ts --apply          # writes exactly what the dry run listed
```

- Receipts `REC-2026-0001` → `REC-BKE-2026-0001`, in their old order, per warehouse. The old ID is kept in
  `Receipt.legacyId` (always the **original** `REC-2026-NNNN`, even after a second move), and an old link
  still opens the receipt. IDs already in the system format are brought to the current code and padding with
  the same number (`REC-BKE01-2026-001` → `REC-BKE-2026-0001`), and so are plans (`DP-…`).
- Lots `17` → `LOT-BKE-2026-0017` — the **same number** in every table that holds one — and BKT numbers
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
