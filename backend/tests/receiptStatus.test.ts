import { describe, it, expect } from "vitest";
import { deriveStatus, computeDashboardCounts } from "@anagroci/contract/domain/receiptStatus";
import type { ReceiptRecord } from "@anagroci/contract/types/receipt";

// Real fixtures — lifted from frontend/src/data/seed/receipts.json (REC-2026-0038, -0019,
// -0005) rather than invented, so this test exercises the same real records the app ships with.
function receipt(overrides: Partial<Pick<ReceiptRecord, "stageData" | "branches">>): Pick<ReceiptRecord, "stageData" | "branches"> {
  return { stageData: {}, branches: {}, ...overrides };
}

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
    expect(deriveStatus(receipt({ stageData: { ...base, "n-unload": {}, "n-grn": {} }, branches: { "n-qfs": "pass" } }))).toBe(
      "grn_completed"
    );
    expect(
      deriveStatus(receipt({ stageData: { ...base, "n-unload": {}, "n-grn": {}, "n-stock": {} }, branches: { "n-qfs": "pass" } }))
    ).toBe("in_stock");
    expect(
      deriveStatus(
        receipt({ stageData: { ...base, "n-unload": {}, "n-grn": {}, "n-stock": {}, "n-drying": {} }, branches: { "n-qfs": "pass" } })
      )
    ).toBe("in_drying");
  });
});

describe("computeDashboardCounts", () => {
  it("matches doc §3's line items over a small realistic mix", () => {
    const receipts = [
      receipt({ stageData: { "n-gate": {}, "n-verify": {} } }), // pending_qa
      receipt({ stageData: { "n-gate": {}, "n-verify": {} }, branches: { "n-qfs": "fail" } }), // rejected
      receipt({ stageData: { "n-verify": {} }, branches: { "n-qfs": "pass" } }), // pending_unload
      receipt({ stageData: { "n-gate": {}, "n-verify": {}, "n-unload": {}, "n-grn": {} }, branches: { "n-qfs": "pass" } }), // grn_completed
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
