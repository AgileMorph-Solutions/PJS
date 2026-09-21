// Prisma stores stageData/branches as JSON-encoded TEXT (see prisma/schema.prisma's header
// note) and timeline as a child table — these helpers convert to/from the wire shape that
// exactly matches frontend/src/types/receipt.ts's ReceiptRecord, so the frontend's existing
// repository layer can be pointed at this API with minimal changes.
import type { Receipt as DbReceipt, TimelineEntry as DbTimelineEntry } from "@prisma/client";
import { deriveStatus } from "./domain/receiptStatus.js";
import type { ReceiptRecord } from "./types.js";

type DbReceiptWithTimeline = DbReceipt & { timeline: DbTimelineEntry[] };

export function toReceiptRecord(row: DbReceiptWithTimeline): ReceiptRecord & { status: string } {
  const stageData = JSON.parse(row.stageData) as Record<string, Record<string, string>>;
  const branches = JSON.parse(row.branches) as Record<string, string>;
  const record: ReceiptRecord = {
    id: row.id,
    source: row.source as "imported" | "entered",
    arrivalDate: row.arrivalDate,
    supplierName: row.supplierName,
    lbaCode: row.lbaCode,
    vehicleNo: row.vehicleNo,
    warehouse: row.warehouse,
    origin: row.origin,
    lotNo: row.lotNo,
    binNo: row.binNo,
    stageData,
    branches,
    timeline: row.timeline
      .sort((a, b) => a.id - b.id)
      .map((t) => ({ status: t.status as ReceiptRecord["timeline"][number]["status"], at: t.at, note: t.note })),
  };
  return { ...record, status: deriveStatus(record) };
}
