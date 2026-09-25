/**
 * The Lot-Number-based receipt-to-batch linkage, asserted against the measured reality of the real
 * data (see services/receiptLinks.ts's header for why this join is known to be mostly wrong, and
 * why it was switched to Lot anyway). These counts are not arbitrary: each was measured directly
 * against the live import. If one changes, either the imported data changed or the linkage logic
 * silently regressed — both worth failing over, same convention as dataQuality.test.ts.
 */
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getReceiptLinks } from "../src/services/receiptLinks.js";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe("receipt links (Lot Number cross-reference)", () => {
  it("REC-2026-0025 (Lot 17 at BOUAKE) resolves to a DIFFERENT batch than the FICHE join would", async () => {
    const links = await getReceiptLinks("REC-2026-0025");
    expect(links.lotNo).toBe("17");
    expect(links.lotWarehouse).toBe("BOUAKE");
    expect(links.fiche).toBe("72566");

    // Lot-matching finds transfer SN 13 (also Lot 17) — but its FICHE is 72563, not this receipt's
    // 72566, proving it's a different truck that merely shares the Lot number. This is exactly the
    // failure mode the header comment documents, not a bug in the test.
    expect(links.transfers).toHaveLength(1);
    expect(links.transfers[0]).toMatchObject({ sn: 13, lotNo: "17", binNo: "BIN-03C", ficheAgrees: false });

    // No drying job in the real data carries Lot 17 at all.
    expect(links.dryingJobs).toHaveLength(0);
  });

  it("a receipt with no Lot Number recorded returns nulls/empties, not an error", async () => {
    // Any receipt lacking a unit-warehouse discharge lot behaves the same; find one directly rather
    // than hardcode an id that could be reassigned by a future import.
    const noLot = await prisma.receipt.findFirst({
      where: { OR: [{ lot: null }, { lot: { lotNumber: null } }, { lot: { lotNumber: "" } }] },
      select: { id: true },
    });
    expect(noLot, "expected at least one receipt with no lot in the real data").toBeTruthy();
    const links = await getReceiptLinks(noLot!.id);
    // btmIntakes stays empty for exactly the same reason dryingJobs/transfers are: no lot, nothing
    // to join. fiche can be non-null even with no lot (a receipt can hold a fiche on its own), but
    // this receipt was chosen only for having no lot, so assert the no-lot shape loosely.
    expect(links).toMatchObject({ lotNo: null, dryingJobs: [], transfers: [], btmIntakes: [] });
  });

  it("coverage across all receipts matches what was measured before switching the join to Lot", async () => {
    const receipts = await prisma.receipt.findMany({ select: { id: true } });
    let withTransfer = 0, withDrying = 0, withEither = 0;
    for (const r of receipts) {
      const links = await getReceiptLinks(r.id);
      const hasT = links.transfers.length > 0, hasD = links.dryingJobs.length > 0;
      if (hasT) withTransfer++;
      if (hasD) withDrying++;
      if (hasT || hasD) withEither++;
    }
    expect({ withTransfer, withDrying, withEither }).toEqual({
      withTransfer: 363, withDrying: 38, withEither: 363,
    });
  });

  it("across all Lot-matched rows, almost none are FICHE-confirmed — the tradeoff this join accepts", async () => {
    // Row-level (not receipt-level) counts: a Lot number can match many transfer/drying rows across
    // different receipts, since it isn't unique. Measured directly against the real data; if
    // ficheAgrees's true-count ever climbs close to the total, the underlying data quality (not
    // this test) has changed in a way worth knowing about.
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
      totalTransferRows: 365, confirmedTransferRows: 5, totalDryingRows: 40, confirmedDryingRows: 0,
    });
  });

  it("a linked transfer's date is YYYY-MM-DD, never an ISO timestamp or a raw Decimal", async () => {
    const links = await getReceiptLinks("REC-2026-0025");
    const transfer = links.transfers[0]!;
    expect(transfer.receivedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof transfer.bagsReceived === "number" || transfer.bagsReceived === null).toBe(true);
  });

  it("a linked transfer's idTransfer resolves to a real BtmIntake, once one exists", async () => {
    // Find any real transfer with a non-blank idTransfer AND a lotNo, insert a disposable BtmIntake
    // for that exact number, and confirm getReceiptLinks resolves it for a receipt sharing that
    // same Lot Number — proves the JOIN mechanics, not a measured real count.
    const transfer = await prisma.juteWarehouseTransferReceipt.findFirst({
      where: { idTransfer: { not: null }, lotNo: { not: null } },
      select: { idTransfer: true, lotNo: true },
    });
    expect(transfer?.idTransfer, "expected at least one real transfer with an idTransfer and a lotNo").toBeTruthy();
    const receipt = await prisma.stageLotAssignment.findFirst({
      where: { lotNumber: transfer!.lotNo ?? undefined },
      select: { receiptId: true },
    });
    expect(receipt, "expected a receipt whose own lot matches this transfer's lotNo").toBeTruthy();

    const btmNo = transfer!.idTransfer!.trim();
    const binNo = "TEST-RECEIPTLINKS-BIN";
    await prisma.productionBin.upsert({ where: { binNo }, update: {}, create: { binNo } });
    await prisma.btmIntake.upsert({ where: { btmNo }, update: {}, create: { btmNo, binNo } });
    try {
      const links = await getReceiptLinks(receipt!.receiptId);
      expect(links.btmIntakes.map((b) => b.btmNo)).toContain(btmNo);
    } finally {
      await prisma.btmIntake.deleteMany({ where: { btmNo, binNo } });
      await prisma.productionBin.deleteMany({ where: { binNo } });
    }
  });
});
