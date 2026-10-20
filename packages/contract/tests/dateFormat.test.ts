import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime, isIsoDate, parseDateInput, todayIso } from "../src/domain/dateFormat";

describe("date format", () => {
  it("writes an ISO date as DD/MM/YYYY", () => {
    expect(formatDate("2026-10-19")).toBe("19/10/2026");
    expect(formatDate("2026-02-05")).toBe("05/02/2026");
  });
  it("shows nothing for nothing, and free text exactly as it was stored", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("  ")).toBe("");
    // A *Raw workbook cell: never reinterpreted, never blanked.
    expect(formatDate("16 FEV 2026")).toBe("16 FEV 2026");
    expect(formatDate("2026-02-31")).toBe("2026-02-31");
  });
  it("takes the date of a timestamp as the person's clock reads it, and adds the time for a date-time", () => {
    const local = new Date(2026, 9, 19, 7, 5); // 19 Oct 2026, 07:05 local
    expect(formatDate(local.toISOString())).toBe("19/10/2026");
    expect(formatDateTime(local.toISOString())).toBe("19/10/2026 07:05");
    expect(formatDateTime("2026-10-19")).toBe("19/10/2026");
  });
  it("shows the timeline's own stamp and the workbook's day-first dashed dates in the same format", () => {
    expect(formatDateTime("2026-10-19 07:05")).toBe("19/10/2026 07:05");
    expect(formatDate("2026-10-19 07:05")).toBe("19/10/2026");
    expect(formatDate("13-02-2026")).toBe("13/02/2026");
    expect(formatDate("3-2-2026")).toBe("03/02/2026");
    expect(formatDate("31-02-2026")).toBe("31-02-2026"); // not a day: left as stored
  });
  it("reads what a person types, in the shown format or ISO, and rejects what is not a day", () => {
    expect(parseDateInput("19/10/2026")).toBe("2026-10-19");
    expect(parseDateInput("1/2/2026")).toBe("2026-02-01");
    expect(parseDateInput("19-10-2026")).toBe("2026-10-19");
    expect(parseDateInput("19.10.26")).toBe("2026-10-19");
    expect(parseDateInput("2026-10-19")).toBe("2026-10-19");
    expect(parseDateInput("")).toBe("");
    expect(parseDateInput("31/02/2026")).toBeNull();
    expect(parseDateInput("13/13/2026")).toBeNull();
    expect(parseDateInput("tomorrow")).toBeNull();
    expect(parseDateInput("2026-02-31")).toBeNull();
  });
  it("round-trips: what is shown parses back to what is stored", () => {
    for (const iso of ["2026-01-01", "2026-12-31", "2028-02-29"]) expect(parseDateInput(formatDate(iso))).toBe(iso);
  });
  it("knows a leap day from a non-leap one", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
  });
  it("gives today by the local clock", () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
