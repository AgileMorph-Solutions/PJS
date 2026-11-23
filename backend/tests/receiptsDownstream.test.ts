/**
 * The Reception list's downstream status flags — the reason Dispatch to Central, Receiving from
 * Unit and Issue to Production no longer need their own sidebar pages. Counts below are measured
 * against the real seeded + imported data, not predicted (see receiptsDownstream.ts's own header
 * and inline comments for the two real bugs this suite would have caught: filtering
 * WarehouseDischarge by the literal string "YAKRO FACTORY" instead of resolveSite()'s expanded
 * alias list, which silently zeroed out `received` for every receipt).
 */
import { describe, it, expect } from "vitest";
import { getDownstreamStatus } from "../src/services/receiptsDownstream.js";
import { WORKBOOK_DATA } from "./helpers/workbookData.js";

describe("downstream status", () => {
  it.skipIf(!WORKBOOK_DATA)("covers every receipt exactly once", async () => {
    const status = await getDownstreamStatus();
    expect(status.size).toBe(986);
  });

  it.skipIf(!WORKBOOK_DATA)("received (Warehouse Receiving, central site) is measured via resolveSite's alias list, not the literal site name", async () => {
    const status = await getDownstreamStatus();
    const received = [...status.values()].filter((r) => r.received).length;
    // WarehouseDischarge stores the sheet's own verbatim site name ("YAMOUSSOUKRO"), not the
    // canonical "YAKRO FACTORY" — a literal-string filter would measure 0 here.
    expect(received).toBe(255);
  });

  it("dispatched is measured (near-zero) because CHARGEMENT's Fiche CCA is a genuinely disjoint " +
     "numeric range from every receipt's own fiche — a real data gap, not a bug", async () => {
    const status = await getDownstreamStatus();
    const dispatched = [...status.values()].filter((r) => r.dispatched).length;
    expect(dispatched).toBe(0);
  });

  it.skipIf(!WORKBOOK_DATA)("dried and issued are both measured, non-trivial fractions of the receipt population", async () => {
    const status = await getDownstreamStatus();
    const rows = [...status.values()];
    expect(rows.filter((r) => r.dried).length).toBe(74);
    // 43 since the Oct 2026 renumber (51 before): `issued` is reached through a transfer matched on the
    // receipt's Lot OR Fiche, and the 8 that went were Lot collisions with another warehouse's "17".
    expect(rows.filter((r) => r.issued).length).toBe(43);
  });

  it.skipIf(!WORKBOOK_DATA)("scoping by warehouse only ever narrows the result, never changes an individual receipt's flags", async () => {
    const [all, bouake] = await Promise.all([getDownstreamStatus(), getDownstreamStatus(["BOUAKE"])]);
    expect(bouake.size).toBeLessThan(all.size);
    for (const [id, status] of bouake) expect(all.get(id)).toEqual(status);
  });
});
