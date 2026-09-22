// Domain-aware wrapper around ui/Pill: knows how a ReceiptStatus maps to a label and a tone.
// Lives here, not in components/ui/, precisely because it does know that — see frontend/CLAUDE.md's
// components/ vs components/ui/ split.
import type { ReceiptStatus } from "../types/receipt";
import { STATUS_LABELS, STATUS_TONE } from "../domain/receiptStatus";
import { Pill } from "./ui/Pill";

export function ReceiptStatusPill({ status }: { status: ReceiptStatus }) {
  return <Pill tone={STATUS_TONE[status]} label={STATUS_LABELS[status]} />;
}
