import { describe, it, expect } from "vitest";
import {
  formatReceiptId, formatLotNumber, formatDeliveryPlanId, formatTransferId, recodeSiteId,
  parseSiteId, parseTransferId, siteIdPrefix, yearOf,
  legacyLotSeq, normalizeLotNumber, legacyTransferSeq, normalizeTransferId, isValidWarehouseCode,
} from "../src/domain/ids.js";

describe("system IDs", () => {
  it("matches the team's own examples exactly", () => {
    // From their APPLICATION VIEW workbook: REC-BKE-2026-0001, LOT-YAK-2026-0002, DP-BKE-2026-001.
    expect(formatReceiptId("BKE", 2026, 1)).toBe("REC-BKE-2026-0001");
    expect(formatLotNumber("YAK", 2026, 2)).toBe("LOT-YAK-2026-0002");
    expect(formatTransferId(2027, 3)).toBe("BKT-2027-003");
    expect(formatDeliveryPlanId("BKE", 2026, 1)).toBe("DP-BKE-2026-001");
  });

  it("grows past 999 instead of wrapping or truncating", () => {
    expect(formatReceiptId("BKE", 2026, 10000)).toBe("REC-BKE-2026-10000");
    expect(parseSiteId("REC-BKE-2026-10000")?.seq).toBe(10000);
    expect(formatDeliveryPlanId("BKE", 2026, 1000)).toBe("DP-BKE-2026-1000");
  });

  it("round-trips every site-scoped kind through parse", () => {
    for (const id of ["REC-BKE-2026-0684", "LOT-BKE-2026-0017", "DP-BKE-2027-001"]) {
      const p = parseSiteId(id)!;
      const fmt = { REC: formatReceiptId, LOT: formatLotNumber, DP: formatDeliveryPlanId }[p.kind];
      expect(fmt(p.code, p.year, p.seq)).toBe(id);
    }
    expect(parseTransferId("BKT-2026-414")).toEqual({ year: 2026, seq: 414 });
  });

  it("does not mistake the old REC-2026-0001 receipt IDs for the new format", () => {
    expect(parseSiteId("REC-2026-0001")).toBeUndefined();
  });

  it("refuses a warehouse code that would make the ID unparseable", () => {
    expect(isValidWarehouseCode("BKE")).toBe(true);
    expect(isValidWarehouseCode("YAK")).toBe(true);
    expect(isValidWarehouseCode("BKE-001")).toBe(false);
    expect(isValidWarehouseCode("bke01")).toBe(false);
    expect(() => formatReceiptId("BKE-001", 2026, 1)).toThrow();
    expect(() => formatReceiptId("BKE", 2026, 0)).toThrow();
  });

  it("moves an ID to a new code and padding without changing its number", () => {
    expect(recodeSiteId("REC-BKE01-2026-001", "BKE")).toBe("REC-BKE-2026-0001");
    expect(recodeSiteId("LOT-BKE01-2026-017", "BKE")).toBe("LOT-BKE-2026-0017");
    expect(recodeSiteId("DP-BKE01-2026-004", "BKE")).toBe("DP-BKE-2026-004");
    expect(recodeSiteId("REC-BKE-2026-0001", "BKE")).toBe("REC-BKE-2026-0001"); // already current: a no-op
    expect(recodeSiteId("REC-2026-0001", "BKE")).toBeUndefined(); // the pre-system receipt id isn't a site id
    expect(recodeSiteId("17", "BKE")).toBeUndefined();
  });

  it("scans by a prefix that can't match another warehouse or year", () => {
    expect(siteIdPrefix("REC", "BKE", 2026)).toBe("REC-BKE-2026-");
    expect("REC-BKE1-2026-0001".startsWith(siteIdPrefix("REC", "BKE", 2026))).toBe(false);
  });

  it("takes the year from the arrival date, and refuses to guess one", () => {
    expect(yearOf("2026-02-16")).toBe(2026);
    expect(yearOf("2027-01-03T08:00:00.000Z")).toBe(2027);
    expect(yearOf("")).toBeUndefined();
    expect(yearOf("16/02/2026")).toBeUndefined();
  });
});

describe("legacy values from the 2026 workbooks", () => {
  it("reads a bare integer lot, including Excel's 17.0", () => {
    expect(legacyLotSeq("17")).toBe(17);
    expect(legacyLotSeq(17)).toBe(17);
    expect(legacyLotSeq("17.0")).toBe(17);
  });

  it("leaves anything that isn't one lot unresolved instead of inventing one", () => {
    // "12,5" is two lots in one Drying Batch cell; "BIN-03B" is a bin code typed into the lot column.
    for (const v of ["12,5", "BIN-03B", "", "0", "17.5", null, undefined]) expect(legacyLotSeq(v)).toBeUndefined();
  });

  it("formats a legacy lot with the same number, and passes a new-format lot through", () => {
    expect(normalizeLotNumber("17", "BKE", 2026)).toBe("LOT-BKE-2026-0017");
    expect(normalizeLotNumber("LOT-BKE-2026-0017", "BKE", 2026)).toBe("LOT-BKE-2026-0017");
    // A lot issued under the superseded BKE01 code keeps its number and takes the new code.
    expect(normalizeLotNumber("LOT-BKE01-2026-017", "BKE", 2026)).toBe("LOT-BKE-2026-0017");
    expect(normalizeLotNumber("12,5", "BKE", 2026)).toBeUndefined();
  });

  it("reads both 2026 BKT shapes and keeps the number", () => {
    expect(legacyTransferSeq("BKT001")).toBe(1);
    expect(legacyTransferSeq("BKT-414")).toBe(414);
    expect(normalizeTransferId("BKT-029", 2026)).toBe("BKT-2026-029");
    expect(normalizeTransferId("BKT-2026-029", 2026)).toBe("BKT-2026-029");
    expect(normalizeTransferId("VOYAGE 3", 2026)).toBeUndefined();
  });
});
