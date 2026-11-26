import { TRANSFER_LOT_STATUS_LABELS } from "@anagroci/contract/domain/transferLot";
import { formatDate } from "@anagroci/contract/domain/dateFormat";
import type { TransferLot, TransferLotStatus } from "@anagroci/contract/types/receipt";
import { formatKg } from "../production/batchUi";
import { DataTable, type Column } from "../ui/DataTable";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Pill } from "../ui/Pill";

const LOT_TONE: Record<TransferLotStatus, string> = { waiting_weight: "decision", waiting_quality: "decision", ready: "entry", part_loaded: "term", loaded: "system", put_back: "system", closed: "system" };

/** "BIN-12 · 300 bags, BIN-16 · 200 bags" */
const binsText = (l: TransferLot) => l.bins.map((b) => `${b.binCode} · ${b.bags.toLocaleString("en-US")} bags`).join(", ");

/** The lots a Unit warehouse has made to send: what each is, where it stands, and what can still be done to it. */
export function TransferLotsTable({ lots, canEdit, canCorrect = false, onWeigh, onDelete, onPutBack, onUndoPutBack }: {
  lots: TransferLot[];
  canEdit: boolean;
  /** On a truck, a lot is weighed again by an Admin only (25 Nov 2026), and deleted by nobody. */
  canCorrect?: boolean;
  onWeigh: (lot: TransferLot) => void;
  onDelete: (lot: TransferLot) => void;
  /** Puts bags of the lot not on a truck back in a Bin (26 Nov 2026). */
  onPutBack: (lot: TransferLot) => void;
  /** An Admin undoes one put-back made by mistake. */
  onUndoPutBack: (lot: TransferLot, returnId: number) => void;
}) {
  const columns: Column<TransferLot>[] = [
    { label: "Lot", nowrap: true, filter: { value: (l) => l.lotNo }, render: (l) => <span className="font-medium">{l.lotNo}</span> },
    { label: "Date", nowrap: true, filter: { value: (l) => l.lotDate, kind: "date" }, render: (l) => formatDate(l.lotDate) },
    { label: "From Bins", filter: { value: binsText }, render: binsText },
    { label: "Bags", align: "right", nowrap: true, filter: { value: (l) => l.bags, kind: "number" }, render: (l) => l.bags.toLocaleString("en-US") },
    { label: "Net", align: "right", nowrap: true, filter: { value: (l) => l.netKg, kind: "number" }, render: (l) => (l.netKg === null ? "-" : formatKg(l.netKg)) },
    {
      label: "Moisture / KOR / nuts", nowrap: true,
      render: (l) => (l.moisture === null ? "-" : `${l.moisture}% · ${l.kor} · ${l.nutCount}`),
    },
    {
      label: "Left to load", align: "right", nowrap: true, filter: { value: (l) => l.leftBags, kind: "number" },
      render: (l) => `${l.leftBags.toLocaleString("en-US")} bags${l.leftKg !== null && l.pieces.length ? ` · ${formatKg(l.leftKg)}` : ""}`,
    },
    { label: "On trucks", render: (l) => (l.pieces.length ? l.pieces.map((p) => `${p.transferId} (${p.bags})`).join(", ") : "-") },
    {
      label: "Put back", title: "Bags of the lot put back in a Bin instead of going on a truck",
      render: (l) => (l.returns.length ? (
        <span className="flex flex-col gap-0.5">
          {l.returns.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
              {r.binCode} ({r.bags.toLocaleString("en-US")}{r.netKg !== null ? ` · ${formatKg(r.netKg)}` : ""})
              {canEdit && canCorrect && <IconButton icon="undo" label={`Undo putting ${r.bags} bags back in ${r.binCode}`} onClick={() => onUndoPutBack(l, r.id)} />}
            </span>
          ))}
        </span>
      ) : "-"),
    },
    { label: "Status", nowrap: true, filter: { value: (l) => TRANSFER_LOT_STATUS_LABELS[l.status], kind: "select" }, render: (l) => <Pill tone={LOT_TONE[l.status]} label={TRANSFER_LOT_STATUS_LABELS[l.status]} /> },
  ];
  if (canEdit) {
    columns.push({
      label: "",
      nowrap: true,
      // Weighed again or deleted only while no piece of it is on a truck: the truck's weight was worked out from it. Once on
      // one, an Admin or the Incharge may still correct its weighing (the truck's lines follow); nobody deletes it.
      // Bags put back count like bags on a truck: the lot's weighing is what the Bin got back, so only an Admin or the Incharge re-weighs
      // it and nobody deletes it (they undo the put-back first). Bags not on a truck of a weighed lot can be put back.
      render: (l) => {
        const settled = l.pieces.length > 0 || l.returns.length > 0;
        const putBack = l.netKg !== null && l.leftBags > 0
          ? <Button variant="secondary" icon="move_to_inbox" onClick={() => onPutBack(l)}>Put back in a Bin</Button> : null;
        return (
          <span className="flex items-center gap-1">
            {settled
              ? (canCorrect ? <Button variant="secondary" icon="scale" onClick={() => onWeigh(l)}>Change weight</Button> : null)
              : (
                <Button variant={l.status === "waiting_weight" ? "primary" : "secondary"} icon="scale" onClick={() => onWeigh(l)}>
                  {l.status === "waiting_weight" ? "Record weight" : "Change weight"}
                </Button>
              )}
            {putBack}
            {!settled && <IconButton icon="delete" label={`Delete ${l.lotNo}`} onClick={() => onDelete(l)} />}
          </span>
        );
      },
    });
  }
  return (
    <DataTable
      columns={columns}
      rows={lots}
      keyFn={(l) => String(l.id)}
      emptyTitle="No lots made yet"
      emptyHint="Make a lot out of one or more Bins, weigh it, then load it on a truck."
    />
  );
}
