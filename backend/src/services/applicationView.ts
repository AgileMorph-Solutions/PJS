/**
 * Applies the client's APPLICATION VIEW workbook (Oct 2026, extracted by tools/extract-application-view.py)
 * on top of the receipts the app already holds: its Delivery Plans, which plan each truck arrived
 * against, which trucks it marks rejected, the GRN quantity and Bin it records, and the exception
 * approvals it carries.
 *
 * The rules this follows are the repo's, not the workbook's:
 *   - Nothing is overwritten. A value the app already has is kept, and a workbook value that disagrees is
 *     REPORTED as a conflict. Re-running changes nothing (everything is "fill what is blank").
 *   - Nothing is invented. A plan with no store keeps none; a funding reference that says "not available"
 *     is no reference; an approval has no approver because the workbook names none.
 *   - The workbook's typed statuses are not applied. Plan status, Reception Type and the exception flags are
 *     derived from the data (contract domain/deliveryPlan.ts), and the parity test holds the two to account.
 *   - A truck is never linked to another site's plan. 10 trucks the workbook files under a Bouaké plan were
 *     received at Yakro Factory; they are left as they are and listed here, for the client to decide.
 */
import { Prisma } from "@prisma/client";
import { parseSiteId } from "@anagroci/contract/domain/ids";
import { parseQty } from "@anagroci/contract/domain/receiptMath";
import { deriveStatus } from "@anagroci/contract/domain/receiptStatus";
import type { ReceiptRecord } from "@anagroci/contract/types/receipt";
import { prisma } from "../db.js";
import { toReceiptRecord } from "../serialize.js";
import { siteOf } from "./ids.js";
import { applyBranch, applyStageFields, loadReceiptRow } from "./receipts.js";

const GRN_QUANTITY = "GRN Weight (kept separate from Gross/Net/Paid)";

export interface ViewPlan {
  id: string; planningDate: string; supplierCode: string; supplierName: string; expectedOrigin: string | null; destinationStore: string | null;
  expectedStart: string; expectedEnd: string | null; expectedQuantityKg: number | null; expectedTrucks: number | null;
  fundingReference: string | null; planStatusRaw: string; planningScenario: string; planningBasis: string | null;
}
export interface ViewReceipt {
  key: { vehicleNo: string; fiche: string; arrivalDate: string; grossKg: number | null; moisture: number | null; nutCount: number | null; kor: number | null };
  clientReceiptId: string; clientLot: string | null; clientStore: string | null; receptionSite: string;
  planId: string | null; rejected: boolean; rejectionReason: string | null; grnQuantityKg: number | null; bin: string | null; exceptionApproved: boolean;
}
export interface ApplicationViewSeed { source: string; plans: ViewPlan[]; receipts: ViewReceipt[]; bins: string[] }

export interface ApplyReport {
  binsAdded: number;
  plansAdded: number;
  plansAlreadyThere: number;
  matched: number;
  /** Trucks of the workbook the app has no receipt for, or more than one it can't tell apart. */
  unmatched: string[];
  ambiguous: string[];
  planLinked: number;
  /** Plan links not made, each with why. */
  planLinkSkipped: { clientReceiptId: string; receiptId: string; reason: string }[];
  rejectedMarked: number;
  grnFilled: number;
  binsFilled: number;
  approvalsRecorded: number;
  /** The workbook says one thing, the app already holds another: kept as it was. */
  conflicts: string[];
  /** The workbook's Lot number for a truck differs from the one the app holds (never applied). */
  lotNumbersDiffer: number;
}

/** The report as lines to print — what was done, and everything that was left alone and why. */
export function describeReport(r: ApplyReport, data: ApplicationViewSeed): string[] {
  return [
    `APPLICATION VIEW: ${r.plansAdded} plans added (${r.plansAlreadyThere} already there), ${r.binsAdded} bins added, ${r.matched}/${data.receipts.length} trucks matched.`,
    `  linked to a plan ${r.planLinked} · marked rejected ${r.rejectedMarked} · GRN quantity ${r.grnFilled} · Bin ${r.binsFilled} · approvals ${r.approvalsRecorded}`,
    ...r.planLinkSkipped.map((s) => `  not linked: ${s.receiptId} (${s.clientReceiptId}) — ${s.reason}`),
    ...(r.unmatched.length ? [`  no receipt in the app for: ${r.unmatched.join(", ")}`] : []),
    ...(r.ambiguous.length ? [`  could not tell apart: ${r.ambiguous.join(", ")}`] : []),
    ...r.conflicts.map((c) => `  kept as it was: ${c}`),
    ...(r.lotNumbersDiffer ? [`  ${r.lotNumbersDiffer} Lot numbers differ from the workbook's (the app keeps its own).`] : []),
  ];
}

const text = (v: string | null | undefined) => (v ?? "").trim();
const truckKey = (vehicleNo: string, fiche: string, date: string) => `${vehicleNo.trim().toUpperCase()}|${fiche.trim()}|${date}`;

type Tx = Prisma.TransactionClient;

/** `db` lets a caller run it inside its own transaction (the tests apply the whole workbook, look, and roll back). */
export async function applyApplicationView(data: ApplicationViewSeed, opts: { now?: Date; db?: Tx } = {}): Promise<ApplyReport> {
  const now = opts.now ?? new Date();
  const report: ApplyReport = {
    binsAdded: 0, plansAdded: 0, plansAlreadyThere: 0, matched: 0, unmatched: [], ambiguous: [], planLinked: 0, planLinkSkipped: [],
    rejectedMarked: 0, grnFilled: 0, binsFilled: 0, approvalsRecorded: 0, conflicts: [], lotNumbersDiffer: 0,
  };

  const run = async (tx: Tx) => {
    // ── Bins: the physical places the workbook names ────────────────────────────────────────
    const addedBins = await tx.bin.createMany({ data: data.bins.map((code) => ({ code, source: data.source })), skipDuplicates: true });
    report.binsAdded = addedBins.count;

    // ── Plans ──────────────────────────────────────────────────────────────────────────────
    const linkedPerPlan = new Map<string, number>();
    for (const r of data.receipts) if (r.planId) linkedPerPlan.set(r.planId, (linkedPerPlan.get(r.planId) ?? 0) + 1);
    const planSite = new Map<string, string>();
    for (const p of data.plans) {
      const code = parseSiteId(p.id)?.code;
      const site = code ? await tx.warehouse.findFirst({ where: { code, site: null }, select: { name: true } }) : null;
      if (!site) { report.conflicts.push(`${p.id}: no warehouse has the code in its ID (${code ?? "unreadable"}) — plan not added`); continue; }
      planSite.set(p.id, site.name);
      if (await tx.deliveryPlan.findUnique({ where: { id: p.id }, select: { id: true } })) { report.plansAlreadyThere++; continue; }

      // A store is real when receipts at this site record it on the gate (its "WH NO."). On a fresh database the
      // Warehouse master doesn't hold it yet — stores arrive with workbook uploads — so it is registered from that
      // evidence; a store nothing at the site ever used is left out, never invented.
      let store = p.destinationStore
        ? await tx.warehouse.findFirst({ where: { name: p.destinationStore, site: site.name }, select: { name: true } })
        : null;
      if (!store && p.destinationStore && (await tx.stageGateEntry.findFirst({ where: { whNo: p.destinationStore, receipt: { warehouse: site.name } }, select: { receiptId: true } }))) {
        store = await tx.warehouse.upsert({
          where: { name: p.destinationStore }, update: {}, create: { name: p.destinationStore, site: site.name, source: `${data.source} (store recorded as WH NO. on this site's receipts)` },
          select: { name: true },
        });
      }
      const cancelled = p.planStatusRaw.toUpperCase() === "CANCELLED";
      await tx.deliveryPlan.create({
        data: {
          id: p.id, plannedDeliveryDate: p.planningDate || null, supplierName: p.supplierName, supplierCode: p.supplierCode || null,
          expectedQuantityKg: p.expectedQuantityKg === null ? null : new Prisma.Decimal(p.expectedQuantityKg), expectedTrucks: p.expectedTrucks,
          expectedOrigin: p.expectedOrigin, expectedArrivalDate: p.expectedStart, expectedDeliveryEnd: p.expectedEnd,
          destinationWarehouse: site.name, destinationStore: store?.name ?? null, fundingReference: p.fundingReference, planningBasis: p.planningBasis,
          // Cancelling is a person's decision and the workbook records one; the moment and the person are not in it.
          ...(cancelled ? { cancelledAt: now, cancelReason: `Marked CANCELLED in ${data.source} (${linkedPerPlan.get(p.id) ?? 0} truck(s) were recorded against it regardless).` } : {}),
        },
      });
      report.plansAdded++;
      if (p.destinationStore && !store) report.conflicts.push(`${p.id}: store ${p.destinationStore} isn't a store of ${site.name} — left blank`);
    }

    // ── Trucks: match to the receipts the app holds, by what a person would look up ──────────
    const rows = await tx.receipt.findMany({
      where: { source: "imported" },
      select: {
        id: true, vehicleNo: true, arrivalDate: true, warehouse: true, deliveryPlanId: true, exceptionApprovedAt: true,
        verify: { select: { fiche: true } }, gross: { select: { grossWtKgs: true } }, grn: { select: { grnWeight: true } },
        qfs: { select: { moisture: true, nutCount: true, kor: true } },
        bin: { select: { binNumber: true } }, lot: { select: { lotNumber: true } }, branches: { where: { stageId: "n-qfs" }, select: { branchId: true } },
      },
    });
    const byKey = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = truckKey(r.vehicleNo, text(r.verify?.fiche), r.arrivalDate);
      byKey.set(k, [...(byKey.get(k) ?? []), r]);
    }

    for (const v of data.receipts) {
      let candidates = byKey.get(truckKey(v.key.vehicleNo, v.key.fiche, v.key.arrivalDate)) ?? [];
      // Same truck, same fiche, same day does happen (two loads): the weighbridge reading tells them apart.
      if (candidates.length > 1 && v.key.grossKg !== null) candidates = candidates.filter((c) => parseQty(c.gross?.grossWtKgs) === v.key.grossKg);
      // Still two (rejected loads weigh nothing): the quality readings taken on each are what tell them apart.
      if (candidates.length > 1) {
        const reading = (c: (typeof candidates)[number]) => [parseQty(c.qfs?.moisture), parseQty(c.qfs?.nutCount), parseQty(c.qfs?.kor)];
        candidates = candidates.filter((c) => reading(c).every((x, i) => x === [v.key.moisture, v.key.nutCount, v.key.kor][i]));
      }
      if (candidates.length === 0) { report.unmatched.push(v.clientReceiptId); continue; }
      if (candidates.length > 1) { report.ambiguous.push(v.clientReceiptId); continue; }
      const r = candidates[0]!;
      report.matched++;
      const notes: string[] = [];
      const conflict = (what: string) => report.conflicts.push(`${r.id} (${v.clientReceiptId}): ${what}`);

      // Plan link — the same site only; "planned from the start", so no late-link stamp.
      if (v.planId) {
        const planDest = planSite.get(v.planId) ?? (await tx.deliveryPlan.findUnique({ where: { id: v.planId }, select: { destinationWarehouse: true } }))?.destinationWarehouse;
        const site = (await siteOf(tx, r.warehouse)) ?? r.warehouse;
        if (!planDest) report.planLinkSkipped.push({ clientReceiptId: v.clientReceiptId, receiptId: r.id, reason: `plan ${v.planId} isn't in the app` });
        else if (planDest !== site) report.planLinkSkipped.push({ clientReceiptId: v.clientReceiptId, receiptId: r.id, reason: `received at ${site}, but ${v.planId} is a plan for ${planDest}` });
        else if (!r.deliveryPlanId) {
          await tx.receipt.update({ where: { id: r.id }, data: { deliveryPlanId: v.planId } });
          report.planLinked++;
          notes.push(`linked to ${v.planId}`);
        } else if (r.deliveryPlanId !== v.planId) conflict(`workbook plan ${v.planId}, app has ${r.deliveryPlanId}`);
      }

      // Quality outcome. The workbook's reason is its own single word REJECT — kept verbatim, and reported as
      // a placeholder by the audit rather than dressed up as a reason.
      const failed = r.branches.some((b) => b.branchId === "fail");
      if (v.rejected && !failed) {
        await applyBranch(tx, r.id, "n-qfs", "fail", v.rejectionReason ?? undefined, { bypassValidation: true });
        report.rejectedMarked++;
        notes.push("marked rejected");
      } else if (!v.rejected && failed) conflict("workbook accepts this truck, the app has it rejected");

      if (v.grnQuantityKg !== null) {
        const current = text(r.grn?.grnWeight);
        if (!current) {
          await applyStageFields(tx, r.id, "n-grn", { [GRN_QUANTITY]: String(v.grnQuantityKg) }, { bypassValidation: true });
          report.grnFilled++;
          notes.push(`GRN quantity ${v.grnQuantityKg}`);
        } else if (parseQty(current) !== v.grnQuantityKg) conflict(`workbook GRN quantity ${v.grnQuantityKg}, app has ${current}`);
      }

      if (v.bin && !v.rejected) {
        const current = text(r.bin?.binNumber);
        if (!current) {
          await applyStageFields(tx, r.id, "n-bin", { "Bin Number": v.bin }, { bypassValidation: true });
          report.binsFilled++;
          notes.push(`Bin ${v.bin}`);
        } else if (current !== v.bin) conflict(`workbook Bin ${v.bin}, app has ${current}`);
      }

      if (v.exceptionApproved && !r.exceptionApprovedAt) {
        await tx.receipt.update({ where: { id: r.id }, data: { exceptionApprovedAt: now, exceptionNote: `Marked APPROVED in ${data.source} (approver and date are not in the workbook).` } });
        report.approvalsRecorded++;
      }

      if (v.clientLot && text(r.lot?.lotNumber) && text(r.lot?.lotNumber) !== v.clientLot) report.lotNumbersDiffer++;

      if (notes.length) {
        const fresh = await loadReceiptRow(r.id, tx);
        await tx.timelineEntry.create({
          data: { receiptId: r.id, status: deriveStatus(toReceiptRecord(fresh!) as ReceiptRecord), at: now.toISOString(), note: `Applied from ${data.source}: ${notes.join(", ")}` },
        });
      }
    }
  };
  if (opts.db) await run(opts.db);
  else await prisma.$transaction(run, { timeout: 5 * 60 * 1000, maxWait: 30_000 });

  return report;
}
