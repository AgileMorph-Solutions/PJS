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
 *
 * Since the Oct 2026 ID standardisation every lot carries its warehouse's code (LOT-BKE01-2026-017),
 * so an exact Lot match can no longer pair one warehouse's "17" with another's — the coincidental
 * collisions described above are gone, and so are the (rare) real cross-site links they happened to
 * include, because a batch's Lot at a downstream warehouse is a different number in its own
 * warehouse's format. So every table is now matched on the exact Lot OR on this receipt's FICHE,
 * the one identifier that genuinely travels with a batch. `ficheAgrees` still says which matched
 * rows are confirmed by the fiche.
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

/** CHARGEMENT dispatch lines — joined on this receipt's own FICHE directly (WarehouseDispatchLine
 * has no Lot Number column at all to join on), so every row returned here is a real, confirmed
 * match, not a coincidental Lot collision — no `ficheAgrees` flag needed. */
export interface LinkedDispatch {
  id: string;
  chargeDate: string | null;
  warehouseSite: string | null;
  bin: string | null;
  truckNo: string | null;
  totalBags: number | null;
}

/** WarehouseDischarge rows sharing this receipt's Lot Number — the DISCHARGEMENT sheet's own row
 * (the one that assigned the Lot in the first place) plus, when one exists, the central-site
 * "Warehouse Receiving" row for the same Lot number (same table, `@@unique([warehouseSite, lotNo])`
 * — at most one row per site). */
export interface LinkedWarehouseReceiving {
  id: string;
  sn: number;
  warehouseSite: string;
  lotNo: string;
  arrivalDate: string | null;
  totalRecd: number | null;
  ficheAgrees: boolean;
}

/** DryingBatch rows sharing this receipt's Lot Number — the replacement source for drying data
 * (see dryingBatches.ts); kept alongside the legacy `dryingJobs` above rather than merged into it,
 * since drying_batch_vs_drying_job_drift's own finding is exactly that the two disagree.
 * `sourceBinNo`/`destinationBinNo` were added so this row's own bin(s) can join the "Bin observed
 * elsewhere" roll-up alongside `transfers`/`dryingJobs` below — DryingBatch has two distinct bin
 * columns (batch went in from one bin, came out to another), unlike DryingJob's single `bin`. */
export interface LinkedDryingBatchRow {
  id: string;
  sn: number;
  dryingDate: string | null;
  warehouseSite: string | null;
  status: string | null;
  dryType: string | null;
  sourceBinNo: string | null;
  destinationBinNo: string | null;
  destinationRaw: string | null;
  ficheAgrees: boolean;
}

/** IssuedToProduction rows reached via the same idTransfer -> BtmIntake.btmNo hop as `btmIntakes`
 * above — a receipt's production record, one more join past the production bin it landed in. */
export interface LinkedIssuedToProduction {
  id: string;
  btmNo: string;
  date: string | null;
  sourceBin: string | null;
  dryBin: string | null;
  binStatus: string | null;
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
  dispatches: LinkedDispatch[];
  warehouseReceiving: LinkedWarehouseReceiving[];
  dryingBatches: LinkedDryingBatchRow[];
  issuedToProduction: LinkedIssuedToProduction[];
}

/** DATE -> "YYYY-MM-DD"; falls back to the hand-typed original text when the source cell wasn't a
 * real date (11 real transfer rows are like this) — mirrors services/ledgers.ts's RAW_FALLBACK for
 * this exact column, since this is the same underlying data reached a different way. */
function formatReceivedDate(receivedDate: Date | null, rawDate: string | null): string | null {
  if (receivedDate) return receivedDate.toISOString().slice(0, 10);
  return rawDate;
}

/** "matches this Lot, or this Fiche" for one table's own two columns — either key may be absent. */
function byLotOrFiche<L extends string, F extends string>(lotCol: L, lotNo: string | null, ficheCol: F, fiche: string | null) {
  const or = [
    ...(lotNo ? [{ [lotCol]: lotNo } as Record<L, string>] : []),
    ...(fiche ? [{ [ficheCol]: fiche } as Record<F, string>] : []),
  ];
  return { OR: or };
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

  // Fiche-joined, independent of whether a Lot has been assigned yet — a dispatch line can name
  // this receipt's own truck/fiche before any unit-warehouse discharge has run at all.
  const dispatches = fiche
    ? (await prisma.warehouseDispatchLine.findMany({
        where: { ficheCca: fiche },
        select: { id: true, chargeDate: true, chargeDateRaw: true, warehouseSite: true, bin: true, truckNo: true, totalBags: true },
        orderBy: { chargeDate: "asc" },
      })).map((d) => ({
        id: d.id, chargeDate: formatReceivedDate(d.chargeDate, d.chargeDateRaw),
        warehouseSite: d.warehouseSite, bin: d.bin, truckNo: d.truckNo, totalBags: d.totalBags,
      }))
    : [];

  if (!lotNo && !fiche) {
    return {
      lotNo: null, lotWarehouse, fiche, dryingJobs: [], transfers: [], btmIntakes: [],
      dispatches, warehouseReceiving: [], dryingBatches: [], issuedToProduction: [],
    };
  }

  const [dryingRows, transferRows, warehouseReceivingRows, dryingBatchRows] = await Promise.all([
    prisma.dryingJob.findMany({
      where: byLotOrFiche("lotNo", lotNo, "ficheNo", fiche),
      select: { id: true, date: true, warehouse: true, bin: true, lotNo: true, status: true, dryType: true, destination: true, ficheNo: true },
      orderBy: { date: "asc" },
    }),
    prisma.juteWarehouseTransferReceipt.findMany({
      where: byLotOrFiche("lotNo", lotNo, "noFiche", fiche),
      select: {
        sn: true, receivedDate: true, rawDate: true, lotNo: true, binNo: true,
        truckRegistration: true, bagsReceived: true, sourceWarehouse: true, idTransfer: true, noFiche: true,
      },
      orderBy: { sn: "asc" },
    }),
    prisma.warehouseDischarge.findMany({
      where: byLotOrFiche("lotNo", lotNo, "ficheCca", fiche),
      select: { id: true, sn: true, warehouseSite: true, lotNo: true, arrivalDate: true, arrivalDateRaw: true, totalRecd: true, ficheCca: true },
      orderBy: { warehouseSite: "asc" },
    }),
    prisma.dryingBatch.findMany({
      where: byLotOrFiche("lotNo", lotNo, "ficheNoRaw", fiche),
      select: {
        id: true, sn: true, dryingDate: true, dryingDateRaw: true, warehouseSite: true, status: true,
        dryType: true, sourceBinNo: true, destinationBinNo: true, destinationRaw: true, ficheNoRaw: true,
      },
      orderBy: { sn: "asc" },
    }),
  ]);

  // One more hop: idTransfer on a linked transfer is the production BTM number. Several transfers
  // can (rarely) share an idTransfer, so dedupe before the BtmIntake lookup.
  const btmNos = [...new Set(transferRows.map((r) => r.idTransfer?.trim()).filter((v): v is string => !!v))];
  const [btmIntakes, issuedToProductionRows] = await Promise.all([
    btmNos.length
      ? prisma.btmIntake.findMany({ where: { btmNo: { in: btmNos } }, select: { btmNo: true, binNo: true }, orderBy: { btmNo: "asc" } })
      : Promise.resolve([]),
    btmNos.length
      ? prisma.issuedToProduction.findMany({
          where: { btmNo: { in: btmNos } },
          select: { id: true, btmNo: true, date: true, sourceBin: true, dryBin: true, binStatus: true },
        })
      : Promise.resolve([]),
  ]);

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
    dispatches,
    warehouseReceiving: warehouseReceivingRows.map((w) => ({
      id: w.id, sn: w.sn, warehouseSite: w.warehouseSite, lotNo: w.lotNo,
      arrivalDate: formatReceivedDate(w.arrivalDate, w.arrivalDateRaw), totalRecd: w.totalRecd,
      ficheAgrees: ficheAgrees(w.ficheCca),
    })),
    dryingBatches: dryingBatchRows.map((b) => ({
      id: b.id, sn: b.sn, dryingDate: formatReceivedDate(b.dryingDate, b.dryingDateRaw),
      warehouseSite: b.warehouseSite, status: b.status, dryType: b.dryType,
      sourceBinNo: b.sourceBinNo, destinationBinNo: b.destinationBinNo, destinationRaw: b.destinationRaw,
      ficheAgrees: ficheAgrees(b.ficheNoRaw),
    })),
    issuedToProduction: issuedToProductionRows.map((p) => ({
      id: p.id, btmNo: p.btmNo ?? "", date: p.date, sourceBin: p.sourceBin, dryBin: p.dryBin, binStatus: p.binStatus,
    })),
  };
}
