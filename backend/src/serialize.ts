/**
 * Converts a Receipt row (with every stage relation included) into the exact wire shape the
 * frontend's ReceiptRecord expects, so TrackingApi doesn't have to change.
 *
 * `status` is attached, never stored. deriveStatus() is the single source of truth and runs from
 * the same @anagroci/contract module the frontend uses, so the two cannot disagree.
 */
import { deriveStatus } from "@anagroci/contract/domain/receiptStatus";
import type { ReceiptRecord, ReceiptStatus } from "@anagroci/contract/types/receipt";
import { assembleStageData, assembleBranches } from "./stageStore.js";

type AnyRow = Record<string, any>;

export function toReceiptRecord(row: AnyRow): ReceiptRecord & { status: ReceiptStatus } {
  const stageData = assembleStageData(row);
  const branches = assembleBranches(row);

  // lotNo / binNo are projections of the n-lot / n-bin stage rows, not columns on Receipt.
  // Keeping a second copy on the receipt is what used to force a sync block on every stage write.
  const lotNo = row.lot?.lotNumber ?? undefined;
  const binNo = row.bin?.binNumber ?? undefined;

  const record: ReceiptRecord = {
    id: row.id,
    source: row.source as "imported" | "entered",
    arrivalDate: row.arrivalDate,
    supplierName: row.supplierName,
    lbaCode: row.lbaCode,
    vehicleNo: row.vehicleNo,
    warehouse: row.warehouse,
    origin: row.origin ?? undefined,
    lotNo: lotNo || undefined,
    binNo: binNo || undefined,
    stageData,
    branches,
    timeline: (row.timeline ?? [])
      .slice()
      .sort((a: AnyRow, b: AnyRow) => a.id - b.id)
      .map((t: AnyRow) => ({ status: t.status as ReceiptStatus, at: t.at, note: t.note })),
  };

  return { ...record, status: deriveStatus(record) };
}
