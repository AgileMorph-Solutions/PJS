/**
 * Issues the system's business IDs (Receipt, Lot, Delivery Plan, Transfer). The formats live in
 * @anagroci/contract's domain/ids.ts; this file only decides the next number.
 *
 * The number is "highest issued so far + 1", scanned inside the caller's transaction — the same
 * approach the old nextReceiptId() used. The primary keys and the per-warehouse partial unique index
 * on Lot are what actually guarantee two concurrent writers can't both win; a collision surfaces as
 * a P2002 (409) rather than a duplicate. Gaps are allowed: a number is never handed out twice.
 */
import { Prisma } from "@prisma/client";
import type { SiteIdKind } from "@anagroci/contract/domain/ids";
import {
  formatDeliveryPlanId, formatLotNumber, formatReceiptId, formatTransferId, legacyLotSeq, legacyTransferSeq, normalizeLotNumber, normalizeTransferId, recodeSiteId,
  parseSiteId, parseTransferId, siteIdPrefix, transferIdPrefix, yearOf,
} from "@anagroci/contract/domain/ids";
import { ValidationError } from "../domain/validation.js";

type Tx = Prisma.TransactionClient;

/**
 * The site a warehouse/store/alias name belongs to: a store (BKE-002) answers its site (BOUAKE), an
 * alias (YAMOUSSOUKRO, ANAGROCI-01) answers the warehouse it names. Undefined when the name isn't in
 * the master at all.
 */
export async function siteOf(tx: Tx, name: string): Promise<string | undefined> {
  const row = await tx.warehouse.findUnique({ where: { name }, select: { name: true, site: true } });
  if (row) return row.site ?? row.name;
  const alias = await tx.warehouseAlias.findUnique({ where: { alias: name }, select: { warehouseName: true } });
  if (!alias) return undefined;
  const target = await tx.warehouse.findUnique({ where: { name: alias.warehouseName }, select: { name: true, site: true } });
  return target ? target.site ?? target.name : undefined;
}

/** The code printed into every ID issued at `warehouse`'s site. Refuses rather than guesses when the master has none. */
export async function warehouseCodeFor(tx: Tx, warehouse: string): Promise<string> {
  const site = await siteOf(tx, warehouse);
  if (!site) throw new ValidationError(`Warehouse "${warehouse}" isn't in the warehouse master.`);
  const row = await tx.warehouse.findUnique({ where: { name: site }, select: { code: true } });
  if (!row?.code) {
    throw new ValidationError(
      `Warehouse "${site}" has no code yet, so no ID can be issued there. An admin sets it in Masters › Warehouses.`
    );
  }
  return row.code;
}

function requireYear(date: string, what: string): number {
  const year = yearOf(date);
  if (year === undefined) throw new ValidationError(`${what} must be a YYYY-MM-DD date to issue an ID (got "${date}").`);
  return year;
}

function highestSeq(values: (string | null)[], parse: (v: string) => number | undefined): number {
  let max = 0;
  for (const v of values) {
    const seq = v ? parse(v) : undefined;
    if (seq !== undefined && seq > max) max = seq;
  }
  return max;
}

/**
 * Highest number issued for one kind and year at a site, under ANY code. A warehouse's code can
 * change (BKE01 → BKE, Oct 2026), and until renumberIds.ts has moved the old IDs, the new prefix
 * alone would show an empty history and hand out a number that renumbering later gives to an old
 * record. So the scan is by the site's own records, matched on kind + year, not on the prefix.
 */
function sameKindYear(kind: SiteIdKind, year: number) {
  return (v: string) => {
    const p = parseSiteId(v);
    return p && p.kind === kind && p.year === year ? p.seq : undefined;
  };
}

async function highestReceiptSeq(tx: Tx, site: string, year: number) {
  const names = await namesOfSite(tx, site);
  const rows = await tx.receipt.findMany({ where: { warehouse: { in: names } }, select: { id: true } });
  return highestSeq(rows.map((r) => r.id), sameKindYear("REC", year));
}

/** Every name a site's records may carry: the site itself, its stores and its aliases (domain/site.ts, but inside the caller's transaction). */
async function namesOfSite(tx: Tx, site: string): Promise<string[]> {
  const [stores, aliases] = await Promise.all([
    tx.warehouse.findMany({ where: { site }, select: { name: true } }),
    tx.warehouseAlias.findMany({ where: { warehouseName: site }, select: { alias: true } }),
  ]);
  return [...new Set([site, ...stores.map((s) => s.name), ...aliases.map((a) => a.alias)])];
}

/**
 * The highest Lot number already in use for one warehouse and year — in the system format AND as a
 * bare legacy integer. Lots are also printed into the imported discharge/receiving rows, and a Lot
 * the workbook assigned must never be issued again. Counting the legacy integers is what makes
 * issuing safe BEFORE scripts/renumberIds.ts has run: otherwise the first Lot issued would be
 * LOT-BKE01-2026-001, the very value the renumber later gives to legacy Lot 1.
 */
async function highestLotSeq(tx: Tx, site: string, prefix: string, year: number) {
  const names = await namesOfSite(tx, site);
  const [assigned, discharged] = await Promise.all([
    tx.stageLotAssignment.findMany({
      where: { OR: [{ lotNumber: { startsWith: prefix } }, { warehouseName: { in: names } }] },
      select: { lotNumber: true, receipt: { select: { arrivalDate: true } } },
    }),
    tx.warehouseDischarge.findMany({
      where: { OR: [{ lotNo: { startsWith: prefix } }, { warehouseSite: { in: names } }] },
      select: { lotNo: true, arrivalDate: true, dischargeDate: true },
    }),
  ]);
  const inYear = (d: Date | string | null | undefined) => yearOf(typeof d === "string" ? d : d?.toISOString()) === year;
  const lotInYear = sameKindYear("LOT", year);
  const seqOf = (lot: string | null | undefined, sameYear: boolean) => {
    if (!lot) return undefined;
    if (lot.startsWith(prefix)) return parseSiteId(lot)?.seq;
    // A system-format lot under a superseded code still holds its number.
    const old = lotInYear(lot);
    if (old !== undefined) return old;
    return sameYear ? legacyLotSeq(lot) : undefined;
  };
  return Math.max(
    0,
    ...assigned.map((a) => seqOf(a.lotNumber, inYear(a.receipt.arrivalDate)) ?? 0),
    ...discharged.map((d) => seqOf(d.lotNo, inYear(d.arrivalDate ?? d.dischargeDate)) ?? 0)
  );
}

async function highestDeliveryPlanSeq(tx: Tx, site: string, year: number) {
  const names = await namesOfSite(tx, site);
  const rows = await tx.deliveryPlan.findMany({ where: { destinationWarehouse: { in: names } }, select: { id: true } });
  return highestSeq(rows.map((r) => r.id), sameKindYear("DP", year));
}

/**
 * New transfers continue after the dispatch sheet's own BKT numbers (highest in 2026: BKT-414), in
 * either form: already converted (BKT-2026-414) or still as the workbook wrote it (BKT-414 / BKT001,
 * counted toward the year of the line's own charge date). Counting the unconverted ones is what makes
 * issuing safe before scripts/renumberIds.ts has run.
 */
async function highestTransferSeq(tx: Tx, year: number) {
  const prefix = transferIdPrefix(year);
  const [requests, lines] = await Promise.all([
    tx.transferRequest.findMany({ where: { id: { startsWith: prefix } }, select: { id: true } }),
    tx.warehouseDispatchLine.findMany({ where: { vyogeNumber: { not: null } }, select: { vyogeNumber: true, chargeDate: true } }),
  ]);
  const fromLines = lines.map((l) => {
    const v = l.vyogeNumber!;
    if (v.startsWith(prefix)) return parseTransferId(v)?.seq ?? 0;
    return yearOf(l.chargeDate?.toISOString()) === year ? legacyTransferSeq(v) ?? 0 : 0;
  });
  return Math.max(0, ...requests.map((r) => parseTransferId(r.id)?.seq ?? 0), ...fromLines);
}

/** A counter for one prefix that a batch writer can draw from repeatedly without rescanning per row. */
export interface IdAllocator {
  next(): string;
}

function allocator(start: number, format: (seq: number) => string): IdAllocator {
  let seq = start;
  return { next: () => format(++seq) };
}

export async function receiptIdAllocator(tx: Tx, warehouse: string, arrivalDate: string): Promise<IdAllocator> {
  const code = await warehouseCodeFor(tx, warehouse);
  const site = (await siteOf(tx, warehouse))!;
  const year = requireYear(arrivalDate, "The arrival date");
  return allocator(await highestReceiptSeq(tx, site, year), (s) => formatReceiptId(code, year, s));
}

export async function nextReceiptId(tx: Tx, warehouse: string, arrivalDate: string): Promise<string> {
  return (await receiptIdAllocator(tx, warehouse, arrivalDate)).next();
}

export async function nextLotNumber(tx: Tx, warehouse: string, arrivalDate: string): Promise<string> {
  const code = await warehouseCodeFor(tx, warehouse);
  const site = (await siteOf(tx, warehouse))!;
  const year = requireYear(arrivalDate, "The arrival date");
  return formatLotNumber(code, year, (await highestLotSeq(tx, site, siteIdPrefix("LOT", code, year), year)) + 1);
}

export async function nextDeliveryPlanId(tx: Tx, warehouse: string, expectedArrivalDate: string): Promise<string> {
  const code = await warehouseCodeFor(tx, warehouse);
  const site = (await siteOf(tx, warehouse))!;
  const year = requireYear(expectedArrivalDate, "The expected arrival date");
  return formatDeliveryPlanId(code, year, (await highestDeliveryPlanSeq(tx, site, year)) + 1);
}

export async function nextTransferId(tx: Tx, transferDate: string): Promise<string> {
  const year = requireYear(transferDate, "The transfer date");
  return formatTransferId(year, (await highestTransferSeq(tx, year)) + 1);
}

// ── Workbook values written before system IDs existed ─────────────────────────────────────────
// The importers and the one-off renumber script both go through these, so a 2026 workbook
// re-uploaded after the renumber produces exactly the values already stored — which is what keeps
// re-upload dedup keys like WarehouseDischarge (warehouseSite, lotNo) working.

export interface NormalizedValue {
  /** The system-format value, or the original when it can't be formatted safely. */
  value: string | null;
  /** Always the original text, so overwriting never loses what the workbook said. */
  raw: string | null;
  /** False when the original was kept: no site, no code for that site, no date, or not a single lot/voyage number. */
  normalized: boolean;
}

/**
 * Formats legacy lot values for many rows, caching each site's code. `site` is the row's own
 * warehouse/site/store/alias; when a sheet has none (the activity ledger), the caller passes the
 * warehouse chosen at upload. `date` is the row's own date — the year printed into the Lot.
 */
export async function lotNormalizer(tx: Tx) {
  const codes = new Map<string, string | null>();
  async function codeOf(name: string): Promise<string | null> {
    if (!codes.has(name)) {
      const site = await siteOf(tx, name);
      const row = site ? await tx.warehouse.findUnique({ where: { name: site }, select: { code: true } }) : null;
      codes.set(name, row?.code ?? null);
    }
    return codes.get(name)!;
  }
  return async (raw: string | null | undefined, site: string | null | undefined, date: string | null | undefined): Promise<NormalizedValue> => {
    const original = raw === null || raw === undefined ? null : String(raw);
    const keep = { value: original, raw: original, normalized: false };
    if (original === null || !original.trim()) return keep;
    const year = yearOf(date);
    const code = site?.trim() ? await codeOf(site.trim()) : null;
    if (parseSiteId(original)?.kind === "LOT") {
      // Already a system lot: keep its number, bring the code up to date when the site has one.
      return { value: (code ? recodeSiteId(original, code) : undefined) ?? original.trim(), raw: original, normalized: true };
    }
    if (!code || year === undefined) return keep;
    const value = normalizeLotNumber(original, code, year);
    return value ? { value, raw: original, normalized: true } : keep;
  };
}

/** The voyage number on a dispatch line, in BKT-<year>-NNN form, keyed to the line's own charge date. */
export function normalizeVoyage(raw: string | null | undefined, chargeDate: string | null | undefined): NormalizedValue {
  const original = raw === null || raw === undefined ? null : String(raw);
  const year = yearOf(chargeDate);
  const value = original && year !== undefined ? normalizeTransferId(original, year) : undefined;
  return value ? { value, raw: original, normalized: true } : { value: original, raw: original, normalized: false };
}
