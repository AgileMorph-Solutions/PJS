/**
 * Production's approval queue for one role (contract domain/productionApprovals.ts): what is waiting for this person's
 * decision at the factory. Nothing is stored for it — each item is read off the record it is about (a load's status, a
 * check's "submitted"), so the queue can't disagree with the screens. The decisions themselves are the existing routes
 * (accept a load, approve or reject a check); this only lists them in one place.
 */
import { productionApprovalKinds, type ProductionApproval } from "@anagroci/contract/domain/productionApprovals";
import { ENTRY_DEFS, type EntryKind } from "@anagroci/contract/domain/lotEntries";
import { SIZING_DECISION_LABELS, samplingPointLabel } from "@anagroci/contract/domain/calibration";
import { MOISTURE_DECISION_LABELS } from "@anagroci/contract/domain/rcnReceipt";
import { weighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import type { Role } from "@anagroci/contract/data/roles";
import { prisma } from "../../db.js";
import { listSizingChecks } from "./calibration.js";
import { listRcnReceipts } from "./rcnReceipts.js";

const kg = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} kg`;

/** Oldest first: what has waited longest is decided first. */
export async function listProductionApprovals(site: string, role: Role): Promise<ProductionApproval[]> {
  const kinds = new Set(productionApprovalKinds(role));
  if (kinds.size === 0) return [];

  const runs = new Map((await prisma.productionBatch.findMany({ where: { warehouse: site }, select: { code: true, name: true } })).map((r) => [r.code, r.name]));
  const run = (code: string) => ({ runCode: code, runName: runs.get(code) ?? null });
  const items: ProductionApproval[] = [];

  if (kinds.has("load_acceptance") || kinds.has("moisture_check")) {
    for (const r of await listRcnReceipts(site)) {
      const load = `${r.id} · BTM ${r.btmNo} from ${r.binCode}`;
      if (kinds.has("load_acceptance") && r.status === "waiting_for_acceptance") {
        const t = weighingTotals(r.pallets, r.finalWeight ?? { emptyPallets: [] });
        const moisture = r.moistureChecks.filter((c) => c.status === "approved").at(-1);
        items.push({
          kind: "load_acceptance", id: r.id, ...run(r.batchCode), loadId: r.id, binCode: r.binCode, lotCode: null,
          title: `Load ${load}`,
          detail: `Net ${kg(t.netKg)} out of ${r.binCode} · ${kg(t.toSilosKg)} into the silos${moisture ? ` · moisture ${moisture.moisture} %` : ""}`,
          submittedBy: r.finalWeight?.finalisedBy ?? null, at: r.finalWeight?.finalisedAt ?? r.createdAt,
        });
      }
      if (kinds.has("moisture_check")) {
        for (const c of r.moistureChecks.filter((x) => x.status === "submitted")) {
          items.push({
            kind: "moisture_check", id: c.id, ...run(r.batchCode), loadId: r.id, binCode: r.binCode, lotCode: null,
            title: `Moisture check on ${load}`,
            detail: `Moisture ${c.moisture} % · nut count ${c.nutCount} · ${MOISTURE_DECISION_LABELS[c.decision]}`,
            submittedBy: c.submittedBy, at: c.submittedAt,
          });
        }
      }
    }
  }

  if (kinds.has("sizing_check")) {
    for (const c of (await listSizingChecks(site)).filter((x) => x.status === "submitted")) {
      items.push({
        kind: "sizing_check", id: c.id, ...run(c.batchCode), loadId: null, binCode: c.binCode || null, lotCode: null,
        title: `Silo check (QC-2) · ${samplingPointLabel(c.point)}`,
        detail: `${c.correctPct === null ? "" : `${c.correctPct.toFixed(1)} % the right size · `}${SIZING_DECISION_LABELS[c.decision]}`,
        submittedBy: c.submittedBy, at: c.submittedAt,
      });
    }
  }

  if (kinds.has("lot_entry")) {
    const entries = await prisma.lotEntry.findMany({
      where: { status: "submitted", lot: { batch: { warehouse: site } } },
      include: { submittedBy: { select: { displayName: true } }, lot: { select: { batchCode: true } } },
    });
    for (const e of entries) {
      const def = ENTRY_DEFS[e.kind as EntryKind];
      items.push({
        kind: "lot_entry", id: e.id, ...run(e.lot.batchCode), loadId: null, binCode: null, lotCode: e.lotCode,
        title: `${def?.check ? `${def.check} · ` : ""}${def?.title ?? e.kind} on Lot ${e.lotCode}`,
        detail: `Taken ${e.date}${e.decision ? ` · result ${e.decision.toUpperCase()}` : ""}`,
        submittedBy: e.submittedBy.displayName, at: e.submittedAt.toISOString(),
      });
    }
  }

  return items.sort((a, b) => a.at.localeCompare(b.at));
}
