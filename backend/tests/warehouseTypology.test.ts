/**
 * Warehouse.kind (site typology) / Warehouse.site (self-relation to a parent site) — the two
 * columns the two-section frontend and domain/site.ts's resolveSite() both depend on. This test
 * proves the structural invariants against the REAL measured data rather than an assumption — 7
 * real Warehouse rows exist today.
 *
 * One of them, "YAMOUSSOUKRO", is a genuine leftover artifact, not a bug in this test: it exists
 * only because ANAGROCI-01.site pointed at it once (the self-relation FK requires the target row
 * to exist) when a real Warehouse Receiving upload stored that sheet's own site value verbatim
 * (services/imports.ts's upsertObservedStores) — a row created that way is never deleted even
 * after ANAGROCI-01.site later changes, so it stays behind as a real but harmless orphan. See
 * dataQuality.test.ts's store_site_not_canonical comment for the fuller story: ANAGROCI-01.site
 * itself currently OSCILLATES between this alias and the canonical "YAKRO FACTORY" depending on
 * whether prisma/seed.ts's backfill or a real upload ran most recently — a genuine bug, not in
 * scope to fix here, which is exactly why this test only asserts the structural invariant (no
 * *new* orphan besides this one), not which value ANAGROCI-01.site holds today.
 */
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describe("warehouse typology", () => {
  it("every row is a site (has a kind), a store (has a site), or the one known leftover orphan", async () => {
    const rows = await prisma.warehouse.findMany({ select: { name: true, kind: true, site: true } });
    const neither = rows.filter((w) => !w.kind && !w.site);
    // A second name appearing here would be a NEW, unexplained orphan and should fail this test.
    expect(neither.map((w) => w.name)).toEqual(["YAMOUSSOUKRO"]);
  });

  it("no cycles: a store's site never itself points at another store", async () => {
    const rows = await prisma.warehouse.findMany({ select: { name: true, site: true } });
    const byName = new Map(rows.map((w) => [w.name, w]));
    for (const w of rows) {
      if (!w.site) continue;
      const parent = byName.get(w.site);
      // The parent may not even be a Warehouse-Typology-classified site (YAMOUSSOUKRO isn't — see
      // above), but it must not itself be a STORE (i.e. have its own non-null `site`) — that would
      // be a real cycle in the hierarchy, which Site -> Store -> Bin never allows.
      expect(parent?.site ?? null).toBeNull();
    }
  });
});
