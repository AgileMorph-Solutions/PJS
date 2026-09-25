/**
 * Traces a receipt to other records about the same physical batch, joined on Lot Number — the
 * receipt's own tracking key, assigned at its unit warehouse (`StageLotAssignment.lotNumber`).
 *
 * WARNING, verified against the live data (2026-09-25): Lot Number is measurably NOT a reliable
 * cross-warehouse key. Each warehouse assigns its own independent 1..N Lot sequence, so the same
 * physical batch is "Lot 17" at Bouaké and "Lot 20" downstream — and a small integer like "17"
 * inevitably recurs across many unrelated batches too. Matching purely on Lot Number found 365
 * transfer rows and 40 drying rows across the real data, of which only 5 transfers and 0 drying
 * rows also share the receipt's own FICHE (the paper docket number that actually does travel with
 * a batch — see `lot_namespace_disagreement` for the aggregate finding). Concrete example: receipt
 * REC-2026-0025 (FICHE 72566, Lot 17 at BOUAKE) — FICHE-joining resolves it to drying job DRY-4 and
 * transfer SN 27 (both independently Lot 20); Lot-joining instead resolves it to transfer SN 13,
 * whose FICHE is 72563 — a different truck that merely happens to share the number "17".
 *
 * This join was switched from FICHE to Lot Number on explicit request (the client's own tracking
 * key, wanted as the primary lookup), with this tradeoff accepted: most rows below are very likely
 * a different physical batch that happens to share a Lot number at its own site, not a confirmed
 * match. Every row carries `ficheAgrees` — true only when that row's own FICHE also matches this
 * receipt's FICHE — so a genuinely-confirmed match stays distinguishable from a coincidental Lot
 * collision, and the frontend renders a prominent warning rather than presenting these as verified
 * links. Bin can't do this job at all: it's two disjoint per-warehouse namespaces (Bouaké BKE-* vs
 * Yakro BIN-*).
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
  /** True only when this row's own FICHE also matches the receipt's FICHE — a genuinely-confirmed
   * match, not just a coincidental Lot-number collision (the norm — see header). */
  ficheAgrees: boolean;
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
  ficheAgrees: boolean;
}

export interface LinkedBtmIntake {
  btmNo: string;
  binNo: string;
}

export interface ReceiptLinks {
  /** The receipt's OWN Lot, as assigned at its unit warehouse — now the join key. Null for the
   * receipts no discharge sheet covers yet. */
  lotNo: string | null;
  lotWarehouse: string | null;
  /** This receipt's own FICHE, shown only so each matched row's `ficheAgrees` is checkable — see
   * header on why FICHE, not Lot, is the reliable identifier. */
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
  const [verify, own] = await Promise.all([
    prisma.stageVerifyDocs.findUnique({ where: { receiptId: id }, select: { fiche: true } }),
    prisma.stageLotAssignment.findUnique({
      where: { receiptId: id }, select: { lotNumber: true, warehouseName: true },
    }),
  ]);
  const fiche = verify?.fiche?.trim() || null;
  const lotNo = own?.lotNumber?.trim() || null;
  const lotWarehouse = own?.warehouseName?.trim() || null;
  if (!lotNo) return { lotNo: null, lotWarehouse, fiche, dryingJobs: [], transfers: [], btmIntakes: [] };

  const [dryingRows, transferRows] = await Promise.all([
    prisma.dryingJob.findMany({
      where: { lotNo },
      select: { id: true, date: true, warehouse: true, bin: true, lotNo: true, status: true, dryType: true, destination: true, ficheNo: true },
      orderBy: { date: "asc" },
    }),
    prisma.juteWarehouseTransferReceipt.findMany({
      where: { lotNo },
      select: {
        sn: true, receivedDate: true, rawDate: true, lotNo: true, binNo: true,
        truckRegistration: true, bagsReceived: true, sourceWarehouse: true, idTransfer: true, noFiche: true,
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

  // Only claim agreement when BOTH sides actually have a fiche — an absent fiche is unknown, not equal.
  const ficheAgrees = (theirs: string | null) =>
    !!fiche && !!theirs?.trim() && theirs.trim() === fiche;

  return {
    lotNo,
    lotWarehouse,
    fiche,
    dryingJobs: dryingRows.map((d) => ({
      id: d.id, date: d.date, warehouse: d.warehouse, bin: d.bin, lotNo: d.lotNo,
      status: d.status, dryType: d.dryType, destination: d.destination,
      ficheAgrees: ficheAgrees(d.ficheNo),
    })),
    transfers: transferRows.map((r) => ({
      sn: r.sn,
      receivedDate: formatReceivedDate(r.receivedDate, r.rawDate),
      lotNo: r.lotNo,
      binNo: r.binNo,
      truckRegistration: r.truckRegistration,
      bagsReceived: r.bagsReceived,
      sourceWarehouse: r.sourceWarehouse,
      ficheAgrees: ficheAgrees(r.noFiche),
    })),
    btmIntakes,
  };
}
