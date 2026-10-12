import { describe, it, expect } from "vitest";
import { normalizeSupplierName, supplierNameKey, suggestLbaCode } from "../src/domain/supplierCode";

describe("supplier name without RCN", () => {
  it("drops a leading RCN and surrounding spaces, nothing else", () => {
    expect(normalizeSupplierName("RCN SCOOPS DIENE")).toBe("SCOOPS DIENE");
    expect(normalizeSupplierName("  rcn  ESPI SCOOPS ")).toBe("ESPI SCOOPS"); // the real list has "RCN  ESPI SCOOPS" with two spaces
    expect(normalizeSupplierName("RCN")).toBe("");
  });

  it("leaves a name alone when RCN is not a leading word, and keeps the inner spacing as typed", () => {
    expect(normalizeSupplierName("RCNO TRADING")).toBe("RCNO TRADING");
    expect(normalizeSupplierName("SCOOP ARCN")).toBe("SCOOP ARCN");
    expect(normalizeSupplierName("RCN SCOPPAS  SCOOPS")).toBe("SCOPPAS  SCOOPS");
  });

  it("is idempotent, and a name with and without RCN share a matching key", () => {
    expect(normalizeSupplierName(normalizeSupplierName("RCN SCOOP WEBE"))).toBe("SCOOP WEBE");
    expect(supplierNameKey("RCN SCOOPS  DIENE")).toBe(supplierNameKey("scoops diene"));
  });
});

describe("suggested LBA code", () => {
  const existing = ["LBA-013-DAG", "LBA-023-AGR", "DIS-041-BRO", "LBA-009-SCO"];

  it("is the next number after the highest LBA one, with letters from the distinctive word", () => {
    expect(suggestLbaCode("RCN DAGNOGO KARIM", existing)).toBe("LBA-024-DAG");
    expect(suggestLbaCode("RCN SCOOPS DIENE", existing)).toBe("LBA-024-DIE"); // SCOOPS is skipped, as in the client's own codes
    expect(suggestLbaCode("SCOOP WEBE", existing)).toBe("LBA-024-WEB");
  });

  it("ignores codes that are not LBA-numbered when counting, and starts at 001 on an empty master", () => {
    expect(suggestLbaCode("Test", ["DIS-099-XXX"])).toBe("LBA-001-TES");
    expect(suggestLbaCode("Test", [])).toBe("LBA-001-TES");
  });

  it("strips accents, pads a short name, and copes with a name that is only skipped words", () => {
    expect(suggestLbaCode("Étoile du Nord", [])).toBe("LBA-001-ETO");
    expect(suggestLbaCode("AB", [])).toBe("LBA-001-ABX");
    expect(suggestLbaCode("RCN SCOOPS", [])).toBe("LBA-001-XXX");
  });

  it("never returns a code that already exists", () => {
    const code = suggestLbaCode("Same", ["LBA-001-SAM"]);
    expect(code).toBe("LBA-002-SAM");
    expect(["LBA-001-SAM"]).not.toContain(code);
  });
});
