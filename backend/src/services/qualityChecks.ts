/**
 * The QFS Officer's list (26 Nov 2026, user): every quality check at their warehouse, named by the section it belongs to and
 * the record it is about, with what is still to be measured. Nothing is stored for it — each line is read off the record it is
 * about (a truck's empty readings, a drying round waiting for its check, a load waiting for moisture…), so the list can't
 * disagree with the pages the checks are taken on. Sections and their rules are the contract's (domain/qualityChecks.ts).
 */
import { missingFields, phaseFor, PHASES, stageGate } from "@anagroci/contract/domain/phaseGate";
import {
  QUALITY_SUBMISSION_INFO, formSubmissionSection, sectionsAt, sortQualityItems,
  type QualityCheckItem, type QualityChecksView, type QualitySection, type QualitySubmissionKind,
} from "@anagroci/contract/domain/qualityChecks";
import { canSendDryingToProduction, dryingPhase } from "@anagroci/contract/domain/sunDrying";
import { classifyActivity } from "@anagroci/contract/data/warehouseActivities";
import { formById } from "@anagroci/contract/data/roles";
import { ENTRY_DEFS } from "@anagroci/contract/domain/lotEntries";
import { samplingPointLabel, siloChecks, SILO_SIZE_KEYS, siloLabel } from "@anagroci/contract/domain/calibration";
import { isWarehouseType, type WarehouseType } from "@anagroci/contract/data/warehouseTypes";
import type { ReceiptRecord } from "@anagroci/contract/types/receipt";
import { prisma } from "../db.js";
import { resolveSite } from "../domain/site.js";
import { listReceipts } from "./receipts.js";
import { dryingRoundName } from "./dryingBatches.js";
import { listTransferLots } from "./transferLots.js";
import { listQualitySubmissions } from "./qualitySubmissions.js";
import { listSubmissions } from "./submissions.js";
import { siteTypeOf } from "./ids.js";
import { listRcnReceipts } from "./production/rcnReceipts.js";
import { listLots } from "./production/factoryLots.js";
import { listSizingChecks } from "./production/calibration.js";

const QFS_FORM = formById("qfs-jute-check")!;
/** The bag counts the QFS Officer's form takes at unloading (contract ROLE_FORMS). */
const UNLOADING_LABELS = QFS_FORM.stages.find((s) => s.stageId === "n-unload")!.labels.filter((l) => l !== "Reconditioning of torn bags");
/** Rejected checks stay on the list this long, so the QFS Officer sees why. */
const REJECTED_DAYS = 14;

const fmt = (n: unknown, unit = "") => (n === null || n === undefined || n === "" ? "-" : `${Number(n).toLocaleString("en-US")}${unit}`);

/** A truck as people name it: its ID, its Lot, the truck itself; a lot from the Unit warehouse by what was sent and its BKT. */
function truckReference(r: ReceiptRecord): string {
  const lot = r.stageData["n-lot"]?.["Lot Number"] || r.lotNo;
  if (r.transfer) return [r.id, `${r.transfer.sentAs} on ${r.transfer.transferId}`, lot && `Lot ${lot}`].filter(Boolean).join(" · ");
  return [r.id, lot && `Lot ${lot}`, r.vehicleNo || r.stageData["n-gate"]?.["VEHICLE NO."], r.supplierName].filter(Boolean).join(" · ");
}

/** The reception and unloading checks of the warehouse's trucks: what the QFS Officer's form still has empty. */
function receptionItems(receipts: ReceiptRecord[], waitingFor: Set<string>): QualityCheckItem[] {
  const out: QualityCheckItem[] = [];
  for (const r of receipts) {
    // Imported trucks were never gated and are Data Quality's to report; a rejected or locked one takes no more readings.
    if (r.source !== "entered" || r.branches["n-qfs"] === "fail" || r.lockedAt || waitingFor.has(r.id)) continue;
    const section: QualitySection = r.transfer ? "unit_reception" : "reception";
    const base = { warehouse: r.warehouse, reference: truckReference(r), since: r.createdAt ?? r.arrivalDate ?? null, state: "to_do" as const };
    const decided = r.branches["n-qfs"];
    if (!decided && stageGate(r, "n-qfs").open) {
      const missing = missingFields(r.stageData, phaseFor(PHASES.QUALITY_SAMPLE, r));
      if (missing.length) out.push({ ...base, key: `rec-sample-${r.id}`, section, title: r.transfer ? "Quality received (KOR, moisture, nut count)" : "Truck sample: moisture, nut count, cut test", missing, link: { kind: "receipt", receiptId: r.id, stageId: "n-qfs" } });
    }
    if (decided !== "pass") continue;
    const final = missingFields(r.stageData, phaseFor(PHASES.QUALITY_FINAL, r));
    if (final.length) out.push({ ...base, key: `rec-final-${r.id}`, section, title: "Final quality readings (after unloading)", missing: final, link: { kind: "receipt", receiptId: r.id, stageId: "n-qfs" } });
    if (stageGate(r, "n-unload").open) {
      const bags = UNLOADING_LABELS.filter((l) => !(r.stageData["n-unload"]?.[l] ?? "").trim());
      if (bags.length) out.push({ ...base, key: `unload-${r.id}`, section: "unloading", title: "Bag check: good, damp and torn bags", missing: bags, link: { kind: "receipt", receiptId: r.id, stageId: "n-unload" } });
    }
  }
  return out;
}

/** The warehouse checks that are submitted on this page (drying, transfer lot), still to take. */
async function warehouseFormItems(names: string[], siteType: WarehouseType | null, waiting: Set<string>): Promise<QualityCheckItem[]> {
  const out: QualityCheckItem[] = [];
  const pending = (kind: QualitySubmissionKind, id: string) => waiting.has(`${kind}:${id}`);
  const form = (kind: QualitySubmissionKind, targetId: string) => ({ kind: "form" as const, submissionKind: kind, targetId });

  const rounds = await prisma.dryingBatch.findMany({ where: { warehouseSite: { in: names }, source: "entered" }, orderBy: [{ dryingDate: "asc" }, { sn: "asc" }] });
  for (const b of rounds) {
    const phase = dryingPhase(b.status);
    if (phase !== "in_drying" && phase !== "quality_check") continue;
    const reference = dryingRoundName(b);
    const warehouse = b.warehouseSite ?? "";
    const facts: Record<string, string> = {
      issuedKg: fmt(b.issuedNetWeightKg), issuedBags: fmt(b.issuedBags), returnedKg: fmt(b.receivedNetWeightKg),
      inputMoisture: fmt(b.inputMoisturePct), inputKor: fmt(b.inputKor), inputNutCount: fmt(b.inputNutCount),
      destinationBin: b.destinationBinNo ?? "", fromBin: b.sourceBinNo ?? "",
      production: canSendDryingToProduction(siteType) ? "yes" : "",
    };
    if (b.inputMoisturePct === null && !pending("drying_before", b.id)) {
      out.push({
        key: `drying_before-${b.id}`, section: "drying", title: QUALITY_SUBMISSION_INFO.drying_before.title, reference, warehouse, state: "to_do",
        context: `${fmt(b.issuedNetWeightKg, " kg")} issued on ${b.dryingDateRaw ?? "-"}${b.sourceBinNo ? ` from Bin ${b.sourceBinNo}` : " straight off the truck"}`,
        missing: ["Moisture before drying"], since: b.dryingDate?.toISOString() ?? null, link: form("drying_before", b.id), facts,
      });
    }
    if (phase === "quality_check" && !pending("drying_after", b.id)) {
      out.push({
        key: `drying_after-${b.id}`, section: "drying", title: QUALITY_SUBMISSION_INFO.drying_after.title, reference, warehouse, state: "to_do",
        context: `${fmt(b.receivedNetWeightKg, " kg")} came back of ${fmt(b.issuedNetWeightKg, " kg")} · before: moisture ${fmt(b.inputMoisturePct, "%")}, KOR ${fmt(b.inputKor)}`,
        missing: ["Moisture after drying", "Result"], since: b.returnedAt?.toISOString() ?? null, link: form("drying_after", b.id), facts,
      });
    }
  }

  if (siteType === "UNIT") {
    for (const lot of await listTransferLots(names)) {
      if (lot.moisture !== null || lot.pieces.length || lot.returns.length || pending("transfer_lot", String(lot.id))) continue;
      out.push({
        key: `transfer_lot-${lot.id}`, section: "transfer_lot", title: QUALITY_SUBMISSION_INFO.transfer_lot.title, reference: `Transfer lot ${lot.lotNo}`, warehouse: lot.warehouse, state: "to_do",
        context: `${fmt(lot.bags)} bags from ${lot.bins.map((b) => b.binCode).join(", ")}${lot.netKg !== null ? ` · ${fmt(lot.netKg, " kg")} net` : " · not weighed yet"}`,
        missing: ["Moisture", "KOR", "Nut count"], since: lot.createdAt, link: form("transfer_lot", String(lot.id)),
        facts: { bags: String(lot.bags), netKg: lot.netKg === null ? "" : String(lot.netKg) },
      });
    }
  }

  return out;
}

/** The factory's checks: each load's moisture, the silos to check again, each Lot's QC-4 and the sorter's QC-7. */
async function productionItems(site: string): Promise<QualityCheckItem[]> {
  const out: QualityCheckItem[] = [];
  const runs = new Map((await prisma.productionBatch.findMany({ where: { warehouse: site }, select: { code: true, name: true } })).map((r) => [r.code, r.name]));
  const runName = (code: string) => `run ${runs.get(code) ? `${runs.get(code)} (${code})` : code}`;

  for (const r of await listRcnReceipts(site)) {
    const reference = `Load ${r.id} · BTM ${r.btmNo} from ${r.binCode} · ${runName(r.batchCode)}`;
    const link = { kind: "run" as const, runCode: r.batchCode, stage: "intake", loadId: r.id };
    if (r.status === "waiting_for_moisture" || r.status === "on_hold") {
      out.push({ key: `load-${r.id}`, section: "production_intake", title: r.status === "on_hold" ? "Moisture check again (load on hold)" : "Moisture check of the load", reference, warehouse: site, state: "to_do", missing: ["Moisture", "Nut count", "Decision"], since: r.createdAt, link });
    }
    for (const c of r.moistureChecks.filter((x) => x.status === "submitted")) {
      out.push({ key: `load-check-${c.id}`, section: "production_intake", title: "Moisture check of the load", reference, warehouse: site, state: "waiting_approval", context: `Moisture ${c.moisture} % · nut count ${c.nutCount}`, missing: [], since: c.submittedAt, link });
    }
  }

  const checks = await listSizingChecks(site);
  const standing = siloChecks(checks.map((c) => ({ ...c, moves: c.manualCalibrations.length })));
  for (const size of SILO_SIZE_KEYS.filter((s) => standing[s].state === "re_sized")) {
    const from = checks.find((c) => c.id === standing[size].checkId);
    if (!from) continue;
    out.push({ key: `silo-${size}`, section: "production", title: `QC-2 silo check again: silo ${siloLabel(size)}`, reference: `Silo ${siloLabel(size)} · ${runName(from.batchCode)}`, warehouse: site, state: "to_do", context: "The nuts were moved by hand after a failed check.", missing: ["Silo sample"], since: from.reviewedAt, link: { kind: "run", runCode: from.batchCode, stage: "intake" } });
  }
  for (const c of checks.filter((x) => x.status === "submitted")) {
    out.push({ key: `sizing-${c.id}`, section: "production", title: `QC-2 · ${samplingPointLabel(c.point)}`, reference: runName(c.batchCode), warehouse: site, state: "waiting_approval", missing: [], since: c.submittedAt, link: { kind: "run", runCode: c.batchCode, stage: "intake" } });
  }

  for (const lot of await listLots(site)) {
    const reference = `Lot ${lot.code} · ${runName(lot.batchCode)}`;
    if (lot.coolingSilo && (lot.coolingCheck === "not_checked" || lot.coolingCheck === "wait")) {
      out.push({ key: `qc4-${lot.code}`, section: "production", title: lot.coolingCheck === "wait" ? "QC-4 moisture and temperature, again" : "QC-4 moisture and temperature", reference, warehouse: site, state: "to_do", context: `In cooling silo ${lot.coolingSilo} since ${lot.coolingAt ?? "-"}`, missing: ["Moisture", "Temperature", "Result"], since: lot.coolingAt, link: { kind: "run", runCode: lot.batchCode, stage: "cooking" } });
    }
    for (const [stream, state] of Object.entries(lot.sortChecks)) {
      if (state === "not_checked" || state === "resort") {
        out.push({ key: `qc7-${lot.code}-${stream}`, section: "production", title: `QC-7 sample after the sorter: ${stream}${state === "resort" ? ", again" : ""}`, reference, warehouse: site, state: "to_do", missing: ["Sample after the sorter"], since: null, link: { kind: "run", runCode: lot.batchCode, stage: "colour_sort" } });
      }
    }
    for (const e of lot.entries.filter((x) => x.status === "submitted" && ENTRY_DEFS[x.kind]?.who === "qfs")) {
      const def = ENTRY_DEFS[e.kind];
      out.push({ key: `entry-${e.id}`, section: "production", title: `${def.check ? `${def.check} · ` : ""}${def.title}`, reference, warehouse: site, state: "waiting_approval", missing: [], since: e.submittedAt, link: { kind: "run", runCode: lot.batchCode, stage: e.kind === "qc4" ? "cooking" : e.kind.startsWith("qc7") ? "colour_sort" : "shelling" } });
    }
  }
  return out;
}

/** Rejected lately, waiting, or still to take: everything at this warehouse a QFS Officer is asked for. */
export async function qualityChecks(site: string, userId: string): Promise<QualityChecksView> {
  const names = await resolveSite(site);
  const type = await siteTypeOf(prisma, site);
  const siteType = isWarehouseType(type) ? type : null;
  const since = new Date(Date.now() - REJECTED_DAYS * 86_400_000);

  // Waiting: anyone's at this warehouse (the check is taken, whoever sent it). Rejected: this person's own, lately.
  const recent = <T extends { status: string; reviewedAt: string | null; submittedAt: string }>(rows: T[]) => rows.filter((x) => new Date(x.reviewedAt ?? x.submittedAt) >= since);
  const [receipts, formWaiting, formRejected, qualityWaitingRows, qualityRejected] = await Promise.all([
    listReceipts(names),
    listSubmissions({ site: names, status: "submitted" }),
    listSubmissions({ site: names, status: "rejected", submittedById: userId }),
    listQualitySubmissions({ site: [site, ...names], status: "submitted" }),
    listQualitySubmissions({ site: [site, ...names], status: "rejected", submittedById: userId }),
  ]);
  const qfsForms = [...formWaiting, ...recent(formRejected)].filter((s) => s.formId === QFS_FORM.id);
  const qualitySubs = [...qualityWaitingRows, ...recent(qualityRejected)];
  const byId = new Map(receipts.map((r) => [r.id, r]));

  const items: QualityCheckItem[] = [];
  // The reception form's own: waiting for the Incharge, or one of this person's turned down lately.
  for (const s of qfsForms) {
    const r = byId.get(s.receiptId);
    if (!r) continue;
    const section = formSubmissionSection(Object.keys(s.values), Boolean(r.transfer));
    items.push({
      key: `form-${s.id}`, section, title: "QFS form: quality analysis & jute bag check", reference: truckReference(r), warehouse: r.warehouse,
      state: s.status === "submitted" ? "waiting_approval" : "rejected", note: s.rejectReason ?? undefined,
      missing: [], context: Object.values(s.values).flatMap((f) => Object.entries(f).map(([k, v]) => `${k} ${v}`)).slice(0, 4).join(" · "),
      since: s.submittedAt, link: { kind: "receipt", receiptId: r.id, stageId: Object.keys(s.values)[0] ?? "n-qfs" },
    });
  }
  const receiptsWaiting = new Set(qfsForms.filter((s) => s.status === "submitted").map((s) => s.receiptId));

  for (const q of qualitySubs) {
    items.push({
      key: `quality-${q.id}`, section: q.section, title: QUALITY_SUBMISSION_INFO[q.kind].title, reference: q.reference, warehouse: q.warehouse,
      state: q.status === "submitted" ? "waiting_approval" : "rejected", note: q.rejectReason ?? undefined, missing: [],
      context: Object.entries(q.values).map(([k, v]) => `${k} ${v}`).slice(0, 4).join(" · "),
      since: q.submittedAt, link: { kind: "form", submissionKind: q.kind, targetId: q.targetId },
    });
  }
  const qualityWaiting = new Set(qualityWaitingRows.map((q) => `${q.kind}:${q.targetId}`));

  items.push(...receptionItems(receipts, receiptsWaiting));
  items.push(...await warehouseFormItems([site, ...names], siteType, qualityWaiting));
  if (siteType === "CENTRAL") items.push(...await productionItems(site));

  return { warehouse: site, siteType, sections: sectionsAt(siteType), items: sortQualityItems(items) };
}
