/**
 * Warehouse activity Ledger. The 787 rows from the client's workbook are read-only and carry no site (verified when building the
 * importer, not assumed), so the list is the same flat one for both sections. Activities recorded in the app are new rows beside
 * them: they carry the warehouse, the Lot and the place, and are classified (contract data/warehouseActivities.ts).
 */
import { ACTIVITY_CATEGORIES, activityProblems, type ActivityEntryInput } from "@anagroci/contract/data/warehouseActivities";
import { prisma } from "../db.js";
import { ValidationError } from "../domain/validation.js";

export async function listWarehouseActivityLedger() {
  return prisma.warehouseActivityLedgerEntry.findMany({ orderBy: [{ sheetRow: "asc" }, { createdAt: "asc" }] });
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const dec = (v: unknown) => (text(String(v ?? "")) === null ? null : Number(String(v).replace(/\s/g, "").replace(",", ".")));

/**
 * Records an activity done at `warehouse`. The same rules the form shows (contract activityProblems), plus what only the database
 * knows: the Lot has to be a Lot at this warehouse, and a place has to be one of its stores or a known Bin.
 */
export async function createActivityEntry(input: ActivityEntryInput, warehouse: string, actorId: string) {
  const problems = activityProblems(input);
  if (problems.length) throw new ValidationError(problems.join(" "));
  const category = ACTIVITY_CATEGORIES.find((c) => c.id === input.category)!;
  const date = text(input.date) ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) throw new ValidationError("The date must be a real date, YYYY-MM-DD.");

  return prisma.$transaction(async (tx) => {
    let lotNo: string | null = null;
    let ficheNo: string | null = null;
    if (text(input.lotNo)) {
      const lot = await tx.stageLotAssignment.findFirst({ where: { lotNumber: input.lotNo!.trim(), warehouseName: warehouse }, select: { receiptId: true, lotNumber: true } });
      if (!lot) throw new ValidationError(`Lot ${input.lotNo} isn't a Lot at ${warehouse}.`);
      lotNo = lot.lotNumber;
      ficheNo = (await tx.stageVerifyDocs.findUnique({ where: { receiptId: lot.receiptId }, select: { fiche: true } }))?.fiche ?? null;
    }
    for (const place of [text(input.locationFrom), text(input.locationTo)]) {
      if (!place) continue;
      const known = (await tx.warehouse.findFirst({ where: { name: place, site: warehouse }, select: { name: true } })) ?? (await tx.bin.findUnique({ where: { code: place }, select: { code: true } }));
      if (!known) throw new ValidationError(`"${place}" isn't a store of ${warehouse} or a Bin in the Bin master.`);
    }
    const from = text(input.locationFrom);
    const to = text(input.locationTo);
    return tx.warehouseActivityLedgerEntry.create({
      data: {
        activityDate: new Date(`${date}T00:00:00Z`), activityDateRaw: date,
        activityType: category.label, particulars: to ? `${from} → ${to}` : from,
        bags: text(String(input.bags ?? "")), lotNo, ficheNo, remarks: text(input.remarks),
        warehouse, locationFrom: from, locationTo: to,
        moisturePct: category.needsQuality ? dec(input.moisturePct) : null,
        quantityBeforeKg: category.needsQuality ? dec(input.quantityBeforeKg) : null,
        quantityAfterKg: category.needsQuality ? dec(input.quantityAfterKg) : null,
        source: "entered", createdById: actorId,
      },
    });
  });
}
