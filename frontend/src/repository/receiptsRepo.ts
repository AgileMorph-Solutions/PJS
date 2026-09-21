import type { ReceiptRecord } from "../types/receipt";
import seedReceipts from "../data/seed/receipts.json";

export function loadSeedReceipts(): ReceiptRecord[] {
  return seedReceipts as unknown as ReceiptRecord[];
}

let counter = 0;
export function nextReceiptId(existing: ReceiptRecord[]): string {
  const year = new Date().getFullYear();
  const max = existing
    .map((r) => Number(r.id.split("-").pop()))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  counter = Math.max(counter, max) + 1;
  return `REC-${year}-${String(counter).padStart(4, "0")}`;
}

export function blankReceipt(id: string): ReceiptRecord {
  return {
    id,
    source: "entered",
    arrivalDate: new Date().toISOString().slice(0, 10),
    supplierName: "",
    lbaCode: "",
    vehicleNo: "",
    warehouse: "",
    stageData: {},
    branches: {},
    timeline: [{ status: "planned", at: new Date().toISOString() }],
  };
}
