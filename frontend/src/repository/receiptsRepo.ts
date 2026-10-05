import type { ReceiptRecord } from "../types/receipt";
import seedReceipts from "../data/seed/receipts.json";

export function loadSeedReceipts(): ReceiptRecord[] {
  return seedReceipts as unknown as ReceiptRecord[];
}

// There is deliberately no client-side id generator here: Receipt IDs (REC-<code>-<year>-NNN) are
// issued by the server when the arrival is recorded, and a guessed one would be wrong or collide.
