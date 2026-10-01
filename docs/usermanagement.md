# User management

**Status: built.** Four roles, per-warehouse scoping, and a submit → approve flow for the two roles
that fill forms after unloading. This replaces an earlier 12-role proposal (Gate Security, Tally
Clerk, Drying Operator, …); the client's discussion settled on the three operational roles below
plus an admin. Role and form definitions live in `packages/contract/src/data/roles.ts`, which both
the API and the UI read.

## Roles

| Role | Scope | What they do |
|---|---|---|
| **Admin** | all warehouses | Creates users, sets roles, assigns each person to **one warehouse**, and assigns each warehouse its Unit/Central type. Can do everything a Warehouse Incharge can, at any warehouse. |
| **Warehouse Incharge** | one warehouse | Top of the operational hierarchy. Fills every stage that isn't a Branch Manager / QFS form (gate, quality analysis, tare, bin, drying, …) **directly, with no approval**. Approves or rejects Branch Manager and QFS submissions. Can correct any entry, including approved ones — every correction is audited. Assigns suppliers to Branch Managers and decides their supplier requests. Runs imports, jute ledgers and masters. |
| **Branch Manager** | one warehouse, plus assigned suppliers | After unloading, submits: truck no., supplier, LBA code, FICHE, gross weight, net weight, lot no., negotiated price. Only sees and reports on suppliers the Warehouse Incharge assigned. Can ask the Warehouse Incharge to add a supplier. |
| **QFS Officer** | one warehouse | After unloading, does the quality analysis (moisture, nut count, KOR, final KOR) and checks the jute bags on the truck (total, good, damp, torn), and submits both together. |

Assumption worth confirming with the client: "request branch manager to add suppliers" was read as
the **Branch Manager requesting the Warehouse Incharge**.

## Warehouses: Unit and Central

`Warehouse.type` is `UNIT` or `CENTRAL`, set on **site** rows only and never defaulted. It is the
app's operational tier, separate from `Warehouse.kind` (the client's own Village / Regional Central /
Factory wording). The seed sets `BOUAKE → UNIT` and `YAKRO FACTORY → CENTRAL` (only where still
NULL, so an admin's later change isn't undone); an admin changes it under Masters › Warehouses.

A user can only be assigned to a site that has a type, so they always have a section to land in.
A non-admin sees only the section matching their warehouse's type, scoped to their warehouse.

Known gap: `YAMOUSSOUKRO` exists as a site-level row with no type or kind (a live data quirk — it's
also an alias of `YAKRO FACTORY`). It can't have users until an admin types it; you probably want
to leave it alone.

## The approval flow

1. The Warehouse Incharge logs the truck at gate entry, which creates the receipt (the existing flow).
2. After unloading, the Branch Manager and the QFS Officer each open the receipt and fill **their own
   form** (the other stage cards are read-only for them) and press *Submit for approval*.
3. The submission is stored as-is. It touches **no** stage table, so derived status doesn't move.
4. The Warehouse Incharge sees the current → submitted diff on the receipt (or in *Approvals*) and:
   - **Approves** — the values are applied through the normal stage-write code, together with the
     status/timeline change, in one transaction. The timeline shows who approved.
   - **Rejects** with a reason — **final**. Nothing is applied and the form can't be resubmitted;
     the Warehouse Incharge fixes the receipt directly afterwards. (This is separate from rejecting
     the *truck* at QFS, which is still the `n-qfs` fail branch.)
5. A lot number that clashes with another receipt at the same warehouse is refused at submit time
   and again at approval.

Every changed field — a Warehouse Incharge's direct edit or an approval — is recorded in
`StageFieldChange` (who, when, old → new, `direct` | `approval`).

### What each form writes

| Form | Stage → field |
|---|---|
| Branch Manager | `n-gate` VEHICLE NO. · `n-verify` SUPPLIERS NAME, LBA CODE, FICHE · `n-gross` GROSS WT KGS · `n-netwt` NET WT KGS · `n-lot` Lot Number · `n-grn` PRICE |
| QFS Officer | `n-qfs` MOIS. (moisture), NUT COUNT, KOR, FINAL KOR · `n-unload` SACS (bags), BON SACS (good bags), HUMID SACS (damp bags), Sacs déchirés (torn bags) |

The QFS **Pass / Fail** decision is not part of the form: the Warehouse Incharge records it, because a
Fail rejects the truck. Approving the QFS form writes the four measurements only — it sets no
decision, so it doesn't by itself move a receipt past QFS.

"Fiche number" is the `FICHE` column, not `FICHE CODE`. `n-netwt` is `kind: "system"` in `stages.ts`
("never typed"), but the client wants the Branch Manager's figure as the workbook records it today;
the conflict is noted on that stage rather than resolved silently.

## Adding several trucks at once (Warehouse Incharge)

Reception › **Add trucks** opens a grid: one row per truck (one truck or many), with the fields known at the
gate — date of arrival, vehicle no. (required), supplier (a picker that fills both supplier name and
LBA code), fiche no., credit/cash, origin, remarks. **Create** opens every row as a receipt in one
step, at the incharge's own warehouse.

- **All or nothing.** Every row is checked first and everything is written in one transaction, so a
  bad row (say row 7 has no vehicle no., or a date that isn't a real `YYYY-MM-DD`) creates *no*
  receipts and the message names the row. Nothing is half-created.
- **Same as a hand-entered truck.** Each row gets the next `REC-<year>-NNNN`, the gate/supplier-document
  stages are written through the normal stage code (so status shows *Pending QA*, or *Arrived* if the
  row had no supplier details), and every field is audited. Weights, lot, bin, etc. are filled on each
  receipt afterwards.
- Blank rows are ignored; new rows copy the previous row's date; Enter jumps to the same column in the
  next row; a row can be duplicated (keeps supplier and date, clears vehicle and fiche). At most 200
  trucks per batch.
- Warehouse Incharge and admin only — a Branch Manager or QFS Officer can't reach it. Columns are
  defined in `packages/contract/src/data/batchEntry.ts`.
- For a large backlog that already exists in a workbook, the Reception *Upload* is still the better tool.

## Enforcement

- **Sign-in:** httpOnly session cookie; every `/api/*` route except health and login is 401 without it.
- **Warehouse scope:** non-admins are pinned to their own warehouse; asking for another is 403.
- **Default-deny for Branch Manager / QFS Officer:** `backend/src/auth/policy.ts` lists the only
  requests they can make. They can read receipts and submit their form; nothing else.
- **Branch Managers** additionally only see receipts whose LBA code is one of their assigned
  suppliers (a receipt with no LBA code yet stays visible, so they can open a freshly gated truck).
- The UI hides what a role can't use (`config/nav.ts` `roles`, `RequireRole`, read-only stage cards),
  but the API is the actual gate.

## Not built / left alone

- **Old data has no actor.** Seeded and imported receipts, and their timeline entries, keep
  `actorId = NULL` — naming an author for them would be fabricating one.
- **Several warehouses of the same type.** Users are pinned to their own warehouse and the section
  follows its type, but there's no picker for an admin to choose among multiple Unit warehouses; an
  admin sees the two existing sections (Bouaké, Yakro Factory).
- **Roles from the old proposal** (Gate Security, Tally Clerk, Quality Head, Drying Operator,
  Procurement Manager, …) aren't modelled; the Warehouse Incharge covers those stages for now.
- **No self-service password change or password-reset flow** — an admin resets passwords.
- **No login rate limiting.**

## Setting up

**Demo accounts (dev).** `docker compose up --build` seeds one account per role, all with the same
password — `demo-pass-123` unless you set `DEMO_PASSWORD`:

| Username | Role | Warehouse |
|---|---|---|
| `admin` | Admin | all |
| `incharge.bouake` | Warehouse Incharge | BOUAKE (Unit) |
| `manager.bouake` | Branch Manager | BOUAKE (Unit) |
| `qfs.bouake` | QFS Officer | BOUAKE (Unit) |

They are created only if the username doesn't exist yet (a changed password is never reset), and the
Branch Manager starts with **no suppliers** — sign in as `incharge.bouake` and assign some under
*Supplier assignment*. The password is publicly known: for anything shared or deployed, set
`SEED_DEMO_USERS=false` (nothing runs without `SEED_DEMO_USERS=true` and a `DEMO_PASSWORD`) and
create real accounts instead. There is no Central-warehouse demo user; create one under Users.

**Your own first admin.** Set `ADMIN_USERNAME` (default `admin`) and `ADMIN_PASSWORD`; the seed
creates it only while no admin exists. With no password set, none is created.

```bash
SEED_DEMO_USERS=false ADMIN_PASSWORD='choose-one' docker compose up --build
# or, against a local database:
ADMIN_USERNAME=admin ADMIN_PASSWORD='choose-one' npm run seed -w backend
```

Then, under Masters › Warehouses confirm each warehouse's type; under Users create a Warehouse
Incharge, Branch Managers and QFS Officers per warehouse; the Warehouse Incharge assigns suppliers
under *Supplier assignment*. Set `COOKIE_SECURE=true` when serving over HTTPS.
