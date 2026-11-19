/**
 * How the Logs page names what changed: a person's word for each table, and for each column the label its screen uses.
 * Columns not named here read as their name in plain words ("driverPhone" → "Driver phone"), so a new column is never
 * shown as a bare code — but the ones people meet daily are named exactly as on their screen.
 */
import { stageById } from "@anagroci/contract/data/stages";

/** The area of the app a table belongs to, for the Logs page's filter. */
export type LogArea = "Transfers" | "Delivery plans" | "Procurement" | "Masters" | "Production" | "Drying" | "Jute bags" | "Users" | "Other";

const ENTITIES: Record<string, { label: string; area: LogArea }> = {
  Receipt: { label: "Truck", area: "Procurement" },
  ReceiptBranch: { label: "Truck decision", area: "Procurement" },
  TransferRequest: { label: "Transfer (BKT)", area: "Transfers" },
  TransferRequestLine: { label: "Lot on a transfer", area: "Transfers" },
  DeliveryPlan: { label: "Delivery plan", area: "Delivery plans" },
  Supplier: { label: "Supplier", area: "Masters" },
  Warehouse: { label: "Warehouse", area: "Masters" },
  Bin: { label: "Bin", area: "Masters" },
  Origin: { label: "Origin", area: "Masters" },
  WarehouseAlias: { label: "Warehouse alias", area: "Masters" },
  DryingJob: { label: "Drying job", area: "Drying" },
  DryingBatch: { label: "Drying round", area: "Drying" },
  ProductionBatch: { label: "Production run", area: "Production" },
  ProductionBatchBin: { label: "Bin in a production run", area: "Production" },
  RcnReceipt: { label: "RCN receipt", area: "Production" },
  User: { label: "User", area: "Users" },
  BranchManagerSupplier: { label: "Branch Manager's supplier", area: "Users" },
  SupplierRequest: { label: "Supplier request", area: "Users" },
};

const FIELDS: Record<string, Record<string, string>> = {
  TransferRequest: {
    transferDate: "Date", fromWarehouse: "From", toWarehouse: "To", toStore: "To store", status: "Step", truckNo: "Truck number",
    dispatchedGrossKg: "Loaded weight (kg)", dispatchWhReceiptNo: "Warehouse receipt no. (dispatch)", receiveWhReceiptNo: "Warehouse receipt no. (arrival)",
    bagsReceived: "Bags received", receivedGrossKg: "Gross weight received (kg)", korReceived: "KOR received", moistureReceived: "Moisture received (%)",
    nutCountReceived: "Nut count received", receivedComment: "Comment on arrival", receivedLotNoRaw: "Their Lot number", dispatchedAt: "Dispatched at",
    receivedAt: "Received at", dispatchedBy: "Dispatched by", receivedBy: "Received by",
  },
  TransferRequestLine: {
    bags: "Bags", netWeightKg: "Net weight (kg)", moisture: "Moisture (%)", kor: "KOR", nutCount: "Nut count", binCode: "Loaded from bin",
    receivedBinCode: "Unloaded into bin", bagsReceived: "Bags received",
  },
};

const humanize = (s: string) => {
  const words = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").toLowerCase()
    .replace(/\bkg\b/g, "(kg)").replace(/\bno\b/g, "no.").replace(/\bkor\b/g, "KOR").replace(/\brcn\b/g, "RCN").replace(/\bgrn\b/g, "GRN")
    .replace(/\bbtm\b/g, "BTM").replace(/\bbkt\b/g, "BKT").replace(/\blot\b/g, "Lot").replace(/\bbin\b/g, "Bin");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function entityLabel(entity: string): { label: string; area: LogArea } {
  if (ENTITIES[entity]) return ENTITIES[entity]!;
  if (/^(Jute)/.test(entity)) return { label: humanize(entity), area: "Jute bags" };
  if (/^(Drying)/.test(entity)) return { label: humanize(entity), area: "Drying" };
  if (/^(Warehouse(Discharge|DispatchLine|ActivityLedgerEntry)|ActivityLedgerEntry|OtherActivity)$/.test(entity)) return { label: humanize(entity), area: "Procurement" };
  return { label: humanize(entity), area: "Production" };
}

/** A truck decision's column is the decision itself: "Decision: Quality check (QFS)". */
export function fieldLabel(entity: string, field: string | null, recordId: string | null): string | null {
  if (field === null) return null;
  if (entity === "ReceiptBranch" && field === "branchId") {
    const stageId = recordId?.split(" · ")[1];
    return `Decision: ${(stageId && stageById[stageId]?.title) || stageId || "step"}`;
  }
  return FIELDS[entity]?.[field] ?? field.split(", ").map(humanize).join(", ");
}
