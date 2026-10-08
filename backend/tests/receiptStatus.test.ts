import { describe, it, expect } from "vitest";
import { deriveStatus, computeDashboardCounts } from "@anagroci/contract/domain/receiptStatus";
import type { ReceiptRecord } from "@anagroci/contract/types/receipt";

// Real fixtures — lifted from frontend/src/data/seed/receipts.json (REC-2026-0038, -0019,
// -0005) rather than invented, so this test exercises the same real records the app ships with.
type Inputs = Pick<ReceiptRecord, "stageData" | "branches" | "source">;
// `entered` unless a test says otherwise: that is the strict GRN rule, the one every new receipt gets.
function receipt(overrides: Partial<Inputs>): Inputs {
  return { stageData: {}, branches: {}, source: "entered", ...overrides };
}
const GRN_QTY = "GRN Weight (kept separate from Gross/Net/Paid)";

describe("deriveStatus", () => {
  it("a brand-new receipt with nothing filled in is planned", () => {
    expect(deriveStatus(receipt({}))).toBe("planned");
  });

  it("n-gate filled, nothing else, is arrived", () => {
    expect(deriveStatus(receipt({ stageData: { "n-gate": { "S N": "1" } } }))).toBe("arrived");
  });

  it("n-verify filled is pending_qa", () => {
    expect(
      deriveStatus(receipt({ stageData: { "n-gate": {}, "n-verify": { "SUPPLIERS NAME": "RCN SCOOP IMANE" } } }))
    ).toBe("pending_qa");
  });

  it("n-qfs pass with nothing unloaded yet is pending_unload", () => {
    expect(deriveStatus(receipt({ stageData: { "n-verify": {} }, branches: { "n-qfs": "pass" } }))).toBe("pending_unload");
  });

  it("n-qfs fail is rejected, regardless of what else is filled in", () => {
    // Real case: REC-2026-0019 in the seed — QFS failed after arrival, nothing downstream filled.
    expect(deriveStatus(receipt({ stageData: { "n-gate": {}, "n-verify": {} }, branches: { "n-qfs": "fail" } }))).toBe(
      "rejected"
    );
  });

  it("n-xferdec=transfer wins over an in-progress drying/stock state", () => {
    // Real case: REC-2026-0005 in the seed — passed QFS and later transferred out.
    expect(
      deriveStatus(
        receipt({
          stageData: { "n-stock": {}, "n-drying": {} },
          branches: { "n-qfs": "pass", "n-xferdec": "transfer" },
        })
      )
    ).toBe("transferred_out");
  });

  it("walks forward through unload -> grn -> stock -> drying in order", () => {
    const base = { "n-gate": {}, "n-verify": {} };
    expect(deriveStatus(receipt({ stageData: { ...base, "n-unload": {} }, branches: { "n-qfs": "pass" } }))).toBe("unloaded");
    const grn = { [GRN_QTY]: "40822" };
    expect(deriveStatus(receipt({ stageData: { ...base, "n-unload": {}, "n-grn": grn }, branches: { "n-qfs": "pass" } }))).toBe(
      "grn_completed"
    );
    expect(
      deriveStatus(receipt({ stageData: { ...base, "n-unload": {}, "n-grn": grn, "n-stock": {} }, branches: { "n-qfs": "pass" } }))
    ).toBe("in_stock");
    expect(
      deriveStatus(
        receipt({ stageData: { ...base, "n-unload": {}, "n-grn": grn, "n-stock": {}, "n-drying": {} }, branches: { "n-qfs": "pass" } })
      )
    ).toBe("in_drying");
  });

  // The client: "make sure the GRN step is completed before the transaction is considered fully received."
  describe("GRN completed needs the GRN quantity", () => {
    const base = { "n-gate": {}, "n-verify": {}, "n-unload": {} };
    const pass = { "n-qfs": "pass" };

    it("a price alone is not enough for an entered receipt — it stays unloaded until the quantity is recorded", () => {
      expect(deriveStatus(receipt({ stageData: { ...base, "n-grn": { PRICE: "470", AMOUNT: "19158140" } }, branches: pass }))).toBe("unloaded");
      expect(deriveStatus(receipt({ stageData: { ...base, "n-grn": { [GRN_QTY]: "   " } }, branches: pass }))).toBe("unloaded"); // blank isn't recorded
      expect(deriveStatus(receipt({ stageData: { ...base, "n-grn": { PRICE: "470", [GRN_QTY]: "40822" } }, branches: pass }))).toBe("grn_completed");
    });

    it("an imported receipt keeps the status its workbook supports — the 2026 sheet has no GRN quantity column", () => {
      const price = { PRICE: "470", AMOUNT: "19158140" };
      expect(deriveStatus(receipt({ source: "imported", stageData: { ...base, "n-grn": price }, branches: pass }))).toBe("grn_completed");
    });

    it("a caller that doesn't say where a receipt came from gets the strict rule", () => {
      expect(deriveStatus({ stageData: { ...base, "n-grn": { PRICE: "470" } }, branches: pass })).toBe("unloaded");
    });

    it("a zero is a recorded quantity", () => {
      expect(deriveStatus(receipt({ stageData: { ...base, "n-grn": { [GRN_QTY]: "0" } }, branches: pass }))).toBe("grn_completed");
    });
  });
});

describe("computeDashboardCounts", () => {
  it("matches doc §3's line items over a small realistic mix", () => {
    const receipts = [
      receipt({ stageData: { "n-gate": {}, "n-verify": {} } }), // pending_qa
      receipt({ stageData: { "n-gate": {}, "n-verify": {} }, branches: { "n-qfs": "fail" } }), // rejected
      receipt({ stageData: { "n-verify": {} }, branches: { "n-qfs": "pass" } }), // pending_unload
      receipt({ stageData: { "n-gate": {}, "n-verify": {}, "n-unload": {}, "n-grn": { [GRN_QTY]: "40822" } }, branches: { "n-qfs": "pass" } }), // grn_completed
      receipt({}), // planned — excluded from totalReceived
    ];
    const counts = computeDashboardCounts(receipts);
    expect(counts).toEqual({
      totalReceived: 4,
      acceptedUnloaded: 1,
      grnCompleted: 1,
      pendingQa: 1,
      pendingUnload: 1,
      rejected: 1,
    });
  });
});
