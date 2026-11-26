#!/usr/bin/env python3
"""Derives the usual range of every typed warehouse number from the client's real 2026 workbooks (user, 26 Nov 2026: "take a
reference from the Excel files, reasonable ranges, not random odd ones"). Writes:

  packages/contract/src/data/fieldRanges.ts   the ranges the forms warn outside of (generated: do not hand-edit)
  docs/FIELD_RANGES.md                        the same ranges as a table, with where each comes from

One rule for every measure, so no range is picked by eye:
  1. Pool every real reading of the measure from every sheet that records it (a blank, and a 0 where 0 means "not
     recorded", is left out).
  2. Keep the middle 98 %: the 1st to the 99th percentile. A one-off slip (nut count 1,777, moisture 91 %) can't stretch
     the range, and 98 % of real readings fall inside it.
  3. Widen both ends by 10 % of that spread, for the readings a new season brings.
  4. Round outward to a round step: 1, 2 or 5 × a power of ten, about a tenth of the spread (moisture to 1 %, kg to
     1,000 kg…). Never below the measure's physical floor (0).
A value outside the range is only WARNED about: every plausible value still saves (Nov 2026, the team).

Run from the repo root:  python tools/derive-field-ranges.py   (add --check to fail when the committed files are stale).
"""
import math
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
SHEETS = ROOT / "docs/Procurement/new sheets"
OUT_TS = ROOT / "packages/contract/src/data/fieldRanges.ts"
OUT_MD = ROOT / "docs/FIELD_RANGES.md"

# (file, sheet, header row) — the header row as the importers read it; data starts on the row after.
TR = ("ANAGROCI DATA PROCUREMENT 2026.xlsx", "Truck Reception", 1)
WR = ("ANAGROCI DATA PROCUREMENT 2026.xlsx", "Warehouse Receiving", 1)
DB = ("ANAGROCI DATA PROCUREMENT 2026.xlsx", "Drying Batch", 1)
AL = ("ANAGROCI DATA PROCUREMENT 2026.xlsx", "Warehouse activity Ledger", 1)
DI = ("Suppliers Offloading_Bouake Warehouse Report.xlsx", "DISCHARGEMENT", 4)
CH = ("Dispatch RCN from Bouake Warehouse Report.xlsx", "CHARGEMENT", 4)
YK = ("Bouake RCN Receiving at Factory Report.xlsx", "Bouake Stock Reciving", 6)

SHORT = {TR: "Truck Reception", WR: "Warehouse Receiving", DB: "Drying Batch", AL: "Warehouse activity Ledger",
         DI: "Bouaké offloading (DISCHARGEMENT)", CH: "Bouaké dispatch (CHARGEMENT)", YK: "Yakro receiving"}


def col(sheet, column, zero_blank=False, kind=None):
    """One column of a sheet: `column` is 1-based; `kind` keeps only activity-ledger rows of that activity type."""
    return {"sheet": sheet, "column": column, "zero_blank": zero_blank, "kind": kind}


# Each measure: its key in the contract, what people call it, its unit, and every column that records it.
# zero_blank=True where a 0 is "not recorded" (a weight, a reading); False where 0 is a real count (no damp bags).
MEASURES = [
    # Readings of a truck's or lot's sample (Quality, reception from a Unit warehouse, dispatch, transfer lot)
    ("moisture", "Moisture", "%", [col(TR, 22, True), col(WR, 62, True), col(WR, 81, True), col(DI, 46, True), col(DI, 62, True), col(CH, 36, True), col(YK, 31, True), col(YK, 32, True)]),
    ("nutCount", "Nut count", "nuts per kg", [col(TR, 23, True), col(WR, 63, True), col(WR, 82, True), col(DI, 47, True), col(DI, 63, True), col(CH, 37, True), col(YK, 33, True)]),
    ("kor", "KOR", "lbs", [col(TR, 24, True), col(WR, 56, True), col(WR, 74, True), col(DI, 41, True), col(DI, 57, True), col(CH, 31, True), col(YK, 29, True), col(YK, 30, True)]),
    # The cut test: grams of each part of a 1,000 g sample
    ("goodKernelG", "Good kernel", "g", [col(WR, 52, True), col(WR, 70, True), col(DI, 37, True), col(DI, 53, True), col(CH, 27, True), col(DB, 35, True)]),
    ("immatureG", "Immature", "g", [col(WR, 53), col(WR, 71), col(DI, 38), col(DI, 54), col(CH, 28), col(DB, 36)]),
    ("spottedG", "Spotted", "g", [col(WR, 54), col(WR, 72), col(DI, 39), col(DI, 55), col(CH, 29), col(DB, 37)]),
    ("rejectionG", "Rejection", "g", [col(WR, 48), col(WR, 65), col(DI, 33), col(DI, 49), col(CH, 23), col(DB, 34)]),
    ("voidG", "Void", "g", [col(WR, 49), col(WR, 67), col(DI, 34), col(DI, 50), col(CH, 24), col(DB, 39)]),
    ("oilG", "Oil", "g", [col(WR, 50), col(WR, 68), col(DI, 35), col(DI, 51), col(CH, 25), col(DB, 33)]),
    ("shellG", "Shell", "g", [col(WR, 64, True), col(WR, 83, True), col(DI, 48, True), col(DI, 64, True), col(CH, 38, True), col(DB, 38, True)]),
    # Weights and bags of a truck
    ("truckLoadKg", "Truck load (gross weight)", "kg", [col(TR, 13, True), col(WR, 39, True), col(DI, 25, True), col(YK, 25, True)]),
    ("tareKg", "Empty truck (tare)", "kg", [col(YK, 24, True)]),
    # Only Yakro weighs whole trucks, and only the Unit warehouse's semi-trailers (186, loaded 48–74 t): a supplier's lighter
    # truck would fall outside that. So the loaded truck's range is the sum of its two measured parts (see SUMS).
    ("loadedTruckKg", "Loaded truck at the weighbridge", "kg", [col(YK, 23, True)]),
    ("truckBags", "Bags on a truck", "bags", [col(TR, 12, True), col(WR, 38, True), col(DI, 20, True), col(YK, 17, True), col(YK, 18, True)]),
    ("goodBags", "Good bags", "bags", [col(TR, 15, True), col(WR, 29, True), col(DI, 16, True)]),
    ("dampBags", "Damp bags", "bags", [col(TR, 16), col(WR, 30), col(DI, 17)]),
    ("tornBags", "Torn bags", "bags", [col(TR, 17), col(WR, 31), col(DI, 18)]),
    ("reconditionedBags", "Reconditioned bags", "bags", [col(WR, 26, True), col(YK, 14, True)]),
    ("refractionKg", "Refraction", "kg", [col(TR, 18), col(WR, 44), col(DI, 30)]),
    ("priceCfa", "Price", "CFA per kg", [col(TR, 20, True)]),
    ("grnKg", "GRN weight", "kg", [col(WR, 41, True), col(DI, 27, True)]),
    # Moving RCN between warehouses
    ("lineBags", "Bags of one lot on a truck", "bags", [col(CH, 18, True)]),
    ("lineKg", "Weight of one lot on a truck", "kg", [col(CH, 19, True)]),
    ("arrivalDamagedBags", "Damaged bags at arrival", "bags", [col(YK, 12)]),
    ("newJuteBags", "New jute bags used", "bags", [col(YK, 13, True)]),
    # Drying
    ("dryingKg", "Weight issued to / back from drying", "kg", [col(DB, 21, True), col(DB, 26, True)]),
    ("dryingBags", "Bags issued to / back from drying", "bags", [col(DB, 46, True), col(DB, 47, True)]),
    ("moistureBeforeDrying", "Moisture before drying", "%", [col(DB, 27, True)]),
    ("moistureAfterDrying", "Moisture after drying", "%", [col(DB, 30, True)]),
    # Warehouse activities
    ("rebaggedBags", "Re-bagging", "bags", [col(AL, 5, True, "RECOND")]),
    ("destackedBags", "Destacking", "bags", [col(AL, 5, True, "DESTA")]),
]


# A measure whose range is the sum of two others' (min + min, max + max), its own readings kept only for the table.
SUMS = {"loadedTruckKg": ("tareKg", "truckLoadKg")}


def num(v):
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(" ", "").replace(" ", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def pct(xs, p):
    k = (len(xs) - 1) * p / 100
    f = math.floor(k)
    c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)


def nice_step(x):
    """1, 2 or 5 × a power of ten, the smallest at least x."""
    if x <= 0:
        return 1
    e = 10 ** math.floor(math.log10(x))
    for m in (1, 2, 5, 10):
        if m * e >= x - 1e-9:
            return m * e
    return 10 * e


_cache = {}


def rows_of(sheet):
    if sheet not in _cache:
        file, name, header = sheet
        wb = openpyxl.load_workbook(SHEETS / file, read_only=True, data_only=True)
        _cache[sheet] = list(wb[name].iter_rows(values_only=True))[header:]
    return _cache[sheet]


def values(spec):
    out = []
    for r in rows_of(spec["sheet"]):
        if spec["kind"] and spec["kind"] not in str(r[1] if len(r) > 1 else "").upper():
            continue
        v = num(r[spec["column"] - 1]) if spec["column"] - 1 < len(r) else None
        if v is None or (spec["zero_blank"] and v == 0) or v < 0:
            continue
        out.append(v)
    return out


def derive(cols):
    xs = sorted(v for c in cols for v in values(c))
    p1, p99 = pct(xs, 1), pct(xs, 99)
    span = max(p99 - p1, 1e-9)
    step = nice_step(span / 10)
    lo = max(0.0, math.floor((p1 - span / 10) / step) * step)
    hi = math.ceil((p99 + span / 10) / step) * step
    return {"min": round(lo, 6), "max": round(hi, 6), "n": len(xs), "p1": round(p1, 2), "p99": round(p99, 2),
            "lowest": round(xs[0], 2), "highest": round(xs[-1], 2), "outside": sum(1 for v in xs if v < lo or v > hi)}


def fmt(x):
    return f"{x:,.0f}" if float(x).is_integer() else f"{x:,.2f}".rstrip("0").rstrip(".")


def main():
    results = []
    for key, name, unit, cols in MEASURES:
        r = derive(cols)
        sources = sorted({SHORT[c["sheet"]] for c in cols})
        results.append((key, name, unit, r, sources))
    by_key = {k: r for k, _, _, r, _ in results}
    for key, (a, b) in SUMS.items():
        r = by_key[key]
        r["min"], r["max"] = by_key[a]["min"] + by_key[b]["min"], by_key[a]["max"] + by_key[b]["max"]
        r["sum_of"] = (a, b)

    ts = ['/**',
          ' * GENERATED by tools/derive-field-ranges.py from the client\'s 2026 workbooks: do not edit by hand. Re-run the script',
          ' * when the workbooks change. The usual range of each typed warehouse number: the middle 98 % of real readings (1st to',
          ' * 99th percentile), widened by 10 % of that spread and rounded outward to a round step. A value outside only warns',
          ' * (domain/fieldRules.ts usual ranges); the table with where each comes from is docs/FIELD_RANGES.md.',
          ' */',
          'export interface UsualRange {',
          '  min: number;',
          '  max: number;',
          '  unit: string;',
          '  /** How many real readings it was derived from. */',
          '  n: number;',
          '}',
          '',
          'export const USUAL_RANGES = {']
    for key, name, unit, r, _ in results:
        ts.append(f'  /** {name}: {r["n"]:,} readings, 1st–99th percentile {fmt(r["p1"])}–{fmt(r["p99"])} {unit}. */')
        ts.append(f'  {key}: {{ min: {r["min"]:g}, max: {r["max"]:g}, unit: "{unit}", n: {r["n"]} }},')
    ts += ['} as const satisfies Record<string, UsualRange>;', '', 'export type UsualRangeKey = keyof typeof USUAL_RANGES;', '']

    md = ['# Usual ranges of the warehouse numbers',
          '',
          '_Generated by `tools/derive-field-ranges.py` from the client\'s 2026 workbooks. Do not edit by hand._',
          '',
          'Each range is derived the same way: every real reading of the measure, from every sheet that records it; the middle 98 %',
          '(1st to 99th percentile); widened by 10 % of that spread; rounded outward to a round step. A value outside the range',
          'shows a warning on the form ("outside the usual range"). It still saves: only an impossible value (not a number,',
          'moisture over 100 %, more than the 1,000 g sample) is refused.',
          '',
          '| Measure | Usual range | Real readings | Middle 98 % | Lowest – highest seen | Outside the range | From |',
          '|---|---|---|---|---|---|---|']
    for key, name, unit, r, sources in results:
        how = f' (= {r["sum_of"][0]} + {r["sum_of"][1]})' if "sum_of" in r else ""
        md.append(f'| {name} (`{key}`) | **{fmt(r["min"])} – {fmt(r["max"])} {unit}**{how} | {r["n"]:,} | {fmt(r["p1"])} – {fmt(r["p99"])} | '
                  f'{fmt(r["lowest"])} – {fmt(r["highest"])} | {"-" if "sum_of" in r else r["outside"]} | {", ".join(sources)} |')
    md.append('')

    new_ts, new_md = "\n".join(ts), "\n".join(md)
    if "--check" in sys.argv:
        stale = [p for p, text in ((OUT_TS, new_ts), (OUT_MD, new_md)) if not p.exists() or p.read_text(encoding="utf-8") != text]
        if stale:
            sys.exit(f"stale: {', '.join(str(p) for p in stale)} — run python tools/derive-field-ranges.py")
        print("field ranges up to date")
        return
    OUT_TS.write_text(new_ts, encoding="utf-8", newline="\n")
    OUT_MD.write_text(new_md, encoding="utf-8", newline="\n")
    print(new_md)


if __name__ == "__main__":
    main()
