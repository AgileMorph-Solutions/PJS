/**
 * The plain-language layer (fields.ts): every sheet title and column header a person sees, and the
 * guarantees that keep it honest — each header points at a real column, nothing technical leaks,
 * and nothing a new row needs is hidden from the person who has to supply it.
 */
import { describe, it, expect } from "vitest";
import { SHEET_FIELDS, normalizeHeader } from "../src/domain/workbook/fields.js";
import { SHEETS, sheetsFor, sheetByTitle } from "../src/domain/workbook/sheets.js";
import { columnInfo } from "../src/domain/workbook/schemaInfo.js";
import { RECEIPT_COLUMNS, RECEIPT_DERIVED_COLUMNS } from "../src/domain/workbook/receiptSheet.js";

const SECTIONS = ["UNIT", "CENTRAL"] as const;
const internal = ["source", "sheetRow", "createdAt", "updatedAt", "seq", "activityCategory", "destinationProvenance",
  "computed_balance", "balance_delta", "reportedBalance", "weightDifference", "reportedDifference", "diff"];

describe("every sheet and column", () => {
  for (const type of SECTIONS) {
    for (const spec of sheetsFor(type)) {
      it(`${type} · ${spec.title}: keys are real, unique, id first`, () => {
        const fields = spec.fields(type);
        expect(fields[0].key).toBe(spec.key);
        expect(new Set(fields.map((f) => f.key)).size).toBe(fields.length);
        if (spec.kind === "receipt") {
          // Either a real column the file reads and writes, or one the app works out and the file only shows.
          for (const f of fields) expect([...RECEIPT_COLUMNS, ...RECEIPT_DERIVED_COLUMNS], f.key).toContain(f.key);
        } else if (spec.exportOnly) {
          // Built from other records (a plan's progress, a BKT's variance), so its keys are the sheet's own, not a table's.
          expect(spec.readOnly).toEqual([]);
        } else {
          const info = columnInfo(spec.model!);
          for (const f of fields) expect(info.has(f.key), `${spec.model}.${f.key}`).toBe(true);
        }
        for (const f of fields) expect(internal, `${spec.title}: ${f.key} is the app's own`).not.toContain(f.key);
      });

      it(`${type} · ${spec.title}: headers read as plain words and are unique`, () => {
        const labels = spec.fields(type).map((f) => f.label);
        for (const l of labels) {
          expect(l, l).not.toMatch(/[a-z][A-Z]/);        // camelCase
          expect(l, l).not.toMatch(/[._]/);               // dotted.keys, snake_case
          expect(l, l).not.toMatch(/\bRaw\b/i);
          expect(l, l).toMatch(/^[A-Z0-9]/);              // starts like a title
        }
        const norm = labels.map(normalizeHeader);
        expect(new Set(norm).size, `a header repeats (ignoring case and punctuation) on ${spec.title}`).toBe(norm.length);
      });

      it(`${type} · ${spec.title}: nothing a new row needs is hidden`, () => {
        if (spec.kind === "receipt" || spec.exportOnly) return;
        const shown = new Set(spec.fields(type).map((f) => f.key));
        const filled = new Set(spec.defaultToSection(type));
        for (const [col, c] of columnInfo(spec.model!)) {
          const needed = c.required && !c.hasDefault && !c.isId && !spec.readOnly.includes(col);
          if (needed) expect(shown.has(col) || filled.has(col), `${spec.model}.${col} is required but neither shown nor defaulted`).toBe(true);
        }
      });
    }
  }
});

describe("titles", () => {
  it("are plain, short and unique, and Excel-safe", () => {
    const titles = SHEETS.map((s) => s.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const t of titles) {
      expect(t.length).toBeLessThanOrEqual(31);
      expect(t).not.toMatch(/[\\/?*[\]:]/);
      expect(t).not.toMatch(/[a-z][A-Z]/); // WarehouseDischarge would fail this
    }
    expect(titles).toEqual(["Truck Reception", "Delivery Plan", "BKT Transfers", "Warehouse Receiving", "Drying", "Drying & Sorting", "Dispatch",
      "Stock Transfers", "Jute Bags", "Activity Ledger", "Issued to Production", "Suppliers"]);
  });

  it("are found whatever the case or spacing", () => {
    expect(sheetByTitle("truck  RECEPTION")?.name).toBe("Receipt");
    expect(sheetByTitle("Nope")).toBeUndefined();
  });

  it("start the Unit and Central workbooks on Truck Reception", () => {
    expect(sheetsFor("UNIT")[0].title).toBe("Truck Reception");
    expect(sheetsFor("CENTRAL")[0].title).toBe("Truck Reception");
  });
});

describe("what differs between Unit and Central", () => {
  const receiving = (t: "UNIT" | "CENTRAL") => SHEETS.find((s) => s.name === "WarehouseDischarge")!.fields(t);

  it("Warehouse Receiving asks for the lab panel that section actually records, in full", () => {
    const unit = receiving("UNIT").map((f) => f.label);
    const central = receiving("CENTRAL").map((f) => f.label);
    for (const panel of ["Sample", "Final"]) {
      for (const l of ["Good Kernel (g)", "KOR", "Moisture (%)", "Nut Count", "Shell (g)", "Total Yield (%)"]) {
        expect(unit, `Unit ${panel} – ${l}`).toContain(`${panel} – ${l}`);
        expect(central, `Central ${panel} – ${l}`).toContain(`${panel} – ${l}`);
      }
    }
    expect(central).toContain("Sample – Murli");
    expect(central).toContain("Final – After-Dry KOR");
    expect(unit).not.toContain("Sample – Murli");
    // The two panels never mix: the same label means the same thing in both, but different columns hold it.
    const keys = (t: "UNIT" | "CENTRAL") => new Set(receiving(t).map((f) => f.key));
    expect(keys("UNIT").has("samplingKor")).toBe(true);
    expect(keys("UNIT").has("q1Kor")).toBe(false);
    expect(keys("CENTRAL").has("q1Kor")).toBe(true);
    expect(keys("CENTRAL").has("samplingKor")).toBe(false);
  });

  it("only Central asks for the Yakro-only receiving details", () => {
    expect(receiving("CENTRAL").map((f) => f.label)).toEqual(expect.arrayContaining(["Delivery Note No", "CCAK Validated", "Storage Area"]));
    expect(receiving("UNIT").map((f) => f.label)).not.toContain("Storage Area");
  });
});

describe("what the app works out is shown, never written", () => {
  it("no plan column is one an upload can write (the status is filtered out where an upload is read)", () => {
    for (const key of RECEIPT_DERIVED_COLUMNS.filter((k) => k !== "status (derived)")) expect(RECEIPT_COLUMNS, key).not.toContain(key);
  });

  it("Truck Reception shows Receipt Status and the plan columns the client asked for", () => {
    const fields = SHEETS[0].fields("UNIT");
    const byLabel = new Map(fields.map((f) => [f.label, f.key]));
    for (const l of ["Receipt Status", "Delivery Plan ID", "Reception Type", "Planning / Exception Flag", "Plan Link Status", "Exception Approval Status"]) {
      expect(RECEIPT_DERIVED_COLUMNS, l).toContain(byLabel.get(l));
    }
  });

  it("the GRN column carries the client's wording, and an older export's header still finds it", () => {
    const grn = SHEETS[0].fields("UNIT").find((f) => f.key === "StageGrn.grnWeight")!;
    expect(grn.label).toBe("GRN Quantity (kg)");
    expect(grn.aka).toEqual(["GRN Weight (kg)"]);
  });

  it("the cut-test grams and the loaded weight are columns, so KOR can be recorded from them", () => {
    const labels = SHEETS[0].fields("UNIT").map((f) => f.label);
    for (const l of ["Loaded Truck Weight (kg)", "Sample – Good Kernel (g)", "Sample – Immature (g)", "Sample – Spotted (g)", "Final – Good Kernel (g)", "Final – Shell (g)"]) {
      expect(labels, l).toContain(l);
    }
  });
});

describe("Truck Reception follows the client's own sheet", () => {
  it("asks for what the client's Truck Reception sheet holds, in plain words", () => {
    const labels = SHEETS[0].fields("UNIT").map((f) => f.label);
    for (const l of ["Arrival Date", "Offloading Date", "Payment Type", "Supplier Name", "Supplier Code", "Truck No", "Fiche Code", "Fiche No",
      "Bags Count", "Gross Weight (kg)", "Net Weight (kg)", "Good Bags", "Humid Bags", "Torn Bags", "Refraction (kg)", "Paid Weight (kg)",
      "Price (CFA/kg)", "Amount (CFA)", "Moisture (%)", "Nut Count", "KOR", "Final KOR", "Origin", "Remarks", "Week"]) {
      expect(labels, l).toContain(l);
    }
  });
});
