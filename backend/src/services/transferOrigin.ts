/**
 * What a reception from the Unit warehouse shows of its BKT (contract TransferOrigin): the truck, who drove it, and what was
 * sent of this lot — read from the BKT line each time, never copied onto the reception.
 */
import type { TransferOrigin } from "@anagroci/contract/types/receipt";
import { lotNetKg, pieceNetKg } from "@anagroci/contract/domain/transferLot";

type Dec = { toString(): string } | null;
const num = (d: Dec) => (d === null ? null : Number(d.toString()));

export interface TransferLineForOrigin {
  id: number;
  bags: number | null;
  netWeightKg: Dec;
  moisture: Dec;
  kor: Dec;
  nutCount: number | null;
  binCode: string | null;
  transferLot: { lotNo: string; grossWeightKg: Dec; moisture: Dec; kor: Dec; nutCount: number | null; bins: { bags: number }[] } | null;
  receipt: { lot: { lotNumber: string | null } | null } | null;
  transfer: { id: string; fromWarehouse: string; truckNo: string | null; transporter: string | null; driver: string | null; driverPhone: string | null; dispatchedAt: Date | null };
}

export function transferOrigin(l: TransferLineForOrigin): TransferOrigin {
  const lot = l.transferLot;
  const lotBags = lot?.bins.reduce((a, b) => a + b.bags, 0) ?? 0;
  // The same rules as the BKT itself: a lot's piece weighs its share of the lot's weighing unless one was entered for it,
  // and leaves with the quality the dispatch recorded, else the lot's own.
  const netKg = lot && l.netWeightKg === null ? pieceNetKg(lotNetKg(num(lot.grossWeightKg), lotBags), lotBags, l.bags ?? 0) : num(l.netWeightKg);
  return {
    transferId: l.transfer.id,
    lineId: l.id,
    fromWarehouse: l.transfer.fromWarehouse,
    sentAs: lot?.lotNo ?? l.receipt?.lot?.lotNumber ?? (l.binCode ? `Bin ${l.binCode}` : `line ${l.id}`),
    truckNo: l.transfer.truckNo,
    transporter: l.transfer.transporter,
    driver: l.transfer.driver,
    driverPhone: l.transfer.driverPhone,
    dispatchedAt: l.transfer.dispatchedAt?.toISOString() ?? null,
    sent: {
      bags: l.bags,
      netKg,
      moisture: num(l.moisture ?? lot?.moisture ?? null),
      kor: num(l.kor ?? lot?.kor ?? null),
      nutCount: l.nutCount ?? lot?.nutCount ?? null,
    },
  };
}
