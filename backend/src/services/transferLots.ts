/**
 * Transfer lots (24 Nov 2026): what a Unit warehouse sends to the Central one. A Bin holds hundreds of tonnes, so bags are
 * taken out of one or more of the warehouse's Bins, then weighed together; the lot goes on one or more trucks (BKTs,
 * services/transfers.ts) and arrives at the Central warehouse as a lot of its own there.
 *
 * Stored: the Bins and bags, the scale's weight and the quality. Worked out (contract domain/transferLot.ts), never stored:
 * the net, each Bin's share of it, what is left to load, and where the lot stands. The Bins' stock goes down by their shares
 * once the lot is weighed (services/binStock.ts), since only then is the kg known.
 *
 * What can't be right is refused with the same checks the forms show (lotBinsProblems, lotWeighingProblems). A lot already on
 * a truck is what the truck's weight and the Bins' stock were worked out from: the Warehouse Incharge can't change it any
 * more, an Admin or the Incharge can (25–26 Nov 2026: they correct any record once created, contract canCorrectRecords) — its total bags stay what was weighed, and
 * a new weighing is carried to the truck lines that took the lot's quality. Nobody deletes it while it is on a truck.
 */
import { Prisma } from "@prisma/client";
import {
  lotBinsProblems, lotLeft, lotNetKg, lotWeighingProblems, normalizeLotNo, pieceNetKg, putBackProblems, readNumber, shareByBags, transferLotStatus,
  type FieldProblem,
} from "@anagroci/contract/domain/transferLot";
import { yearOf } from "@anagroci/contract/domain/ids";
import type { TransferLot, TransferStatus } from "@anagroci/contract/types/receipt";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";
import { resolveSite } from "../domain/site.js";
import { canCorrectRecords } from "@anagroci/contract/data/roles";
import { lotNumberAllocator, lotNumberInUse, siteOf, siteTypeOf } from "./ids.js";
import type { WriteOpts } from "./receipts.js";

type Tx = Prisma.TransactionClient;

export interface TransferLotInput {
  warehouse?: string;
  lotDate?: string;
  /** Blank: the next of the warehouse's Lot numbers is issued. */
  lotNo?: string | null;
  remarks?: string | null;
  bins?: { binCode?: string | null; bags?: number | string | null }[];
}

/** What the scale read once the lot's bags were weighed, and the lot's quality: all four together. */
export interface TransferLotWeighingInput {
  grossWeightKg?: number | string | null;
  moisture?: number | string | null;
  kor?: number | string | null;
  nutCount?: number | string | null;
}

const INCLUDE = {
  bins: { orderBy: { id: "asc" } },
  creator: { select: { displayName: true } },
  lines: { orderBy: { id: "asc" }, select: { bags: true, netWeightKg: true, transferId: true, transfer: { select: { status: true } } } },
  returns: { orderBy: { id: "asc" }, include: { creator: { select: { displayName: true } } } },
} as const;

type Row = Prisma.TransferLotGetPayload<{ include: typeof INCLUDE }>;

// A missing value is "none", never NaN: undefined (a column an older database client doesn't know, 26 Nov 2026) once read as
// NaN and made a Bin's whole stock NaN, which the Transfers page couldn't show.
const num = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function toWire(r: Row): TransferLot {
  const bags = r.bins.reduce((a, b) => a + b.bags, 0);
  const grossWeightKg = num(r.grossWeightKg);
  const netKg = lotNetKg(grossWeightKg, bags);
  const shares = shareByBags(netKg, r.bins.map((b) => b.bags));
  const pieces = r.lines.map((l) => ({ transferId: l.transferId, bags: l.bags ?? 0, netKg: num(l.netWeightKg) ?? pieceNetKg(netKg, bags, l.bags ?? 0), status: l.transfer.status as TransferStatus }));
  // The weight put back as weighed; a put-back from before that was asked for gives back its share by bags.
  const returns = r.returns.map((x) => ({ id: x.id, binCode: x.binCode, bags: x.bags, netKg: num(x.netWeightKg) ?? pieceNetKg(netKg, bags, x.bags), date: x.returnDate, by: x.creator?.displayName ?? null }));
  const left = lotLeft(bags, netKg, pieces, returns);
  return {
    id: r.id,
    lotNo: r.lotNo,
    warehouse: r.warehouse,
    lotDate: r.lotDate,
    remarks: r.remarks,
    bins: r.bins.map((b, i) => ({ binCode: b.binCode, bags: b.bags, netKg: shares[i] ?? null })),
    bags,
    grossWeightKg,
    netKg,
    moisture: num(r.moisture),
    kor: num(r.kor),
    nutCount: r.nutCount,
    pieces,
    returns,
    ...left,
    status: transferLotStatus(grossWeightKg !== null, left.leftBags, pieces.length, returns.length, r.moisture !== null && r.kor !== null && r.nutCount !== null),
    createdAt: r.createdAt.toISOString(),
    createdBy: r.creator?.displayName ?? null,
  };
}

/** The lots made at these warehouse names (a resolved site, domain/site.ts), newest first. */
export async function listTransferLots(names: readonly string[]): Promise<TransferLot[]> {
  const rows = await prisma.transferLot.findMany({ where: { warehouse: { in: [...names] } }, include: INCLUDE, orderBy: { id: "desc" } });
  return rows.map(toWire);
}

export async function getTransferLot(id: number): Promise<TransferLot | null> {
  const row = await prisma.transferLot.findUnique({ where: { id }, include: INCLUDE });
  return row ? toWire(row) : null;
}

/** Field names as the person reads them, for a refusal that says which box is wrong. */
const LABELS: Record<string, string> = {
  lotNo: "Lot number", lotDate: "Date", bins: "Bins", grossWeightKg: "Weight on the scale", moisture: "Moisture", kor: "KOR", nutCount: "Nut count",
};

/** Refuses with every hard problem, each named by its box; soft ones never stop a save. */
export function refuseHard(problems: Record<string, FieldProblem>, label: (key: string) => string) {
  const bad = Object.entries(problems).filter(([, p]) => !p.soft);
  if (bad.length) throw new ValidationError(bad.map(([k, p]) => `${label(k)}: ${p.message}`).join(" "));
}

/**
 * The Bins of a lot, read and checked: each a Bin of the lot's warehouse in Masters › Bins, once, with a whole number of bags.
 * `bin.<i>` / `bags.<i>` problems are named by the Bin they are about.
 */
async function checkedBins(names: readonly string[], lotNo: string, lotDate: string, bins: TransferLotInput["bins"]) {
  const draft = { lotNo, lotDate, bins: (Array.isArray(bins) ? bins : []).map((b) => ({ binCode: str(b?.binCode), bags: str(b?.bags) })) };
  refuseHard(lotBinsProblems(draft), (k) => {
    const [field, i] = k.split(".");
    const code = draft.bins[Number(i)]?.binCode.trim().toUpperCase();
    return field === "bags" ? `Bags${code ? ` from ${code}` : ""}` : field === "bin" ? `Bin ${Number(i) + 1}` : LABELS[k] ?? k;
  });
  const codes = draft.bins.map((b) => b.binCode.trim().toUpperCase());
  const master = await prisma.bin.findMany({ where: { code: { in: codes } }, select: { code: true, warehouseName: true } });
  for (const code of codes) {
    const bin = master.find((b) => b.code === code);
    if (!bin) throw new ValidationError(`Bin "${code}" isn't in the Bin master — add it in Masters › Bins first.`);
    if (!bin.warehouseName || !names.includes(bin.warehouseName)) throw new ValidationError(`Bin ${code} isn't a Bin of this warehouse.`);
  }
  return draft.bins.map((b, i) => ({ binCode: codes[i]!, bags: readNumber(b.bags)! }));
}

/** The lot's warehouse: a Unit site in the master, since lots are only ever sent from a Unit warehouse to a Central one. */
async function unitSite(tx: Tx, warehouse: string | undefined): Promise<string> {
  const name = warehouse?.trim();
  if (!name) throw new ValidationError("Say which warehouse the lot is made at.");
  const site = await siteOf(tx, name);
  if (!site) throw new ValidationError(`Warehouse "${name}" isn't in the warehouse master.`);
  if ((await siteTypeOf(tx, site)) !== "UNIT") throw new ValidationError("Lots to send are made at a Unit warehouse: RCN only moves from a Unit warehouse to a Central one.");
  return site;
}

async function assertLotNoFree(tx: Tx, warehouse: string, lotNo: string, transferLotId?: number) {
  const where = await lotNumberInUse(tx, warehouse, lotNo, { transferLotId });
  if (where) throw new ValidationError(`Lot number ${lotNo} is already ${where} at ${warehouse}. Use another number.`);
}

/** Make a lot out of the warehouse's Bins. The weight comes after, once the bags are weighed (weighTransferLot). */
export async function createTransferLot(input: TransferLotInput, opts: WriteOpts = {}): Promise<TransferLot> {
  const lotDate = str(input.lotDate).trim();
  if (yearOf(lotDate) === undefined) throw new ValidationError("Date: Enter the date (YYYY-MM-DD).");
  const row = await prisma.$transaction(async (tx) => {
    const site = await unitSite(tx, input.warehouse);
    const names = await resolveSite(site);
    const lotNo = normalizeLotNo(input.lotNo) || (await lotNumberAllocator(tx, site, lotDate)).next();
    const bins = await checkedBins(names, lotNo, lotDate, input.bins);
    await assertLotNoFree(tx, site, lotNo);
    const created = await tx.transferLot.create({
      data: { lotNo, warehouse: site, lotDate, remarks: str(input.remarks).trim() || null, createdBy: opts.actor?.id ?? null, bins: { create: bins } },
    });
    return tx.transferLot.findUniqueOrThrow({ where: { id: created.id }, include: INCLUDE });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return toWire(row);
}

/**
 * A lot already on a truck is what the truck's weight and the Bins' stock were worked out from: only an Admin or the Incharge changes it then
 * (`adminMay`), and nobody deletes it. `loaded` says whether it is on a truck.
 */
async function editableLot(tx: Tx, id: number, opts: WriteOpts = {}, adminMay = true) {
  const lot = await tx.transferLot.findUnique({ where: { id }, include: { lines: { select: { id: true, transferId: true, bags: true, moisture: true, kor: true, nutCount: true } }, bins: true, returns: { select: { bags: true, binCode: true } } } });
  if (!lot) throw Object.assign(new Error("Transfer lot not found"), { code: "P2025" });
  // Bags put back took their share of the lot's weighing back into a Bin: a lot with any put back is changed like one on a
  // truck (the total stays), and deleted by nobody — deleting it would give its Bins back the bags already put back.
  if (lot.returns.length && !lot.lines.length && !(adminMay && canCorrectRecords(opts.actor?.role))) {
    const put = lot.returns.reduce((a, r) => a + r.bags, 0);
    throw new ValidationError(adminMay
      ? `${put} bags of Lot ${lot.lotNo} were put back in a Bin, so only the Warehouse Incharge or an Admin can change it now.`
      : `${put} bags of Lot ${lot.lotNo} were put back in a Bin, so it can't be deleted. The Warehouse Incharge or an Admin can undo the put-back first.`);
  }
  if (lot.lines.length && !(adminMay && canCorrectRecords(opts.actor?.role))) {
    const on = [...new Set(lot.lines.map((l) => l.transferId))].join(", ");
    throw new ValidationError(adminMay
      ? `Lot ${lot.lotNo} is already on ${on}, so only the Warehouse Incharge or an Admin can change it now. Or remove it from the truck first.`
      : `Lot ${lot.lotNo} is on ${on}, so it can't be deleted. Remove it from the truck first.`);
  }
  return { ...lot, loaded: lot.lines.length > 0 || lot.returns.length > 0 };
}

/** Change the Lot number, date, remarks or Bins of a lot not on a truck yet. Changing the Bins keeps its weighing only if the bags are unchanged. */
export async function updateTransferLot(id: number, input: TransferLotInput, opts: WriteOpts = {}): Promise<TransferLot> {
  const row = await prisma.$transaction(async (tx) => {
    const lot = await editableLot(tx, id, opts);
    const names = await resolveSite(lot.warehouse);
    const lotNo = input.lotNo === undefined ? lot.lotNo : normalizeLotNo(input.lotNo);
    const lotDate = input.lotDate === undefined ? lot.lotDate : str(input.lotDate).trim();
    if (yearOf(lotDate) === undefined) throw new ValidationError("Date: Enter the date (YYYY-MM-DD).");
    const bins = await checkedBins(names, lotNo, lotDate, input.bins ?? lot.bins);
    if (lotNo !== lot.lotNo) await assertLotNoFree(tx, lot.warehouse, lotNo, id);
    const was = lot.bins.reduce((a, b) => a + b.bags, 0);
    const sameBags = bins.reduce((a, b) => a + b.bags, 0) === was;
    // On a truck, its weighing is of exactly these bags and the truck's net was shared from it: the Bins may be corrected,
    // the total stays (an Admin takes bags off the truck first to change it).
    if (lot.loaded && !sameBags) {
      throw new ValidationError(lot.lines.length
        ? `Lot ${lot.lotNo} is on a truck and was weighed as ${was} bags: keep the total at ${was} when correcting its Bins, or take bags off the truck first.`
        : `Some bags of Lot ${lot.lotNo} were put back in a Bin, and it was weighed as ${was} bags: keep the total at ${was} when correcting its Bins, or undo the put-back first.`);
    }
    await tx.transferLotBin.deleteMany({ where: { lotId: id } });
    await tx.transferLot.update({
      where: { id },
      data: {
        lotNo, lotDate, remarks: input.remarks === undefined ? lot.remarks : str(input.remarks).trim() || null,
        bins: { create: bins },
        // The weight was of the bags that were taken: different bags need weighing again.
        ...(sameBags ? {} : { grossWeightKg: null, weighedAt: null, weighedBy: null }),
      },
    });
    return tx.transferLot.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return toWire(row);
}

/**
 * Record what the scale read for the lot's bags, and its moisture, KOR and nut count. The quality may be left blank for the QFS
 * Officer (setTransferLotQuality); a blank one keeps what was already recorded. Ready to load once both are there.
 */
export async function weighTransferLot(id: number, input: TransferLotWeighingInput, opts: WriteOpts = {}): Promise<TransferLot> {
  const row = await prisma.$transaction(async (tx) => {
    const lot = await editableLot(tx, id, opts);
    const draft = { grossWeightKg: str(input.grossWeightKg), moisture: str(input.moisture), kor: str(input.kor), nutCount: str(input.nutCount) };
    refuseHard(lotWeighingProblems(draft, lot.bins.reduce((a, b) => a + b.bags, 0)), (k) => LABELS[k] ?? k);
    const dec = (v: string) => new Prisma.Decimal(readNumber(v)!);
    const quality = draft.moisture.trim() !== "";
    await tx.transferLot.update({
      where: { id },
      data: {
        grossWeightKg: dec(draft.grossWeightKg),
        ...(quality ? { moisture: dec(draft.moisture), kor: dec(draft.kor), nutCount: readNumber(draft.nutCount) } : {}),
        weighedAt: new Date(), weighedBy: opts.actor?.id ?? null,
      },
    });
    // On a truck (an Admin's correction): its lines' net follows the weighing by itself (worked out, never stored), and a
    // line that left with the lot's quality — still holding the old value — takes the new one. One re-measured at dispatch keeps its own.
    if (lot.loaded && quality) {
      const same = (a: Prisma.Decimal | number | null, b: Prisma.Decimal | number | null) => a !== null && b !== null && Number(a) === Number(b);
      for (const l of lot.lines) {
        const follow = {
          ...(same(l.moisture, lot.moisture) ? { moisture: dec(draft.moisture) } : {}),
          ...(same(l.kor, lot.kor) ? { kor: dec(draft.kor) } : {}),
          ...(same(l.nutCount, lot.nutCount) ? { nutCount: readNumber(draft.nutCount) } : {}),
        };
        if (Object.keys(follow).length) await tx.transferRequestLine.update({ where: { id: l.id }, data: follow });
      }
    }
    return tx.transferLot.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return toWire(row);
}

/** A lot made by mistake, not on any truck: its bags go back to their Bins (their stock is worked out, so nothing else changes). */
export async function deleteTransferLot(id: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const lot = await editableLot(tx, id, {}, false);
    if (lot.returns.length) throw new ValidationError(`Some bags of Lot ${lot.lotNo} were put back in a Bin, so it can't be deleted. The Warehouse Incharge or an Admin can undo the put-back first.`);
    await tx.transferLot.delete({ where: { id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export interface PutBackInput {
  binCode?: string | null;
  bags?: number | string | null;
  /** The day the bags went back in. Blank: today. */
  date?: string | null;
  /** What the bags put back weighed (kg net): what the Bin gets back. */
  netWeightKg?: number | string | null;
}

/**
 * Puts bags of a lot back in a Bin instead of on a truck (26 Nov 2026, user: "half lot is still there and I want to put it
 * back"). Only bags not on a truck nor already put back, of a weighed lot, into a Bin of the lot's warehouse. The Bin's stock
 * goes up by the weight put back, as weighed (contract binLotMovements); what is left to load goes down by the bags.
 */
export async function putBackTransferLot(id: number, input: PutBackInput, opts: WriteOpts = {}): Promise<TransferLot> {
  const today = new Date().toISOString().slice(0, 10);
  const row = await prisma.$transaction(async (tx) => {
    const lot = await tx.transferLot.findUnique({ where: { id }, include: INCLUDE });
    if (!lot) throw Object.assign(new Error("Transfer lot not found"), { code: "P2025" });
    const wire = toWire(lot);
    const draft = { binCode: str(input.binCode).trim().toUpperCase(), bags: str(input.bags), date: str(input.date).trim() || today, netKg: str(input.netWeightKg) };
    refuseHard(putBackProblems(draft, { weighed: wire.netKg !== null, leftBags: wire.leftBags, netKg: wire.netKg, bags: wire.bags, pieces: wire.pieces, returns: wire.returns }, today), (k) => PUT_BACK_LABELS[k] ?? k);
    const bin = await tx.bin.findUnique({ where: { code: draft.binCode }, select: { warehouseName: true } });
    if (!bin) throw new ValidationError(`Bin "${draft.binCode}" isn't in the Bin master — add it in Masters › Bins first.`);
    if (!bin.warehouseName || !(await resolveSite(lot.warehouse)).includes(bin.warehouseName)) {
      throw new ValidationError(`Bin ${draft.binCode} isn't a Bin of ${lot.warehouse}. Put the bags back in one of its own Bins.`);
    }
    await tx.transferLotReturn.create({ data: { lotId: id, binCode: draft.binCode, bags: readNumber(draft.bags)!, netWeightKg: new Prisma.Decimal(readNumber(draft.netKg)!), returnDate: draft.date, createdBy: opts.actor?.id ?? null } });
    return tx.transferLot.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return toWire(row);
}

const PUT_BACK_LABELS: Record<string, string> = { binCode: "Bin", bags: "Bags", date: "Date", netKg: "Weight put back" };

/**
 * Undoes a put-back made by mistake: an Admin's (25 Nov 2026: an Admin corrects any record once created). The bags are the
 * lot's to load again, and the Bin's stock goes back down by their share. The change log keeps who did it.
 */
export async function undoPutBack(lotId: number, returnId: number, opts: WriteOpts = {}): Promise<TransferLot> {
  if (!canCorrectRecords(opts.actor?.role)) throw new ValidationError("Only the Warehouse Incharge or an Admin can undo a put-back.");
  const row = await prisma.$transaction(async (tx) => {
    const ret = await tx.transferLotReturn.findUnique({ where: { id: returnId } });
    if (!ret || ret.lotId !== lotId) throw Object.assign(new Error("Put-back not found"), { code: "P2025" });
    await tx.transferLotReturn.delete({ where: { id: returnId } });
    return tx.transferLot.findUniqueOrThrow({ where: { id: lotId }, include: INCLUDE });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return toWire(row);
}

/**
 * The next Lot numbers at a warehouse, for a form to show before saving (a lot to make, or each lot on an arriving truck).
 * Nothing is reserved: the number is issued again on save, so two people at once can't both keep it.
 */
export async function previewLotNumbers(warehouse: string, date: string, count: number): Promise<string[]> {
  if (yearOf(date) === undefined) throw new ValidationError("Enter the date (YYYY-MM-DD).");
  const n = Math.min(Math.max(Math.trunc(count) || 1, 1), 50);
  return prisma.$transaction(async (tx) => {
    const next = await lotNumberAllocator(tx, warehouse, date);
    return Array.from({ length: n }, () => next.next());
  });
}

/**
 * A transfer lot's moisture, KOR and nut count, recorded after it was weighed (26 Nov 2026): the QFS Officer's reading, written
 * on the Incharge's approval. Only on a lot with no quality yet — one already recorded is the Incharge's to change (Record
 * weight), never overwritten by a form.
 */
export async function setTransferLotQuality(tx: Tx, id: number, values: { moisture?: string; kor?: string; nutCount?: string }) {
  const lot = await tx.transferLot.findUnique({ where: { id }, select: { lotNo: true, moisture: true, kor: true, nutCount: true } });
  if (!lot) throw Object.assign(new Error("Transfer lot not found"), { code: "P2025" });
  if (lot.moisture !== null || lot.kor !== null || lot.nutCount !== null) {
    throw new ValidationError(`Lot ${lot.lotNo}'s quality is already recorded. The Warehouse Incharge changes it with "Change weight".`);
  }
  const dec = (v: string | undefined) => new Prisma.Decimal(readNumber(v)!);
  await tx.transferLot.update({ where: { id }, data: { moisture: dec(values.moisture), kor: dec(values.kor), nutCount: readNumber(values.nutCount) } });
}
