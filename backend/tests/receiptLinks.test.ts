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
    expect(links).toEqual({ fiche: null, dryingJobs: [], transfers: [] });
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
});
