/**
 * Empty jute bags received from another warehouse (client observations list, point 8: "Need to add TAB for receiving EMPTY JUTE
 * BAG - INTER WH TRANSFER"). The RCN transfer ledger can't hold these: every column there is about a load of cashew.
 *
 * The client's Q&A (RCN PROCUREMENT QUESTIONS_ANSWERS.docx, section 3.4) has a transfer reduce Warehouse A and increase
 * Warehouse B. Warehouse A's half already exists: Bouaké records what it sends as bags issued on its own stock ledger (the
 * "TRANSFFER TO YAMOUSSOUKRO" rows). This is Warehouse B's half, so what is received is one row of B's stock ledger and the
 * running balance needs no second source.
 */
import { isRealDate, parseBags } from "./juteVendorReceipt.js";

/** Contains "TRANSFER", so the jute_movement_stream view reads a row of received bags under it as a transfer in. */
export const JUTE_TRANSFER_IN_ACTIVITY = "EMPTY BAGS TRANSFER RECEIVED";

export interface EmptyBagReceiptInput {
  fromWarehouse?: string;
  date?: string;
  truckNumber?: string;
  warehouseReceiptNo?: string;
  bagsReceived?: string | number | null;
  responsibleParty?: string;
}

/** What is wrong with an entry, in plain words, or an empty list. One place, for the form and for the server. */
export function emptyBagReceiptProblems(input: EmptyBagReceiptInput, receivingWarehouse: string): string[] {
  const out: string[] = [];
  const from = input.fromWarehouse?.trim();
  if (!from) out.push("Choose the warehouse the bags came from.");
  else if (from === receivingWarehouse) out.push("The bags must come from a different warehouse.");
  if (!isRealDate(input.date?.trim() ?? "")) out.push("Enter the date the bags were received.");
  const bags = parseBags(input.bagsReceived);
  // A receipt of nothing adds no stock, and the ledger would read a 0 as a movement out.
  if (bags === null || bags === 0) out.push("Bags received must be a whole number of bags, at least 1.");
  // The Q&A's traceability rule names the responsible person on every movement, and the truck only "where applicable".
  if (!input.responsibleParty?.trim()) out.push("Enter the responsible person or team.");
  return out;
}
