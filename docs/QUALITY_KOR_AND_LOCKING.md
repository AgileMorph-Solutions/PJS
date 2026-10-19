# Quality (KOR) and record locking: the form, the workflow, the rule

_Generated from the application's own definitions (`npm run gen` in packages/contract). Do not edit by hand._

## 1. The form

**"QFS Officer — quality analysis & jute bag check"** is the form the QFS Officer fills for a truck. It is a form of the **Quality analysis (QFS)** step.

| Part | Fields |
|---|---|
| Quality readings and cut test | MOIS. (moisture), NUT COUNT, Sample – Good Kernel (g), Sample – Immature (g), Sample – Spotted (g), Sample – Rejection (g), Sample – Void (g), Sample – Oil (g), Sample – Shell (g), KOR, Final – Good Kernel (g), Final – Immature (g), Final – Spotted (g), Final – Rejection (g), Final – Void (g), Final – Oil (g), Final – Shell (g), FINAL KOR |
| Jute bags | BON SACS (good bags), HUMID SACS (damp bags), Sacs déchirés (torn bags) |

The **Pass / Fail** decision is **not** part of this form: the Warehouse Incharge records it, because a Fail rejects the truck
(a reason is then required, and the rejected truck stays on record).

## 2. How KOR is calculated

- **KOR** = (Good kernel + ½ × (immature + spotted)) × 0.17637 — sample cut test
- **FINAL KOR** = (Good kernel + ½ × (immature + spotted)) × 0.17637 — final cut test

- The constant is **0.17637** (80 lb of kernels per 1000 g sample), taken from the client's own Warehouse Receiving sheet.
- Enter the cut-test grams and KOR is **calculated by the application** and shown read-only.
- If the grams are not entered, KOR can still be **typed**, as every 2026 truck was recorded.
- Once the grams are recorded, the calculated KOR replaces a typed one and can no longer be edited by hand.

## 3. The workflow

1. The **QFS Officer** submits the form above for the truck.
2. The **Warehouse Incharge** reviews it and approves (or rejects) the submission. Until it is approved, nothing is written to the truck.
3. On approval the values are written to the truck's quality step, with who submitted, who approved, and when.
4. The Warehouse Incharge records **Pass** (the truck gets its Lot Number automatically) or **Fail** (with a reason).
5. The **Branch Manager's** separate form ("Branch Manager — reception details") covers VEHICLE NO., SUPPLIERS NAME, LBA CODE, FICHE, PRICE, and is approved the same way.

## 4. Record locking

A truck's reception record **locks automatically when its GRN is complete**: the GRN quantity and the price are both recorded
(in either order; they are entered by different people).

- **What locks:** the reception record from the gate to the GRN. Truck arrives at warehouse (Gate entry); Verify supplier documents; Weight truck (Gross weight); Quality analysis (QFS); Reject / Hold and inform procurement in charge; Unload RCN at warehouse; Weigh truck (Empty – Tare weight); Calculate net weight; Assign Lot Number to truck; Allocate Bin (physical storage location); Generate RCN reception record (GRN); and the Pass / Fail decision (Quality analysis (QFS)).
- **What stays open:** the steps that follow the GRN: the system's stock update, the drying decision and drying, other warehouse
  activities, and the transfer decision.
- **A locked record cannot be changed** from the screens or by an Excel upload (the upload reports the row as an error).
- **Bin allocation** has its own close: pressing **Finalise** stamps the bin allocation date and who did it, and closes that step.
- **Only an Admin can reopen** a locked record or a finalised bin, and must give a **reason**, which is kept on the truck's timeline
  together with who reopened it. It locks again by itself the next time its GRN is completed.
- Records that existed before locking was introduced are **not** locked retroactively.

## 5. The two parts of receiving a truck

One Reception page lists every truck; its status filter has a **Reception** and an **Offloading** choice for these two parts.

- **Reception**: Truck arrives at warehouse (Gate entry) → Verify supplier documents → Weight truck (Gross weight) → Quality analysis (QFS) → Reject / Hold and inform procurement in charge
- **Offloading**: Unload RCN at warehouse → Weigh truck (Empty – Tare weight) → Calculate net weight → Assign Lot Number to truck → Allocate Bin (physical storage location) → Generate RCN reception record (GRN) → Update warehouse RCN stock (System)
