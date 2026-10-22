# End-to-end demonstration: one truck, from arrival to Yamoussoukro

Follows the team's review points in order. Use the live site with the demo accounts (the password is `DEMO_PASSWORD` in `.env.prod`):
`incharge.bouake` (Warehouse Incharge, Bouaké), `qfs.bouake` (QFS Officer), `manager.bouake` (Branch Manager),
`incharge.yakro` (Warehouse Incharge, Yakro Factory) and `admin`. Nothing here needs special data: pick any supplier that has an open
Delivery Plan. Allow about 25 minutes.

## 1. Date fills itself, and the truck arrives against a plan  (review points 1, 2)
1. Sign in as `incharge.bouake`. **Delivery plans** → open a plan → **Record arrival**.
2. The new truck opens. Under **Reception**, open **Truck arrives at warehouse**: the helper line says the arrival date fills itself.
   Type a truck number, save: **DATE OF ARRIVAL** is now filled (the day the truck arrived) without typing.

## 2. Reception: weigh, quality, KOR  (points 2; KOR question)
3. Sidebar **Reception** lists every truck. In the status filter choose **Reception**: this truck is there. Choose **Offloading**: it is not listed yet.
4. Fill supplier documents and the loaded weight.
5. Sign in as `qfs.bouake` → open the truck → **QFS Officer — quality analysis & jute bag check**. Enter moisture and the **cut-test
   grams**: **KOR appears by itself** (read-only). Submit.
6. Back as `incharge.bouake` → **Approvals** → approve. Open the truck, **Quality** step → **Pass**: the **Lot Number is issued**.
   The truck now shows under the **Offloading** filter instead of **Reception**.

## 3. Offloading: unload, bin, GRN, lock  (points 1, 2, 4; locking)
7. Sidebar **Reception**, status filter **Offloading** → open the truck. **Unload**: enter good, damp and torn bags: **DATE OF OFFLOADING fills itself**. The loaded and empty
   truck weights are both entered in the **Weight** step (gross is calculated from them, or typed from the ticket): **net weight is calculated**.
8. **Masters → Bins → Add bin**: a new bin code, choose its **store**. Back on the truck (in the same store), **Allocate Bin**: the new bin is offered first.
   Choose it, press **Finalise bin allocation**: the **allocation date and your name are stamped**; the step closes.
9. **GRN**: as the Incharge, enter the GRN quantity (the Incharge sees no price or amount anywhere). Sign in as `manager.bouake`, open the truck,
   **Price you negotiated** → save: no approval needed. The record is now complete and the page shows **"This record is locked"**: try changing the truck number: refused.
10. Sign in as `admin` → the same banner has **Reopen**: it asks for a reason, which then shows on the truck's **Activity** tab.

## 4. Sun drying  (point 3)
11. On a truck that does not need drying, **Does this Lot need sun drying? → No**: recorded, nothing else changes (its status stays).
12. On this truck choose **Yes**: the sun-drying form opens for **round 1** (date fills itself; net kg and bags are offered from the truck). Enter the
    **quality before drying** on the drying sample: moisture, nut count and the cut-test grams (**KOR is calculated**). The QFS reception sample is shown
    above for reference only; it is never copied or changed. **Start sun drying**: the truck's status becomes **In drying**.
13. **Record what came back**: the dried kg and bags: the **weight loss is calculated**, and the round waits for its quality check.
14. **Quality check after drying**: moisture, nut count, cut test. Choose **Dry it again**: round 1 closes as *Sent for re-drying* and **round 2** starts
    with what came back. Repeat, and choose **Passed**: the drying is finished. Each round shows its weights and quality before and after.

## 5. Dispatch with quality and the warehouse receipt number; Yamoussoukro receives  (points 5, 6)
15. **Transfers** → create a BKT with this Lot → open it → **Dispatch truck**: the Lot's moisture, KOR and nut count are **prefilled from its
    quality check** (change one only if re-measured). Enter the **warehouse receipt number** and the truck. Dispatch.
16. Sign in as `incharge.yakro` → **Transfers** → the BKT → record arrival. Enter **their warehouse receipt number**, bags and weights, and the
    **arrival quality**. If the bags or weight differ, a **"Why it differs"** box becomes required; the BKT closes or shows **Discrepancy**.

## 6. Other warehouse activities  (point 7)
17. As `incharge.bouake`: **Jute Bag Management → Warehouse activity ledger**. The **Category** column classifies **every** row, including the
    787 imported ones ("Staking" → Stacking, "Destaking" → Destacking, "Dying" → Drying, "RAMASSAGE" → Triage / cleaning). Use the funnel on **Category**.
18. **Record an activity**: choose **Triage / cleaning**, the Lot, a place, and note that **moisture and the kg before and after** are required.
    Save: it appears in the list under its category.

## 7. The written answer on KOR and locking
19. `docs/QUALITY_KOR_AND_LOCKING.md` gives the exact form name, the KOR formula, the workflow and the lock rule. It is generated from the
    application's own definitions, so it cannot disagree with what was just shown.

## What the team should check against real operations
- Is the record complete at **GRN quantity + price**, or at another point? (the lock point is one constant)
- Does the Reception / Offloading status filter split at the right step? (one list in `packages/contract/src/data/modules.ts`)
- Drying fields, the dispatch quality fields, the Yamoussoukro arrival steps and the list of activity kinds are the first versions: the team's
  corrections are small edits to those lists.
