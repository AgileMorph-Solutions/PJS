/**
 * Traces a receipt to other records about the same physical batch, joined on FICHE — the paper
 * docket number that actually travels with a batch across OFFLOADINGS, the drying report, and the
 * transfer ledger. Bin can't do this job at all: it's two disjoint per-warehouse namespaces
 * (Bouaké BKE-* vs Yakro BIN-*). Lot looks like it should — it's the client's own tracking key —
 * but measurably can't either: each warehouse runs its own 1..N lot sequence, so the same batch is
 * Lot 17 at Bouaké and Lot 20 downstream (334 of 339 fiche-matched transfers and 12 of 12 drying
 * rows disagree). Verified against the real data: fiche 72566 -> drying job DRY-4 (Lot 20, bin
 * BIN-09A) AND transfer SN 27 (Lot 20, bin BIN-03C) — two independently-maintained sheets agreeing
 * with EACH OTHER on Lot 20 for the same fiche, while the receipt's own Lot (from the unit-warehouse
 * discharge import) is 17 — is the confirmation both that fiche is the real link and that lot
 * genuinely renumbers per site. Note the bins differ too (received in one, moved to another for
 * drying) — never merge either one into a single "the lot"/"the bin".
 *
 * Switching this join to lot would replace a verified-correct linkage with one that's wrong ~98%
 * of the time while looking more principled. The disagreement is reported in aggregate by the
 * `lot_namespace_disagreement` check and per row below as `lotAgrees`, so it stays a visible,
 * client-answerable question instead of a join no one notices is silently wrong.
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
  /** Whether this row's lot matches the receipt's own. False is the norm, not a bug — see header. */
  lotAgrees: boolean;
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
  lotAgrees: boolean;
}

export interface LinkedBtmIntake {
  btmNo: string;
  binNo: string;
}

export interface ReceiptLinks {
  fiche: string | null;
  /** The receipt's OWN Lot, as assigned at its unit warehouse. Null for the receipts no discharge
   * sheet covers yet. Shown next to each linked row's lot so a mismatch is visible, not hidden. */
  lotNo: string | null;
  lotWarehouse: string | null;
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
  const [verify, own] = await Promise.all([
    prisma.stageVerifyDocs.findUnique({ where: { receiptId: id }, select: { fiche: true } }),
    prisma.stageLotAssignment.findUnique({
      where: { receiptId: id }, select: { lotNumber: true, warehouseName: true },
    }),
  ]);
  const fiche = verify?.fiche?.trim() || null;
  const lotNo = own?.lotNumber?.trim() || null;
  const lotWarehouse = own?.warehouseName?.trim() || null;
  if (!fiche) return { fiche: null, lotNo, lotWarehouse, dryingJobs: [], transfers: [], btmIntakes: [] };

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

  // Only claim agreement when BOTH sides actually have a lot — an absent lot is unknown, not equal.
  const agrees = (theirs: string | null) =>
    !!lotNo && !!theirs?.trim() && theirs.trim() === lotNo;

  return {
    fiche,
    lotNo,
    lotWarehouse,
    dryingJobs: dryingRows.map((d) => ({ ...d, lotAgrees: agrees(d.lotNo) })),
    transfers: transferRows.map((r) => ({
      sn: r.sn,
      receivedDate: formatReceivedDate(r.receivedDate, r.rawDate),
      lotNo: r.lotNo,
      binNo: r.binNo,
      truckRegistration: r.truckRegistration,
      bagsReceived: r.bagsReceived,
      sourceWarehouse: r.sourceWarehouse,
      lotAgrees: agrees(r.lotNo),
    })),
    btmIntakes,
  };
}
