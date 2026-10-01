import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { canonical, cellToPlain, parseCell, serializeCell } from "../src/domain/workbook/cells.js";

const ok = (raw: unknown, type: string) => {
  const r = parseCell(raw, type);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const err = (raw: unknown, type: string) => {
  const r = parseCell(raw, type);
  return r.ok ? null : r.error;
};

describe("serializeCell", () => {
  it("keeps Decimals as text (never a lossy double) and tells a date from a timestamp", () => {
    expect(serializeCell(new Prisma.Decimal("12345678901234567890.123456"))).toBe("12345678901234567890.123456");
    expect(serializeCell(new Date("2026-09-30T00:00:00.000Z"))).toBe("2026-09-30");
    expect(serializeCell(new Date("2026-09-30T10:15:00.123Z"))).toBe("2026-09-30T10:15:00.123Z");
    expect(serializeCell(null)).toBeNull();
    expect(serializeCell(BigInt(5))).toBe("5");
  });
});

describe("parseCell", () => {
  it("reads every Excel cell shape: rich text, formula result, hyperlink", () => {
    expect(cellToPlain({ richText: [{ text: "ab" }, { text: "cd" }] })).toBe("abcd");
    expect(cellToPlain({ formula: "A1+1", result: 7 })).toBe(7);
    expect(cellToPlain({ text: "link", hyperlink: "http://x" })).toBe("link");
    expect(ok({ richText: [{ text: "REC-1" }] }, "String")).toBe("REC-1");
    expect(err({ error: "#REF!" }, "String")).toMatch(/Excel error/);
  });

  it("treats only exactly-empty as blank, so whitespace a table holds survives a round trip", () => {
    expect(ok(null, "Int")).toBeNull();
    expect(ok("", "Decimal")).toBeNull();
    expect(ok("  ", "String")).toBe("  ");
  });

  it("String: numbers and dates typed into a text column become their text, not a guess", () => {
    expect(ok(10.3, "String")).toBe("10.3");
    expect(ok(new Date("2026-09-30T00:00:00Z"), "String")).toBe("2026-09-30");
    expect(ok("0012", "String")).toBe("0012");
  });

  it("Int: whole numbers only, within range", () => {
    expect(ok(5, "Int")).toBe(5);
    expect(ok("12", "Int")).toBe(12);
    expect(err(1.5, "Int")).toMatch(/whole number/);
    expect(err("abc", "Int")).toMatch(/whole number/);
    expect(err(3_000_000_000, "Int")).toMatch(/too large/);
  });

  it("Decimal: exact from text, refuses a comma instead of reinterpreting it", () => {
    expect((ok("12.50", "Decimal") as Prisma.Decimal).toString()).toBe("12.5");
    expect((ok(0.1, "Decimal") as Prisma.Decimal).toString()).toBe("0.1");
    expect((ok("12345678901234567890.123456", "Decimal") as Prisma.Decimal).toString()).toBe("12345678901234567890.123456");
    expect(err("44,94", "Decimal")).toMatch(/decimal point/);
    expect(err("abc", "Decimal")).toMatch(/isn't a number/);
  });

  it("DateTime: YYYY-MM-DD, ISO timestamps and real dates; never a day-first or impossible date", () => {
    expect((ok("2026-09-30", "DateTime") as Date).toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect((ok("2026-09-30T10:15:00.123Z", "DateTime") as Date).toISOString()).toBe("2026-09-30T10:15:00.123Z");
    expect(ok(new Date("2026-09-30T00:00:00Z"), "DateTime")).toBeInstanceOf(Date);
    for (const bad of ["30/09/2026", "13-01-2026", "2026-02-31", "yesterday", 45930]) expect(err(bad, "DateTime"), String(bad)).toMatch(/isn't a date/);
  });

  it("Boolean and unsupported types", () => {
    expect(ok("TRUE", "Boolean")).toBe(true);
    expect(ok(false, "Boolean")).toBe(false);
    expect(err("yes", "Boolean")).toMatch(/TRUE or FALSE/);
    expect(err("{}", "Json")).toMatch(/can't be set from a workbook/);
  });
});

describe("canonical (what 'unchanged' means)", () => {
  it("makes null, '' and absent the same blank, and compares Decimals and dates by value", () => {
    expect(canonical(null)).toBe(canonical(""));
    expect(canonical(undefined)).toBe("");
    expect(canonical(new Prisma.Decimal("5.250"))).toBe(canonical(new Prisma.Decimal("5.25")));
    expect(canonical(new Date("2026-09-30T00:00:00Z"))).toBe("2026-09-30");
    expect(canonical(5)).toBe("5");
  });

  it("a value written then read back compares equal, for every column type", () => {
    const cases: [unknown, string][] = [
      ["text", "String"], [42, "Int"], [new Prisma.Decimal("40.03599"), "Decimal"],
      [new Date("2026-09-30T00:00:00Z"), "DateTime"], [new Date("2026-09-30T10:15:00.123Z"), "DateTime"], ["  padded  ", "String"],
    ];
    for (const [value, type] of cases) {
      const back = ok(serializeCell(value), type);
      expect(canonical(back), `${type} ${String(value)}`).toBe(canonical(value));
    }
  });
});
