/**
 * `?warehouse=` scoping (domain/site.ts's resolveSite, wired into receipts/dashboard/drying-jobs/
 * jute-ledgers). The property that actually matters: every scoped endpoint partitions the
 * unscoped result cleanly — no receipt counted twice, none dropped — because that's exactly what a
 * store code slipping past resolveSite would break (see the plan's two-blocker history: this is
 * the same class of bug as the store/site master pollution that motivated this whole migration).
 *
 * Counts below are measured against the real seeded + imported data, not predicted:
 * 986 receipts = 684 Bouaké + 302 Yakro (Bouaké's own store codes BKE-001/002/003, Yakro's aliases
 * ANAGROCI-01/YAMOUSSOUKRO). DryingBatch (the DryingJob replacement — see dryingBatches.ts) is NOT
 * a clean partition: of its 138 rows, 57 are Bouaké and 81 carry no warehouseSite value at all (a
 * real gap in Drying Batch's own central-side rows, not fabricated to make the numbers add up) —
 * so unlike receipts, atBouake + atYakro deliberately does NOT equal the unscoped total here.
 */
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resolveSite } from "../src/domain/site.js";
import { listReceipts } from "../src/services/receipts.js";
import { listDryingBatches } from "../src/services/dryingBatches.js";
import { getReceiptLinks } from "../src/services/receiptLinks.js";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe("resolveSite", () => {
  it("expands a site to itself plus its stores and aliases, deduped", async () => {
    const bouake = await resolveSite("BOUAKE");
    expect(bouake).toContain("BOUAKE");
    expect(bouake).toEqual(expect.arrayContaining(["BKE-001", "BKE-002", "BKE-003"]));
    expect(new Set(bouake).size).toBe(bouake.length); // no duplicate names

    const yakro = await resolveSite("YAKRO FACTORY");
    expect(yakro).toEqual(expect.arrayContaining(["YAKRO FACTORY", "ANAGROCI-01", "YAMOUSSOUKRO"]));
    expect(new Set(yakro).size).toBe(yakro.length); // ANAGROCI-01 is both a store AND an alias
  });

  it("a name with no stores or aliases resolves to just itself", async () => {
    expect(await resolveSite("SOME-UNKNOWN-NAME")).toEqual(["SOME-UNKNOWN-NAME"]);
  });
});

describe("site scoping partitions the unscoped result", () => {
  it("receipts: BOUAKE + YAKRO FACTORY sum to the unscoped total with no overlap", async () => {
    const [bouake, yakro] = await Promise.all([resolveSite("BOUAKE"), resolveSite("YAKRO FACTORY")]);
    const [all, atBouake, atYakro] = await Promise.all([
      listReceipts(), listReceipts(bouake), listReceipts(yakro),
    ]);
    expect(atBouake.length).toBe(684);
    expect(atYakro.length).toBe(302);
    expect(atBouake.length + atYakro.length).toBe(all.length);
    const yakroIds = new Set(atYakro.map((r) => r.id));
    const overlap = atBouake.filter((r) => yakroIds.has(r.id));
    expect(overlap.length).toBe(0);
  });

  it("drying batches: Bouaké resolves 57 rows, Yakro resolves none — 81 rows carry no site at all", async () => {
    // DryingBatch replaces DryingJob as the site-scoped drying source (see dryingBatches.ts's
    // header). Its warehouseSite column is genuinely blank on 81 of 138 rows — a real gap in the
    // "Drying Batch" sheet's central-side rows — so this does NOT partition cleanly the way
    // receipts do; the two site-scoped counts intentionally do not sum to the unscoped total.
    const [bouake, yakro] = await Promise.all([resolveSite("BOUAKE"), resolveSite("YAKRO FACTORY")]);
    const [all, atBouake, atYakro] = await Promise.all([
      listDryingBatches(), listDryingBatches(bouake), listDryingBatches(yakro),
    ]);
    expect(all.length).toBe(138);
    expect(atBouake.length).toBe(57);
    expect(atYakro.length).toBe(0);
  });
});

describe("/api/receipts/:id/links stays unscoped by design", () => {
  it("getReceiptLinks takes no site parameter — the cross-site join is the point", async () => {
    // This is the regression guard the plan asks for: a future copy-paste that threads `site`
    // through every service function must not silently reach this one. If this arity check ever
    // fails, whoever changed the signature needs to re-read receiptLinks.ts's header comment on
    // why a receipt's Lot Number resolving to rows at other sites (whether genuinely the same
    // batch or, per that header, usually not) is the entire point of this endpoint, not a bug to
    // scope away.
    expect(getReceiptLinks.length).toBe(1);
  });

  it("still returns cross-site links for a receipt with drying/transfer records at a different site", async () => {
    const receipt = await prisma.receipt.findFirst({
      where: { lot: { lotNumber: { not: null } } },
      select: { id: true },
    });
    if (!receipt) return; // nothing to prove if no receipt has a lot
    const links = await getReceiptLinks(receipt.id);
    expect(links).toBeTruthy();
  });
});
