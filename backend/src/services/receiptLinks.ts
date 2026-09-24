/**
 * Traces a receipt to other records about the same physical batch, joined on FICHE — the paper
 * docket number that actually travels with a batch across OFFLOADINGS, the drying report, and the
 * transfer ledger. Lot and Bin can't do this job: `lot_namespace_conflict`
 * (domain/dataQuality/checks.ts) already documents that receipt lots and drying lots share zero
 * keys, and Bin is two disjoint per-warehouse namespaces (Bouaké BKE-* vs Yakro BIN-*). Verified
 * against the real data before building this: e.g. fiche 72566 -> drying job DRY-4 (Lot 20, bin
 * BIN-09A) AND transfer SN 27 (Lot 20, bin BIN-03C) — two independently-maintained sheets agreeing
 * on the same Lot for the same fiche is the confirmation this link is real, not coincidence. Note
 * the bins differ (received in one, moved to another for drying) — never merge them into "the bin".
 */
import { prisma } from "../db.js";

// Extended to production: a linked transfer's own `idTransfer` column IS the production BTM
// number (45 production BTMs were confirmed to match real `idTransfer` values before this was
// added) — one more hop, transfer.idTransfer -> BtmIntake.btmNo, surfaces the production side of
// the same physical batch without inventing a new join key.

export interface LinkedDryingJob {
  id: string;
  date: string;
  warehouse: string;
  bin: string;
  lotNo: string;
  status: string;
  dryType: string;
  destination: string;
}

export interface LinkedTransfer {
  sn: number;
  receivedDate: string | null;
  lotNo: string | null;
  binNo: string | null;
  truckRegistration: string | null;
  bagsReceived: number | null;
  sourceWarehouse: string;
}

export interface LinkedBtmIntake {
  btmNo: string;
  binNo: string;
}

export interface ReceiptLinks {
  fiche: string | null;
  dryingJobs: LinkedDryingJob[];
  transfers: LinkedTransfer[];
  btmIntakes: LinkedBtmIntake[];
}

/** DATE -> "YYYY-MM-DD"; falls back to the hand-typed original text when the source cell wasn't a
 * real date (11 real transfer rows are like this) — mirrors services/ledgers.ts's RAW_FALLBACK for
 * this exact column, since this is the same underlying data reached a different way. */
function formatReceivedDate(receivedDate: Date | null, rawDate: string | null): string | null {
  if (receivedDate) return receivedDate.toISOString().slice(0, 10);
  return rawDate;
}

export async function getReceiptLinks(id: string): Promise<ReceiptLinks> {
  const verify = await prisma.stageVerifyDocs.findUnique({
    where: { receiptId: id },
    select: { fiche: true },
  });
  const fiche = verify?.fiche?.trim() || null;
  if (!fiche) return { fiche: null, dryingJobs: [], transfers: [], btmIntakes: [] };

  const [dryingRows, transferRows] = await Promise.all([
    prisma.dryingJob.findMany({
      where: { ficheNo: fiche },
      select: { id: true, date: true, warehouse: true, bin: true, lotNo: true, status: true, dryType: true, destination: true },
      orderBy: { date: "asc" },
    }),
    prisma.juteWarehouseTransferReceipt.findMany({
      where: { noFiche: fiche },
      select: {
        sn: true, receivedDate: true, rawDate: true, lotNo: true, binNo: true,
        truckRegistration: true, bagsReceived: true, sourceWarehouse: true, idTransfer: true,
      },
      orderBy: { sn: "asc" },
    }),
  ]);

  // One more hop: idTransfer on a linked transfer is the production BTM number. Several transfers
  // can (rarely) share an idTransfer, so dedupe before the BtmIntake lookup.
  const btmNos = [...new Set(transferRows.map((r) => r.idTransfer?.trim()).filter((v): v is string => !!v))];
  const btmIntakes = btmNos.length
    ? await prisma.btmIntake.findMany({ where: { btmNo: { in: btmNos } }, select: { btmNo: true, binNo: true }, orderBy: { btmNo: "asc" } })
    : [];

  return {
    fiche,
    dryingJobs: dryingRows,
    transfers: transferRows.map((r) => ({
      sn: r.sn,
      receivedDate: formatReceivedDate(r.receivedDate, r.rawDate),
      lotNo: r.lotNo,
      binNo: r.binNo,
      truckRegistration: r.truckRegistration,
      bagsReceived: r.bagsReceived,
      sourceWarehouse: r.sourceWarehouse,
    })),
    btmIntakes,
  };
}
