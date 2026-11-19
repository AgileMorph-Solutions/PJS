/**
 * What the production workbook shows: each tab's rows, read through the same services the production
 * screens use (listBatches, listRcnReceipts), so a status, a KOR or a net weight in the file is exactly what
 * the batch page shows.
 */
import { SILO_SIZES, SIZING_GRADES, sizingGramsTotal, type SiloSize } from "@anagroci/contract/domain/calibration";
import { TRUCK_STATUS_LABELS, truckCategory } from "@anagroci/contract/domain/byProducts";
import { ENTRY_DEFS, ENTRY_KINDS, durationHours, machineSampleFigures, shellSampleFigures, sizeWord, type EntryKind } from "@anagroci/contract/domain/lotEntries";
import { RCN_RECEIPT_STATUS_LABELS, qualityFigures } from "@anagroci/contract/domain/rcnReceipt";
import { JUTE_BAG_KG, weighingTotals } from "@anagroci/contract/domain/rcnWeighing";
import type { RcnReceipt } from "@anagroci/contract/types/rcnReceipt";
import { listBatches } from "../../services/production/batches.js";
import { listBoilerReadings, listTrucks } from "../../services/production/byProducts.js";
import { listSizingChecks } from "../../services/production/calibration.js";
import { listLots } from "../../services/production/factoryLots.js";
import { listRcnReceipts } from "../../services/production/rcnReceipts.js";
import { SORTER_POINTS, gramKey, joinList, runKgKey, splitList, type Tab } from "./tabs.js";

export type TabRow = Record<string, unknown>;

const CHECK_STATUS = { submitted: "Waiting for approval", approved: "Approved", rejected: "Rejected" } as const;
const round2 = (n: number) => Math.round(n * 100) / 100;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The tally sheet's =TEXT(date,"mmm-yy"): 2026-07-20 → Jul-26. */
export const monthWord = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}`;
/** The tally sheet's =WEEKNUM(date): weeks start on Sunday, and the week of 1 January is week 1. 2026-07-20 → 30. */
export function weekNum(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.round((d.getTime() - jan1.getTime()) / 86_400_000);
  return Math.floor((dayOfYear + jan1.getUTCDay()) / 7) + 1;
}

const r2 = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? null : round2(n));
/** 17's "Size (mm)": 25 for A+, >25 for A++. */
const mmOf = (size: string | undefined) => SILO_SIZES.find((s) => s.key === size)?.mm.replace(" mm", "") ?? null;

/**
 * The formula columns of the client's sheets for a Lot record, worked out as their own formulas do: 17's Total Time
 * (=MOD(end − start, 24)), 23's Duration, Uncut Duration, Uncut % and Cutting Hrs (= the two durations), 21's Per hour
 * (= per minute × 0.06), and the % columns of 13 and 11.
 */
function entryFormulas(kind: EntryKind, v: Record<string, string | undefined>): TabRow {
  switch (kind) {
    case "cooker_log":
      return { sizeMm: mmOf(v.size), totalTime: r2(durationHours(v.start, v.stop)) };
    case "line_run": {
      const run = durationHours(v.start, v.end);
      const uncut = durationHours(v.uncutStart, v.uncutEnd);
      const input = Number(v.inputKg) || 0;
      return {
        duration: r2(run), uncutDuration: r2(uncut), uncutPct: input > 0 ? r2(((Number(v.uncutKg) || 0) / input) * 100) : null,
        cuttingHrs: run === null ? null : r2(run + (uncut ?? 0)),
      };
    }
    case "qc5_frequency":
      return { perHour: v.gramsPerMin ? r2((Number(v.gramsPerMin) || 0) * 0.06) : null };
    case "qc5_capacity": {
      const f = machineSampleFigures(v);
      return {
        errorG: r2(f.errorG), uncutPct: r2(f.uncutPct), unscoopPct: r2(f.unscoopPct), totalKernels: r2(f.totalKernels),
        knifeMarkPct: r2(f.knifeMarkPct), edgeCutPct: r2(f.edgeCutPct), wholesPct: r2(f.wholesPct), piecesPct: r2(f.piecesPct),
      };
    }
    case "qc6": {
      const f = shellSampleFigures(v);
      return { errorG: r2(f.errorG), kernelPct: r2(f.kernelPct), kernelLbs: r2(f.kernelLbs) };
    }
    default:
      return {};
  }
}

/**
 * One row per pallet, as the client's Online sheet has them. The load's empty-pallet weighings go one per row from its
 * first pallet down (the sheet scatters them the same way), and its dust and voids on its first row; a load with more
 * weighings than pallets keeps the rest on its last row, separated by /.
 */
function tallyRows(loads: RcnReceipt[]): TabRow[] {
  let slNo = 0;
  return loads.flatMap((r) => {
    const stacks = r.finalWeight?.emptyPallets.map((s) => s.weightKg) ?? [];
    return r.pallets.map((p, i) => {
      const last = i === r.pallets.length - 1;
      const palletKg = last ? joinList(stacks.slice(i)) : stacks[i] ?? "";
      const bagsKg = round2((Number(p.bags) || 0) * JUTE_BAG_KG);
      return {
        slNo: ++slNo, date: r.date, week: weekNum(r.date), month: monthWord(r.date), binCode: r.binCode, factoryBin: p.factoryBin,
        btmNo: r.btmNo, palletNo: p.no, grossKg: p.grossKg, bags: p.bags, bagsKg, palletKg,
        netKg: round2((Number(p.grossKg) || 0) - bagsKg - splitList(palletKg).reduce((n, w) => n + (Number(w) || 0), 0)),
        dustKg: i === 0 ? r.finalWeight?.dustKg ?? null : null, voidsKg: i === 0 ? r.finalWeight?.voidsKg ?? null : null,
      };
    });
  });
}

export async function exportRows(site: string): Promise<Partial<Record<Tab["id"], TabRow[]>>> {
  const [batches, receipts, sizingChecks, lots, trucks, boiler] = await Promise.all([listBatches(site), listRcnReceipts(site), listSizingChecks(site), listLots(site), listTrucks(site), listBoilerReadings(site)]);
  const word = (size: SiloSize) => SILO_SIZES.find((s) => s.key === size)!.sheet;
  // Oldest first, the order the loads happened in, as on the client's sheets.
  const loads = [...receipts].reverse();
  // Every "Batch Name" cell names the run the way people know it: its name when it has one, else its ID.
  const runNames = new Map(batches.map((b) => [b.code, b.name ?? b.code]));
  const run = (code: string) => runNames.get(code) ?? code;

  return {
    receipts: loads.map((r) => {
      const t = weighingTotals(r.pallets, r.finalWeight ?? undefined);
      const closed = r.finalWeight !== null;
      return {
        date: r.date, cropYear: r.cropYear, btmNo: r.btmNo, binCode: r.binCode, factoryBin: joinList([...new Set(r.pallets.map((p) => p.factoryBin))]),
        // Before the final weight there are no pallets' tare, dust or voids yet: a net then would only be half the story.
        grossKg: r.pallets.length ? t.grossKg : null, tareKg: closed ? round2(t.bagsKg + t.palletKg) : null, netKg: closed ? t.netKg : null,
        dustKg: r.finalWeight?.dustKg ?? null, voidsKg: r.finalWeight?.voidsKg ?? null, toSilosKg: closed ? t.toSilosKg : null,
        status: RCN_RECEIPT_STATUS_LABELS[r.status],
      };
    }),
    tally: tallyRows(loads),
    checks: loads.flatMap((r) => r.moistureChecks.map((c) => {
      const q = qualityFigures({ ...c.grams, sampleG: c.sampleG });
      return {
        id: c.id, receiptId: r.id, btmNo: r.btmNo, binCode: r.binCode, loadDate: r.date, cropYear: r.cropYear, moisture: c.moisture, nutCount: c.nutCount, sampleG: c.sampleG, ...c.grams,
        decision: c.decision === "ok" ? "OK" : "Hold", kor: r2(c.kor), shot: r2(q.shot), fot: r2(q.fot), fruitWastePct: r2(q.fruitWastePct),
        gkYieldPct: r2(q.gkYieldPct), totalYieldPct: r2(q.totalYieldPct), status: CHECK_STATUS[c.status],
      };
    })),
    siloChecks: sizingChecks.map((c) => ({
      id: c.id, batchCode: run(c.batchCode), date: c.date, point: c.point === "received" ? "Received RCN" : word(c.point), binCode: c.binCode, nutCount: c.nutCount, sampleG: c.sampleG,
      sizeMm: c.point === "received" ? null : SILO_SIZES.find((s) => s.key === c.point)!.mm, errorG: r2((Number(c.sampleG) || 0) - sizingGramsTotal(c.grams)),
      ...Object.fromEntries(SIZING_GRADES.map((g) => [gramKey(g), c.grams[g]])),
      decision: c.decision === "ok" ? "OK" : "Fail", correctPct: c.correctPct === null ? null : round2(c.correctPct), status: CHECK_STATUS[c.status],
    })),
    siloMoves: sizingChecks.flatMap((c) => c.manualCalibrations.map((m) => ({ id: m.id, date: m.date, fromSize: word(m.fromSize), toSize: word(m.toSize), kg: m.kg }))),
    cooking: lots.flatMap((l) => l.runs.map((r) => ({
      id: r.id, batchCode: run(l.batchCode), lotCode: l.code, date: r.date, totalKg: r.totalKg, bags: round2(r.totalKg / 80), damagedKg: r.damagedKg,
      ...Object.fromEntries(SILO_SIZES.map((s) => [runKgKey(s.key), r.sizes[s.key]])),
    }))),
    cooling: lots.filter((l) => l.coolingAt).map((l) => ({ lotCode: l.code, silo: l.coolingSilo, date: l.coolingAt!.slice(0, 10), time: l.coolingAt!.slice(11) })),
    shellingDays: lots.flatMap((l) => l.shellingDays.map((d) => ({
      id: d.id, lotCode: l.code, date: d.date, inputKg: d.inputKg, ...d.kg,
      shellDustKg: d.figures.shellDustKg, shellKg: d.figures.shellKg, goodKg: d.figures.goodKg, finalKg: d.figures.finalKg, shotLbs: round2(d.figures.shotLbs),
      yieldPct: round2(d.figures.yieldPct), realisationPct: round2(d.figures.realisationPct), wholesPct: round2(d.figures.wholesPct), uncutPct: round2(d.figures.uncutPct),
    }))),
    boiler: [...boiler].reverse().map((b) => ({ id: b.id, date: b.date, material: "Shell", shellKg: b.shellKg, runningHours: b.runningHours })),
    // File 15 is every waste truck, its Category saying which; file 16 is the shell sold.
    wasteTrucks: [...trucks].reverse().filter((t) => t.stream !== "shell").map((t) => ({ ...truckRow(t), category: truckCategory(t.stream, t.category) })),
    shellTrucks: [...trucks].reverse().filter((t) => t.stream === "shell").map(truckRow),
    sorter: SORTER_POINTS.flatMap((p) => entryRows(p.kind).map((r): TabRow => ({ ...r, point: p.word }))).sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.id) - Number(b.id)),
    ...Object.fromEntries(ENTRY_KINDS.filter((k) => !SORTER_POINTS.some((p) => p.kind === k)).map((kind) => [`entry:${kind}`, entryRows(kind)])),
  };

  function entryRows(kind: EntryKind): TabRow[] {
    return lots.flatMap((l) => l.entries.filter((e) => e.kind === kind).map((e) => ({
      id: e.id, lotCode: l.code, date: e.date, status: CHECK_STATUS[e.status],
      decision: e.decision === null ? null : e.decision === "ok" ? "OK" : e.decision === "wait" ? "Wait" : "No",
      ...Object.fromEntries(ENTRY_DEFS[kind].fields.map((f) => [`v_${f.key}`, f.type === "size" ? sizeWord(e.values[f.key]) : e.values[f.key]])),
      ...entryFormulas(kind, e.values),
    })));
  }
}

function truckRow(t: Awaited<ReturnType<typeof listTrucks>>[number]): TabRow {
  return {
    id: t.id, date: t.date, truckNo: t.truckNo, driver: t.driver, documentsChecked: t.documentsChecked ? "Yes" : "No", slipNo: t.slipNo, tareKg: t.tareKg, grossKg: t.grossKg,
    buyer: t.buyer, price: t.price, gatePassNo: t.gatePassNo, netKg: t.netKg, status: TRUCK_STATUS_LABELS[t.status],
  };
}
