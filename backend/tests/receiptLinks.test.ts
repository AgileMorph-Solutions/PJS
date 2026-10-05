/**
 * The receipt-to-batch linkage, asserted against the measured reality of the real data (see
 * services/receiptLinks.ts's header). These counts are not arbitrary: each was measured directly
 * against the live import. If one changes, either the imported data changed or the linkage logic
 * silently regressed — both worth failing over, same convention as dataQuality.test.ts.
 *
 * Re-measured after the Oct 2026 renumber, which changed the join: a Lot now carries its warehouse's
 * code, so an exact Lot match can't pair one warehouse's "17" with another's. Before, ~410 receipts
 * linked to a transfer and only 5 of those links were confirmed by the fiche — the rest were Lot
 * collisions. Now a receipt links on its exact Lot OR its fiche, and every link found is confirmed.
 */
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getReceiptLinks } from "../src/services/receiptLinks.js";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

/** The receipt that was REC-2026-0025 before the renumber — found by its legacy id, which is exactly what legacyId is for. */
const renumbered = async (legacyId: string) => (await prisma.receipt.findUniqueOrThrow({ where: { legacyId }, select: { id: true } })).id;

describe("receipt links (Lot or Fiche cross-reference)", () => {
  it("REC-2026-0025 (Lot 20 at BOUAKE) links to ITS OWN transfer by fiche, not the Lot-20 one", async () => {
    const links = await getReceiptLinks(await renumbered("REC-2026-0025"));
    expect(links.lotNo).toBe("LOT-BKE01-2026-020");
    expect(links.lotWarehouse).toBe("BOUAKE");
    expect(links.fiche).toBe("72520");

    // Transfer SN 27 is also "Lot 20" — but at the receiving warehouse, and its fiche disagrees: a
    // different truck. The old Lot join paired them. Now only the transfer carrying this truck's own
    // fiche (SN 24) is linked, and it is confirmed.
    expect(links.transfers).toHaveLength(1);
    expect(links.transfers[0]).toMatchObject({ sn: 24, binNo: "BIN-02B", ficheAgrees: true });
    expect(links.transfers.some((t) => t.sn === 27)).toBe(false);

    // No drying job exists in the DB at all any more — DryingBatch is the replacement source for
    // drying data (see services/dryingBatches.ts), and prisma/seed.ts no longer seeds DryingJob.
    expect(links.dryingJobs).toHaveLength(0);
  });

  it("a receipt with no Lot and no Fiche returns nulls/empties, not an error", async () => {
    // A throwaway receipt: nothing to join on, whatever the real data holds.
    const id = "REC-LINKS-TEST-EMPTY";
    await prisma.receipt.deleteMany({ where: { id } });
    await prisma.receipt.create({ data: { id, source: "entered", arrivalDate: "2026-01-01", supplierName: "", lbaCode: "", vehicleNo: "", warehouse: "BOUAKE" } });
    try {
      const links = await getReceiptLinks(id);
      expect(links).toMatchObject({ lotNo: null, fiche: null, dryingJobs: [], transfers: [], btmIntakes: [], warehouseReceiving: [], dryingBatches: [] });
    } finally {
      await prisma.receipt.deleteMany({ where: { id } });
    }
  });

  it("a receipt with a Fiche but no Lot is still linked by that Fiche", async () => {
    // Yakro's receipts never had a Lot assigned, yet their fiche is on the central receiving rows.
    const receipt = await prisma.receipt.findFirst({
      where: { lot: null, warehouse: "YAKRO FACTORY", verify: { fiche: { not: null } } },
      select: { id: true, verify: { select: { fiche: true } } },
    });
    expect(receipt, "expected a Yakro receipt with a fiche and no lot").toBeTruthy();
    const links = await getReceiptLinks(receipt!.id);
    expect(links.lotNo).toBeNull();
    expect(links.fiche).toBe(receipt!.verify!.fiche!.trim());
  });

  it("coverage across all receipts after the renumber", async () => {
    const receipts = await prisma.receipt.findMany({ select: { id: true } });
    let withTransfer = 0, withDrying = 0, withEither = 0;
    for (const r of receipts) {
      const links = await getReceiptLinks(r.id);
      const hasT = links.transfers.length > 0, hasD = links.dryingJobs.length > 0;
      if (hasT) withTransfer++;
      if (hasD) withDrying++;
      if (hasT || hasD) withEither++;
    }
    // withDrying is 0 because DryingJob is no longer seeded (DryingBatch is the replacement source).
    expect({ withTransfer, withDrying, withEither }).toEqual({
      withTransfer: 366, withDrying: 0, withEither: 366,
    });
  });

  it("every linked transfer row is confirmed by the fiche — the coincidental Lot matches are gone", async () => {
    // Row-level counts. Before the renumber 412 transfer rows were Lot-matched and only 5 confirmed.
    const receipts = await prisma.receipt.findMany({ select: { id: true } });
    let totalTransferRows = 0, confirmedTransferRows = 0, totalDryingRows = 0, confirmedDryingRows = 0;
    for (const r of receipts) {
      const links = await getReceiptLinks(r.id);
      totalTransferRows += links.transfers.length;
      confirmedTransferRows += links.transfers.filter((t) => t.ficheAgrees).length;
      totalDryingRows += links.dryingJobs.length;
      confirmedDryingRows += links.dryingJobs.filter((d) => d.ficheAgrees).length;
    }
    expect({ totalTransferRows, confirmedTransferRows, totalDryingRows, confirmedDryingRows }).toEqual({
      totalTransferRows: 369, confirmedTransferRows: 369, totalDryingRows: 0, confirmedDryingRows: 0,
    });
  });

  it("a linked transfer's date is YYYY-MM-DD, never an ISO timestamp or a raw Decimal", async () => {
    const links = await getReceiptLinks(await renumbered("REC-2026-0025"));
    const transfer = links.transfers[0]!;
    expect(transfer.receivedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof transfer.bagsReceived === "number" || transfer.bagsReceived === null).toBe(true);
  });

  it("a linked transfer's idTransfer resolves to a real BtmIntake, once one exists", async () => {
    // Find any real transfer with a non-blank idTransfer AND a fiche that a receipt carries, insert a
    // disposable BtmIntake for that exact number, and confirm getReceiptLinks resolves it for that
    // receipt — proves the JOIN mechanics, not a measured real count.
    const transfers = await prisma.juteWarehouseTransferReceipt.findMany({
      where: { idTransfer: { not: null }, noFiche: { not: null } },
      select: { idTransfer: true, noFiche: true },
    });
    let hit: { btmNo: string; receiptId: string } | undefined;
    for (const t of transfers) {
      const v = await prisma.stageVerifyDocs.findFirst({ where: { fiche: t.noFiche!.trim() }, select: { receiptId: true } });
      if (v) { hit = { btmNo: t.idTransfer!.trim(), receiptId: v.receiptId }; break; }
    }
    expect(hit, "expected a real transfer whose fiche a receipt carries").toBeTruthy();

    const btmNo = hit!.btmNo;
    const binNo = "TEST-RECEIPTLINKS-BIN";
    await prisma.productionBin.upsert({ where: { binNo }, update: {}, create: { binNo } });
    await prisma.btmIntake.upsert({ where: { btmNo }, update: {}, create: { btmNo, binNo } });
    try {
      const links = await getReceiptLinks(hit!.receiptId);
      expect(links.btmIntakes.map((b) => b.btmNo)).toContain(btmNo);
    } finally {
      await prisma.btmIntake.deleteMany({ where: { btmNo, binNo } });
      await prisma.productionBin.deleteMany({ where: { binNo } });
    }
  });
});
