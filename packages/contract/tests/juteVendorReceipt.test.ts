import { describe, it, expect } from "vitest";
import { parseBags, shortQuantity, shortQuantityLabel, vendorReceiptProblems } from "../src/domain/juteVendorReceipt.js";

const GOOD = { vendorName: "ABC Traders", deliveryNoteNo: "DN-101", date: "2026-11-05", invoicedQty: "1000", receivedQty: "980" };

describe("a vendor receipt of jute bags", () => {
  it("needs no remarks, and has no problems when the rest is there", () => {
    expect(vendorReceiptProblems(GOOD)).toEqual([]);
  });

  it("names each thing that is missing", () => {
    const problems = vendorReceiptProblems({});
    expect(problems).toHaveLength(5);
    expect(problems.join(" ")).toMatch(/vendor name.*delivery note.*date.*Invoiced.*Received/);
  });

  it("refuses a date that doesn't exist, rather than rolling it into the next month", () => {
    expect(vendorReceiptProblems({ ...GOOD, date: "2026-02-31" })).toEqual(["Enter the date the bags were received."]);
  });

  it("refuses a receipt of no bags, which adds nothing to stock", () => {
    expect(vendorReceiptProblems({ ...GOOD, receivedQty: "0" })).toHaveLength(1);
    expect(vendorReceiptProblems({ ...GOOD, invoicedQty: "0" })).toEqual([]);
  });
});

describe("counting bags", () => {
  it("reads whole numbers, with spaces", () => {
    expect(parseBags("1 000")).toBe(1000);
    expect(parseBags(980)).toBe(980);
  });

  it("refuses what could be misread or wouldn't fit", () => {
    for (const bad of ["1,000", "1.000", "-5", "ten", "", null, undefined, "2147483648"]) expect(parseBags(bad)).toBeNull();
  });
});

describe("short quantity", () => {
  it("is invoiced minus received, and an over-delivery stays visible as one", () => {
    expect(shortQuantity(1000, 980)).toBe(20);
    expect(shortQuantity(1000, 1005)).toBe(-5);
    expect(shortQuantityLabel(20)).toBe("20 short");
    expect(shortQuantityLabel(-5)).toBe("5 over");
    expect(shortQuantityLabel(0)).toBe("None");
  });
});
