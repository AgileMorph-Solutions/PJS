import type { TransferStatus } from "../types/receipt.js";

/** A transfer moves one step at a time and never backwards. */
export const TRANSFER_STATUSES: TransferStatus[] = ["requested", "dispatched", "received"];

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  requested: "Requested",
  dispatched: "Dispatched",
  received: "Received",
};
