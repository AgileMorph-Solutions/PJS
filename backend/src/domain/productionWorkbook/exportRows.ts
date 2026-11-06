/**
 * What the production workbook shows: each tab's rows, read through the same services the production
 * screens use (listBatches, listRcnReceipts), so a status, a KOR or a net weight in the file is exactly what
 * the batch page shows.
 */
import { SILO_SIZES, SIZING_GRADES, type SiloSize } from "@anagroci/contract/domain/calibration";
import { BATCH_STATUS_LABELS } from "@anagroci/contract/domain/productionBatch";
import { RCN_RECEIPT_STATUS_LABELS } from "@anagroci/contract/domain/rcnReceipt";
import { weighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import { listBatches } from "../../services/production/batches.js";
import { listSizingChecks } from "../../services/production/calibration.js";
import { listRcnReceipts } from "../../services/production/rcnReceipts.js";
import { gramKey, joinList, runKgKey, type Tab } from "./tabs.js";

export type TabRow = Record<string, unknown>;

const CHECK_STATUS = { submitted: "Waiting for approval", approved: "Approved", rejected: "Rejected" } as const;
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function exportRows(site: string): Promise<Record<Tab["id"], TabRow[]>> {
  const [batches, receipts, sizingChecks] = await Promise.all([listBatches(site), listRcnReceipts(site), listSizingChecks(site)]);
  const word = (size: SiloSize) => SILO_SIZES.find((s) => s.key === size)!.sheet;
  // Oldest first, the order the loads happened in, as on the client's sheets.
  const loads = [...receipts].reverse();

  return {
    batches: [...batches].reverse().map((b) => ({
      code: b.code, startDate: b.startDate, bins: joinList(b.binCodes), proposedBy: b.proposedBy, plannedKg: b.plannedKg, status: BATCH_STATUS_LABELS[b.status],
    })),
    receipts: loads.map((r) => ({ id: r.id, batchCode: r.batchCode, date: r.date, btmNo: r.btmNo, binCode: r.binCode, status: RCN_RECEIPT_STATUS_LABELS[r.status] })),
    checks: loads.flatMap((r) => r.moistureChecks.map((c) => ({
      id: c.id, receiptId: r.id, btmNo: r.btmNo, loadDate: r.date, moisture: c.moisture, nutCount: c.nutCount, sampleG: c.sampleG, ...c.grams,
      decision: c.decision === "ok" ? "OK" : "Hold", kor: c.kor === null ? null : round2(c.kor), status: CHECK_STATUS[c.status],
    }))),
    pallets: loads.flatMap((r) => r.pallets.map((p) => ({
      id: p.id, receiptId: r.id, btmNo: r.btmNo, loadDate: r.date, no: p.no, grossKg: p.grossKg, bags: p.bags, factoryBin: p.factoryBin,
    }))),
    final: loads.filter((r) => r.finalWeight).map((r) => {
      const f = r.finalWeight!;
      const t = weighingTotals(r.pallets, f);
      return {
        receiptId: r.id, btmNo: r.btmNo, loadDate: r.date,
        emptyPalletsKg: joinList(f.emptyPallets.map((s) => s.weightKg)),
        // Counts only when every stack has one: a list with gaps couldn't be matched back to its stacks.
        emptyPalletsCount: f.emptyPallets.every((s) => s.count) ? joinList(f.emptyPallets.map((s) => s.count)) : "",
        dustKg: f.dustKg, voidsKg: f.voidsKg, netKg: t.netKg, toSilosKg: t.toSilosKg,
      };
    }),
    runs: loads.flatMap((r) => (r.calibration?.runs ?? []).map((c) => ({
      id: c.id, receiptId: r.id, btmNo: r.btmNo, date: c.date, totalKg: c.totalKg,
      ...Object.fromEntries(SILO_SIZES.map((s) => [runKgKey(s.key), c.sizes[s.key]])),
    }))),
    siloChecks: sizingChecks.map((c) => ({
      id: c.id, batchCode: c.batchCode, date: c.date, point: c.point === "received" ? "Received RCN" : word(c.point), binCode: c.binCode, nutCount: c.nutCount, sampleG: c.sampleG,
      ...Object.fromEntries(SIZING_GRADES.map((g) => [gramKey(g), c.grams[g]])),
      decision: c.decision === "ok" ? "OK" : "Fail", correctPct: c.correctPct === null ? null : round2(c.correctPct), status: CHECK_STATUS[c.status],
    })),
    siloMoves: sizingChecks.flatMap((c) => c.manualCalibrations.map((m) => ({ id: m.id, date: m.date, fromSize: word(m.fromSize), toSize: word(m.toSize), kg: m.kg }))),
  };
}
