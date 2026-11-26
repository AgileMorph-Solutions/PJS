import { describe, it, expect } from "vitest";
import { ficheBytesMatchType, ficheFill, ficheOriginHint, ficheSuggestions, normalizeBuyerCode, normalizeFicheNumber, supplierForBuyerCode, type FicheReading } from "../src/domain/fiche";

// The sample fiche the client shared (CCA Fiche de Transfert 00076601, 17/11/2026).
const sample: FicheReading = { isCcaTransferFiche: true, ficheNumber: "00076601", buyerCode: "0201-0004", storeName: "NOVAREA PF3", unclear: "" };

describe("fiche number", () => {
  it("drops the printed leading zeros, as the workbooks write it (72515, not 00072515)", () => {
    expect(normalizeFicheNumber("00076601")).toBe("76601");
    expect(normalizeFicheNumber(" 72 515 ")).toBe("72515");
  });
  it("is blank when what was read isn't a number — never a guess", () => {
    expect(normalizeFicheNumber("N° 0007660?")).toBe("");
    expect(normalizeFicheNumber("")).toBe("");
    expect(normalizeFicheNumber("0000")).toBe("");
  });
});

describe("buyer code", () => {
  it("keeps the NNNN-NNNN code and drops the store label written after it", () => {
    expect(normalizeBuyerCode("0201-0004 LT-NOVAREA")).toBe("0201-0004");
  });
  it("puts back a dash read as a space, a dot or nothing", () => {
    expect(normalizeBuyerCode("0201 0004")).toBe("0201-0004");
    expect(normalizeBuyerCode("0201.0004")).toBe("0201-0004");
    expect(normalizeBuyerCode("02010004")).toBe("0201-0004");
  });
  it("is blank without a 4+4-digit code", () => {
    expect(normalizeBuyerCode("0201-004")).toBe("");
    expect(normalizeBuyerCode("123456789")).toBe("");
    expect(normalizeBuyerCode("")).toBe("");
  });
});

describe("supplier from the buyer code", () => {
  const suppliers = [
    { code: "LBA-006-IMA", name: "RCN SCOOP IMANE" },
    { code: "LBA-007-CAS", name: "CASP-S SCOOPS" },
    { code: "LBA-099-OLD", name: "OLD COOP", status: "inactive" },
  ];
  it("names the one supplier earlier trucks with this code belonged to, as the picker lists it (no RCN)", () => {
    expect(supplierForBuyerCode([{ lbaCode: "LBA-006-IMA" }, { lbaCode: "LBA-006-IMA " }], suppliers)).toBe("SCOOP IMANE");
  });
  it("offers nothing when no truck has used the code, or it points at two suppliers", () => {
    expect(supplierForBuyerCode([], suppliers)).toBeUndefined();
    expect(supplierForBuyerCode([{ lbaCode: "LBA-006-IMA" }, { lbaCode: "LBA-007-CAS" }], suppliers)).toBeUndefined();
  });
  it("ignores trucks whose LBA code isn't an active supplier in the master", () => {
    expect(supplierForBuyerCode([{ lbaCode: "LBA-404-XXX" }, { lbaCode: null }], suppliers)).toBeUndefined();
    expect(supplierForBuyerCode([{ lbaCode: "LBA-099-OLD" }], suppliers)).toBeUndefined();
  });
});

describe("suggestions for the Verify supplier documents step", () => {
  it("offers the fiche number, the buyer code and the supplier — and nothing for Origin or REF.", () => {
    const s = ficheSuggestions(sample, "SCOOP IMANE");
    expect(s).toEqual({
      FICHE: { value: "76601", from: "the fiche" },
      "FICHE CODE": { value: "0201-0004", from: "the fiche" },
      "SUPPLIERS NAME": { value: "SCOOP IMANE", from: "CCA supplier code 0201-0004 on earlier trucks" },
    });
    expect(s).not.toHaveProperty("ORIGIN");
    expect(s).not.toHaveProperty("REF.");
  });
  it("offers no supplier when the code finds none", () => {
    expect(ficheSuggestions(sample, undefined)).not.toHaveProperty("SUPPLIERS NAME");
  });
  it("offers nothing from a document that isn't a CCA fiche (e.g. ANAGROCI's own unloading slip)", () => {
    expect(ficheSuggestions({ ...sample, isCcaTransferFiche: false }, "SCOOP IMANE")).toEqual({});
    expect(ficheSuggestions(null, undefined)).toEqual({});
  });
  it("leaves out a value it couldn't read", () => {
    expect(ficheSuggestions({ ...sample, ficheNumber: "", buyerCode: "illegible" }, "SCOOP IMANE")).toEqual({});
  });
});

describe("file type check", () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
  it("accepts a PDF, a JPG, a PNG and a WEBP whose bytes match their type", () => {
    expect(ficheBytesMatchType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d), "application/pdf")).toBe(true);
    expect(ficheBytesMatchType(bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg")).toBe(true);
    expect(ficheBytesMatchType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "image/png")).toBe(true);
    expect(ficheBytesMatchType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50), "image/webp")).toBe(true);
  });
  it("refuses a file renamed to look like a photo, and any other type", () => {
    expect(ficheBytesMatchType(bytes(0x4d, 0x5a), "image/jpeg")).toBe(false); // an .exe
    expect(ficheBytesMatchType(bytes(0x25, 0x50, 0x44, 0x46), "image/png")).toBe(false);
    expect(ficheBytesMatchType(bytes(0x3c, 0x73, 0x76, 0x67), "image/svg+xml")).toBe(false);
  });
});

describe("origin hint", () => {
  const origins = ["DALOA", "GBOGUHE", "VAVOUA", "YAMOUSSOUKRO", "M'BAHIAKRO", "KONG", "KANI"];
  const places = (subPrefecture: string, department: string, village: string): FicheReading => ({ ...sample, subPrefecture, department, village });

  // Team, 24 Nov 2026: the Origin is the village. The bug this guards: the sample fiche (village AKPESSEKRO, sub-prefecture
  // YAMOUSSOUKRO) filled YAMOUSSOUKRO.
  it("takes the village as the Origin, never a sub-prefecture that is in Origins instead", () => {
    expect(ficheOriginHint(places("YAMOUSSOUKRO", "YAMOUSSOUKRO", "AKPESSEKRO"), origins)).toEqual({
      places: [
        { level: "Village", name: "AKPESSEKRO" },
        { level: "Sub-prefecture", name: "YAMOUSSOUKRO" },
      ],
    });
    expect(ficheOriginHint(places("YAMOUSSOUKRO", "YAMOUSSOUKRO", "AKPESSEKRO"), [...origins, "AKPESSEKRO"])!.match)
      .toEqual({ origin: "AKPESSEKRO", level: "Village", exact: true });
  });
  it("falls back to the sub-prefecture, then the department, only when the village is blank", () => {
    expect(ficheOriginHint(places("GBOGUHE", "DALOA", ""), origins)!.match).toEqual({ origin: "GBOGUHE", level: "Sub-prefecture", exact: true });
    expect(ficheOriginHint(places("", "VAVOUA", ""), origins)!.match).toEqual({ origin: "VAVOUA", level: "Department", exact: true });
  });
  it("treats the master's spelling variants as the same town (doubled letters, apostrophes, accents)", () => {
    expect(ficheOriginHint(places("YAMOUSOUKRO", "", ""), origins)!.match).toMatchObject({ origin: "YAMOUSSOUKRO", exact: true });
    expect(ficheOriginHint(places("M BAHIAKRO", "", ""), origins)!.match).toMatchObject({ origin: "M'BAHIAKRO", exact: true });
  });
  it("offers a one-letter-off town as 'did you mean', but never for short names", () => {
    expect(ficheOriginHint(places("VAVOVA", "", ""), origins)!.match).toEqual({ origin: "VAVOUA", level: "Sub-prefecture", exact: false });
    expect(ficheOriginHint(places("KONI", "", ""), origins)!.match).toBeUndefined(); // KONG? KANI? — too short to say
  });
  it("shows the places but matches nothing when no place is in Origins — the person picks or adds the town", () => {
    const hint = ficheOriginHint(places("", "", "AKPESSEKRO"), origins)!;
    expect(hint.places).toEqual([{ level: "Village", name: "AKPESSEKRO" }]);
    expect(hint.match).toBeUndefined();
  });
  it("says nothing for a document that isn't a CCA fiche, or a reading without places", () => {
    expect(ficheOriginHint({ ...places("VAVOUA", "", ""), isCcaTransferFiche: false }, origins)).toBeNull();
    expect(ficheOriginHint(sample, origins)).toBeNull();
  });
});

describe("auto-fill on upload", () => {
  const offered = ficheSuggestions(sample, "SCOOP IMANE");
  const yamoussoukro = ficheOriginHint({ ...sample, subPrefecture: "YAMOUSSOUKRO", department: "YAMOUSSOUKRO", village: "AKPESSEKRO" }, ["AKPESSEKRO"]);
  it("fills every field the fiche gives, Origin too when its village is in Origins", () => {
    expect(ficheFill(offered, yamoussoukro, undefined)).toEqual({
      fill: { FICHE: "76601", "FICHE CODE": "0201-0004", "SUPPLIERS NAME": "SCOOP IMANE", ORIGIN: "AKPESSEKRO" },
      replaced: {},
    });
  });
  // Team, 23 Nov 2026: the form follows the fiche, and what it held before is kept so the difference can be seen.
  it("puts the fiche's value over a different one and keeps the old value; leaves a same one alone", () => {
    const { fill, replaced } = ficheFill(offered, null, { FICHE: "77583", "FICHE CODE": " ", "SUPPLIERS NAME": "SCOOP IMANE" });
    expect(fill).toEqual({ FICHE: "76601", "FICHE CODE": "0201-0004" });
    expect(replaced).toEqual({ FICHE: "77583" });
  });
  // The bug this guards: an old test truck saved as "test-2" made every fiche with its code overwrite the chosen supplier.
  it("fills the supplier only when empty: it's worked out from earlier trucks, not printed on the fiche", () => {
    expect(ficheFill(offered, null, { "SUPPLIERS NAME": "SCOOPPADA SCOOPS" })).toEqual({
      fill: { FICHE: "76601", "FICHE CODE": "0201-0004" },
      replaced: {},
    });
    expect(ficheFill(offered, null, { "SUPPLIERS NAME": " " }).fill["SUPPLIERS NAME"]).toBe("SCOOP IMANE");
  });
  it("never fills REF., nor an Origin that isn't in Origins — that is the person's to add", () => {
    const notInOrigins = ficheOriginHint({ ...sample, subPrefecture: "", department: "", village: "AKPESSEKRO" }, ["YAMOUSSOUKRO"]);
    const { fill } = ficheFill(offered, notInOrigins, {});
    expect(fill).not.toHaveProperty("ORIGIN");
    expect(fill).not.toHaveProperty("REF.");
  });
  it("offers a town written at two levels once", () => {
    expect(yamoussoukro!.places.map((p) => p.name)).toEqual(["AKPESSEKRO", "YAMOUSSOUKRO"]);
  });
});
