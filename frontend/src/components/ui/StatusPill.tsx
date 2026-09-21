import type { ReceiptStatus } from "../../types/receipt";
import { STATUS_LABELS, STATUS_TONE } from "../../domain/receiptStatus";

const TONE_CLASS: Record<string, string> = {
  entry: "kind-entry",
  decision: "kind-decision",
  system: "kind-system",
  gap: "kind-gap",
  term: "kind-term",
};

export function StatusPill({ status }: { status: ReceiptStatus }) {
  return <span className={`kind-chip pill ${TONE_CLASS[STATUS_TONE[status]]}`}>{STATUS_LABELS[status]}</span>;
}
