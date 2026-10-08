/**
 * The client's APPLICATION VIEW workbook against what the app derives — the test that would catch the
 * app and the client's own formulas drifting apart (the same job statusParity and roundTrip do for the
 * storage change). It applies the workbook's seed inside a transaction that is rolled back, then holds
 * what the app DERIVES against what the workbook SHOWS (tests/fixtures/application-view-expected.json,
 * written by tools/extract-application-view.py from the file's own cached formula results):
 *
 *   - Delivery Plans: received kg, arrivals, accepted trucks — their SUMIFS / COUNTIFS over the trucks —
 *     against ours derived from the same trucks (the 10 the app refuses to link across sites counted back in);
 *   - each truck's outcome (STOCKED / REJECTED) against its derived status, and Net = Gross − bags;
 *   - every one of their 25 BKTs: bag variance, weight variance, net weights and Transfer Status, computed
 *     from the same columns by the contract's transfer logic.
 *
 * Their typed columns (Plan Status, Reception Type) are NOT asserted equal: the workbook types them by
 * hand and they contradict its own rows. Where ours differs, the test says exactly why.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { transferState, transferVariance } from "@anagroci/contract/domain/transfers";
import { deriveStatus } from "@anagroci/contract/domain/receiptStatus";
import { applyApplicationView, type ApplicationViewSeed } from "../src/services/applicationView.js";
import { getDeliveryPlan } from "../src/services/deliveryPlans.js";
import { getReceiptPlanInfo } from "../src/services/receiptPlanInfo.js";
import { assembleBranches, assembleStageData, RECEIPT_INCLUDE } from "../src/stageStore.js";

const prisma = new PrismaClient();
class Rollback extends Error {}
const here = path.dirname(fileURLToPath(import.meta.url));
const read = <T>(rel: string) => JSON.parse(readFileSync(path.resolve(here, rel), "utf8")) as T;
const SEED = read<ApplicationViewSeed>("../../frontend/src/data/seed/applicationView.json");

interface Expected {
  plans: { id: string; expectedQuantityKg: number; actualKg: number; arrivals: number; acceptedTrucks: number; remainingKg: number; varianceKg: number }[];
  trucks: { clientReceiptId: string; receiptStatus: string; receptionType: string; planId: string | null; grnKg: number | null; grossKg: number | null; bags: number | null; netKg: number | null }[];
  transfers: { id: string; bagsDispatched: number; bagsReceived: number | null; loadedKg: number | null; receivedGrossKg: number | null; netDispatchedKg: number; netAtArrivalKg: number | null; bagVariance: number | null; weightVarianceKg: number | null; status: string }[];
}
const EXPECTED = read<Expected>("./fixtures/application-view-expected.json");

afterAll(() => prisma.$disconnect());

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
/** Applies the workbook for real, lets `fn` look at the result, then rolls everything back. */
async function applied(fn: (tx: Tx, report: Awaited<ReturnType<typeof applyApplicationView>>) => Promise<void>) {
  // An assertion failing inside `fn` must reach the test with its own message, not be swallowed by the rollback.
  let failure: unknown;
  await prisma
    .$transaction(async (tx) => {
      const report = await applyApplicationView(SEED, { db: tx });
      try { await fn(tx, report); } catch (e) { failure = e; }
      throw new Rollback();
    }, { timeout: 120_000, maxWait: 30_000 })
    .catch((e) => { if (!(e instanceof Rollback)) throw e; });
  if (failure) throw failure;
}

async function receiptOf(tx: Tx, v: ApplicationViewSeed["receipts"][number]) {
  // RECEIPT_INCLUDE is built from the stage map at run time, so its relations aren't in the static type.
  const all = (await tx.receipt.findMany({ where: { vehicleNo: v.key.vehicleNo, arrivalDate: v.key.arrivalDate, source: "imported" }, include: RECEIPT_INCLUDE })) as any[];
  const found = all.filter((r) => (r.verify?.fiche ?? "") === v.key.fiche);
  return found.length === 1 ? found[0] : found.find((r) => (r.qfs?.kor ?? "") === String(v.key.kor ?? "")) ?? found[0];
}

describe("the workbook is applied without inventing or overwriting anything", () => {
  it("adds its 10 plans and every truck it names, links the same-site trucks, and says which it could not", async () => {
    await applied(async (tx, r) => {
      expect(r).toMatchObject({ plansAdded: 10, matched: 76, unmatched: [], ambiguous: [], rejectedMarked: 18, grnFilled: 58 });
      expect(r.conflicts).toEqual([]);
      // 10 of the 35 plan-linked trucks were received at Yakro Factory — never linked to a Bouaké plan.
      expect(r.planLinkSkipped).toHaveLength(10);
      expect(r.planLinkSkipped.every((s) => /received at YAKRO FACTORY, but DP-BKE-2026-\d+ is a plan for BOUAKE/.test(s.reason))).toBe(true);
      expect(r.planLinked).toBe(25);
    });
  });

  it("is a no-op the second time", async () => {
    await applied(async (tx) => {
      const again = await applyApplicationView(SEED, { db: tx });
      expect(again).toMatchObject({ plansAdded: 0, plansAlreadyThere: 10, planLinked: 0, rejectedMarked: 0, grnFilled: 0, binsFilled: 0, approvalsRecorded: 0, binsAdded: 0 });
      expect(again.conflicts).toEqual([]);
    });
  });

  it("does not take the workbook's funding placeholder as a reference, nor invent a store for plan 004", async () => {
    await applied(async (tx) => {
      const plans = await tx.deliveryPlan.findMany({ where: { id: { in: SEED.plans.map((p) => p.id) } } });
      expect(plans.every((p) => p.fundingReference === null)).toBe(true);
      expect(plans.find((p) => p.id === "DP-BKE-2026-004")!.destinationStore).toBeNull();
      expect(plans.find((p) => p.id === "DP-BKE-2026-003")!.destinationStore).toBe("BKE-003");
      // Cancelling is the workbook's recorded decision (its Plan Status says CANCELLED); the app keeps the reason.
      const cancelled = plans.find((p) => p.id === "DP-BKE-2026-007")!;
      expect(cancelled.cancelledAt).not.toBeNull();
      expect(cancelled.cancelReason).toMatch(/\d+ truck\(s\) were recorded against it regardless/);
    });
  });

  it("marks only the 18 trucks the workbook rejects — not the other 257 whose remarks also say REJECT", async () => {
    await applied(async (tx) => {
      const rejected = await tx.receiptBranch.count({ where: { stageId: "n-qfs", branchId: "fail" } });
      expect(rejected).toBe(18);
      // The reason is the workbook's own single word, kept verbatim (and reported by the audit as no real reason).
      expect((await tx.stageRejection.findMany({ select: { reason: true } })).every((r) => r.reason === "REJECT")).toBe(true);
    });
  });
});

describe("Delivery Plans: the app's derived totals against the client's SUMIFS / COUNTIFS", () => {
  it("every plan's received kg, arrivals and accepted trucks match once the trucks received at the other site are counted back in", async () => {
    await applied(async (tx, report) => {
      const skipped = new Set(report.planLinkSkipped.map((s) => s.clientReceiptId));
      for (const plan of EXPECTED.plans) {
        const mine = (await getDeliveryPlan(plan.id, tx))!;
        const left = EXPECTED.trucks.filter((t) => t.planId === plan.id && skipped.has(t.clientReceiptId));
        const kgLeft = left.reduce((n, t) => n + (t.grnKg ?? 0), 0);
        const acceptedLeft = left.filter((t) => t.receiptStatus === "STOCKED").length;

        expect(mine.progress.arrivals + left.length, `${plan.id} arrivals`).toBe(plan.arrivals);
        expect(mine.progress.actualKg + kgLeft, `${plan.id} received kg`).toBe(plan.actualKg);
        expect(mine.progress.acceptedTrucks + acceptedLeft, `${plan.id} accepted trucks`).toBe(plan.acceptedTrucks);
        expect(mine.expectedQuantityKg, `${plan.id} expected kg`).toBe(plan.expectedQuantityKg);
        if (!left.length) {
          expect(mine.progress.remainingKg, `${plan.id} remaining`).toBe(plan.remainingKg);
          expect(mine.progress.varianceKg, `${plan.id} variance`).toBe(plan.varianceKg);
        }
      }
    });
  });

  it("reads the plans the workbook gets wrong by its own rows correctly: the cancelled one that kept receiving, the over-delivered one", async () => {
    await applied(async (tx) => {
      // 007 is CANCELLED and trucks arrived anyway: each is flagged, and the plan doesn't quietly read delivered.
      const p7 = (await getDeliveryPlan("DP-BKE-2026-007", tx))!;
      expect(p7.status).toBe("cancelled");
      expect(p7.progress.arrivals).toBeGreaterThan(0);
      for (const id of p7.receiptIds) expect((await getReceiptPlanInfo(id, tx))!.flags).toContain("plan_cancelled");
      // 006 received more than it planned — their numbers: 92,606 kg against 78,715.
      const p6 = (await getDeliveryPlan("DP-BKE-2026-006", tx))!;
      expect(p6.progress.actualKg).toBe(92_606);
      expect(p6.progress.varianceKg).toBe(92_606 - 78_715);
      expect(p6.progress.remainingKg).toBe(78_715 - 92_606);
    });
  });
});

describe("every truck: the outcome and the weights", () => {
  it("a rejected truck derives as rejected, an accepted one as GRN-completed or beyond, and Net = Gross − bags on all 58", async () => {
    await applied(async (tx) => {
      const byClientId = new Map(EXPECTED.trucks.map((t) => [t.clientReceiptId, t]));
      let accepted = 0, rejected = 0;
      for (const v of SEED.receipts) {
        const t = byClientId.get(v.clientReceiptId)!;
        const row = await receiptOf(tx, v);
        const stageData = assembleStageData(row);
        const status = deriveStatus({ stageData, branches: assembleBranches(row), source: "imported" });
        if (t.receiptStatus === "REJECTED") {
          expect(status, v.clientReceiptId).toBe("rejected");
          rejected++;
          continue;
        }
        expect(["grn_completed", "in_stock", "in_drying", "transferred_out"], v.clientReceiptId).toContain(status);
        // Their GRN quantity is on the receipt, and their Net follows Gross − bags exactly as the app calculates it.
        expect(stageData["n-grn"]?.["GRN Weight (kept separate from Gross/Net/Paid)"], v.clientReceiptId).toBe(String(t.grnKg));
        expect(t.grossKg! - t.bags!, `${v.clientReceiptId} net`).toBe(t.netKg);
        expect(stageData["n-netwt"]?.["NET WT KGS"], `${v.clientReceiptId} net on the receipt`).toBe(String(t.netKg));
        accepted++;
      }
      expect({ accepted, rejected }).toEqual({ accepted: 58, rejected: 18 });
    });
  });

  it("the trucks the client calls UNPLANNED are unplanned here; the only ones that differ are the 10 received at the other site", async () => {
    await applied(async (tx, report) => {
      const skipped = new Set(report.planLinkSkipped.map((s) => s.clientReceiptId));
      const byClientId = new Map(EXPECTED.trucks.map((t) => [t.clientReceiptId, t]));
      for (const v of SEED.receipts) {
        const row = await receiptOf(tx, v);
        const info = (await getReceiptPlanInfo(row.id, tx))!;
        if (byClientId.get(v.clientReceiptId)!.receptionType === "UNPLANNED") expect(info.type, v.clientReceiptId).toBe("unplanned");
        else if (skipped.has(v.clientReceiptId)) expect(info.type, v.clientReceiptId).toBe("unplanned"); // their plan is another site's
        else expect(info.deliveryPlanId, v.clientReceiptId).toBe(v.planId);
      }
    });
  });
});

describe("their 25 BKTs: variance and status from the same columns, by the contract's own logic", () => {
  const stateOf: Record<string, string> = { "IN TRANSIT": "in_transit", DISCREPANCY: "discrepancy", CLOSED: "closed" };

  it("reproduces every Bag Variance, Weight Variance, net weight and Transfer Status in their Stock Transfers sheet", () => {
    expect(EXPECTED.transfers).toHaveLength(25);
    for (const t of EXPECTED.transfers) {
      const received = t.bagsReceived !== null;
      const facts = {
        status: received ? ("received" as const) : ("dispatched" as const),
        lines: [{ bags: t.bagsDispatched, netWeightKg: null }],
        dispatchedGrossKg: t.loadedKg,
        bagsReceived: t.bagsReceived,
        receivedGrossKg: t.receivedGrossKg,
      };
      const v = transferVariance(facts);
      expect(transferState(facts), t.id).toBe(stateOf[t.status]);
      expect(v.bagVariance, `${t.id} bags`).toBe(t.bagVariance);
      expect(v.weightVarianceKg, `${t.id} weight`).toBe(t.weightVarianceKg);
      expect(v.netDispatchedKg, `${t.id} net sent`).toBe(t.netDispatchedKg);
      expect(v.netAtArrivalKg, `${t.id} net arrived`).toBe(t.netAtArrivalKg);
    }
  });

  it("counts them as the client does: 19 received (all with a difference) and 6 still on the road", () => {
    const by = (s: string) => EXPECTED.transfers.filter((t) => t.status === s).length;
    expect({ discrepancy: by("DISCREPANCY"), inTransit: by("IN TRANSIT"), closed: by("CLOSED") }).toEqual({ discrepancy: 19, inTransit: 6, closed: 0 });
  });
});
