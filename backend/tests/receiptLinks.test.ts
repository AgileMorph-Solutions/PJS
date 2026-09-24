/**
 * The FICHE-based receipt-to-batch linkage, asserted against the measured reality of the imported
 * data (see docs/UPLOAD_GUIDE.md and services/receiptLinks.ts's header for why FICHE, not Lot/Bin).
 * These counts are not arbitrary: each was measured directly against the live import. If one
 * changes, either the imported data changed or the linkage logic silently regressed — both worth
 * failing over, same convention as dataQuality.test.ts.
 */
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getReceiptLinks } from "../src/services/receiptLinks.js";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe("receipt links (FICHE cross-reference)", () => {
  it("REC-2026-0025 (fiche 72566) resolves to drying DRY-4 and transfer SN 27, both Lot 20", async () => {
    const links = await getReceiptLinks("REC-2026-0025");
    expect(links.fiche).toBe("72566");

    expect(links.dryingJobs).toHaveLength(1);
    expect(links.dryingJobs[0]).toMatchObject({ id: "DRY-4", lotNo: "20", bin: "BIN-09A", status: "OK" });

    expect(links.transfers).toHaveLength(1);
    expect(links.transfers[0]).toMatchObject({ sn: 27, lotNo: "20", binNo: "BIN-03C" });
    // The two sources independently agreeing on Lot 20 for the same fiche is the proof this link
    // is real, not coincidence — and the bins genuinely differ (received vs. moved-for-drying), so
    // they must never be merged into a single "the bin".
    expect(links.dryingJobs[0]!.lotNo).toBe(links.transfers[0]!.lotNo);
    expect(links.dryingJobs[0]!.bin).not.toBe(links.transfers[0]!.binNo);
  });

  it("a receipt with no FICHE recorded returns nulls/empties, not an error", async () => {
    // Any receipt lacking a verify-stage fiche behaves the same; find one directly rather than
    // hardcode an id that could be reassigned by a future import.
    const noFiche = await prisma.receipt.findFirst({
      where: { OR: [{ verify: null }, { verify: { fiche: null } }, { verify: { fiche: "" } }] },
      select: { id: true },
    });
    expect(noFiche, "expected at least one receipt with no fiche in the real data").toBeTruthy();
    const links = await getReceiptLinks(noFiche!.id);
    // btmIntakes added alongside the production cross-reference (services/receiptLinks.ts) — still
    // empty here for exactly the same reason dryingJobs/transfers are: no fiche, nothing to join.
    expect(links).toEqual({ fiche: null, dryingJobs: [], transfers: [], btmIntakes: [] });
  });

  it("coverage across all receipts matches what was measured before building this", async () => {
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
      withTransfer: 339, withDrying: 47, withEither: 374,
    });
  });

  it("a linked transfer's date is YYYY-MM-DD, never an ISO timestamp or a raw Decimal", async () => {
    const links = await getReceiptLinks("REC-2026-0025");
    const transfer = links.transfers[0]!;
    expect(transfer.receivedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof transfer.bagsReceived === "number" || transfer.bagsReceived === null).toBe(true);
  });

  it("a linked transfer's idTransfer resolves to a real BtmIntake, once one exists", async () => {
    // No production data is seeded yet (the extractor is a later pass — see the plan's "Deferred"
    // section), so this proves the JOIN rather than asserting a measured real count: find any real
    // transfer with a non-blank idTransfer, insert a disposable BtmIntake for that exact number,
    // and confirm getReceiptLinks resolves it. Found dynamically, not hardcoded — same convention
    // the no-fiche test above already uses.
    const transfer = await prisma.juteWarehouseTransferReceipt.findFirst({
      where: { idTransfer: { not: null } },
      select: { idTransfer: true, noFiche: true },
    });
    expect(transfer?.idTransfer, "expected at least one real transfer with an idTransfer").toBeTruthy();
    const receipt = await prisma.stageVerifyDocs.findFirst({
      where: { fiche: transfer!.noFiche ?? undefined },
      select: { receiptId: true },
    });
    expect(receipt, "expected a receipt whose fiche matches this transfer's noFiche").toBeTruthy();

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
