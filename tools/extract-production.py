#!/usr/bin/env python3
"""
Extracts every real Production workbook in docs/Production/ into
frontend/src/data/seed/productionData.json — the production twin of extract-jute.py (declarative
per-table column config, *Raw twins where a column is genuinely mixed-type, a printed defect
report), not extract-seed.py (there is no progress/status to fabricate here — production tables are
event logs, not a receipt lifecycle).

Two rules, from ground rule §4:
  * Nothing is fabricated. A blank cell stays blank. Composite cells ("ANG26E01,E02", a bin written
    "ANA-03B/10/16") and known defects (5. Calibrated RCN Silos's Batch No/BIN No column shift,
    14. Final Output Analysis Report's fraction-not-percent columns) are stored exactly as the
    workbook has them — never split, never renormalised.
  * Column order is read off @anagroci/contract's own field dictionary (dumped to JSON once by the
    caller, see PRODUCTION_FIELD_MAP_JSON below), so this script cannot silently drift from the
    contract package's own column->label mapping.

Two tables are deliberately curated subsets of their real sheet, not the full column set — kept
that way on purpose (see packages/contract/src/data/productionStages.ts's history):
  shelling-frequency-sample  real sheet has 9 columns (incl. Week); only 7 are modeled
  shelling-line-run          real sheet has 17 columns; only 10 are modeled
Both get an explicit column-index list below rather than a contiguous range.

Usage:  python3 tools/extract-production.py [--out frontend/src/data/seed/productionData.json]
"""
import argparse, datetime, json, os, sys, subprocess

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is required:  pip install openpyxl")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs", "Production")
CONTRACT_DIR = os.path.join(ROOT, "packages", "contract")


def load_field_map():
    """Dumps PRODUCTION_FIELD_MAP straight from the contract package — the single source of truth
    for every table's (label -> col) mapping, so this script can never invent a column name the
    contract doesn't already have."""
    script = (
        "import { PRODUCTION_FIELD_MAP } from '@anagroci/contract/generated/productionFieldMap';"
        "console.log(JSON.stringify(PRODUCTION_FIELD_MAP));"
    )
    result = subprocess.run(
        ["npx", "tsx", "-e", script], cwd=CONTRACT_DIR, capture_output=True, text=True, check=True
    )
    return json.loads(result.stdout)


FIELD_MAP = load_field_map()

# ── Per-table sheet location ────────────────────────────────────────────────────────────────────
# (file, sheet, header_row, data_start_row, columns)
#   columns: "contiguous:N" -> range(N, N+len(fields))   (0-based openpyxl column index)
#   columns: explicit list of 0-based indices, len must equal len(fields), for curated subsets.
TABLE_SHEETS = {
    "btm-receipt":               ("1. RCN Receipts.xlsx", "1. RCN Receipts", 2, 3, "contiguous:0"),
    "btm-input-quality":         ("2. Input RCN Quality report.xlsx", "2. Input RCN Quality report", 2, 3, "contiguous:0"),
    "btm-tally-row":              ("19.RCN Receipts Tally Sheet.xlsx", "Online", 2, 3, "contiguous:0"),
    "calibration-run":           ("4. Calibration Process report.xlsx", "4.Calibration Process report", 3, 4, "contiguous:1"),
    "silos-stock-row":           ("5. Calibrated RCN Silos Stock report.xlsx", "5. Calibrated RCN Report", 3, 4, "contiguous:1"),
    "wholes-manual-calibration": ("24. Wholes Manual Calibration.xlsx", "Sheet2", 3, 4, "contiguous:0"),
    "cooking-run":               ("6. Cooking Process Report.xlsx", "Sheet1", 3, 4, "contiguous:1"),
    "shelling-run":              ("7. Shelling process Report.xlsx", "Sheet1", 3, 4, "contiguous:1"),
    "shelling-machine-sample":   ("13. Shelling Machine Quality Reports.xlsx", "Sheet1", 2, 3, "contiguous:0"),
    "shelling-frequency-sample": ("21.Shelling Frequency Machine Report.xlsx", "Online ", 2, 3, [1, 3, 4, 5, 6, 7, 8]),
    "shelling-line-run":         ("23. Shelling Line wise Processing Data.xlsx", "Sheet1", 2, 3, [3, 4, 5, 8, 9, 12, 13, 14, 15, 16]),
    "shell-waste-sample":        ("11. Shell Waste Sample Report.xlsx", "Report", 3, 4, "contiguous:1"),
    "kernel-quality-sample":     ("12. Shelled Kernels Quality Report.xlsx", "Meyer Quality Report", 2, 3, "contiguous:1"),
    "borma-run":                 ("8.Borma Process Report.xlsx", "Sheet1", 3, 4, "contiguous:1"),
    "borma-trolley-row":         ("18. Borma Loss Tally Sheet.xlsx", "Borma Loss Tally Sheet", 2, 3, "contiguous:0"),
    "borma-machine-cycle":       ("20. Borma Machine Monitoring report.xlsx", "Online", 2, 3, "contiguous:0"),
    "final-output-sample":       ("14. Final Output Analysis Report.xlsx", "Sheet1", 3, 4, "contiguous:1"),
    "packing-record":            ("Packing Traceability  FG Aging Report.xlsx", "Packing Traceability", 2, 3, "contiguous:1"),
    "shell-dispatch":            ("16. Shell Dispatch Tracker.xlsx", "Shell Sales", 7, 8, "contiguous:0"),
    "waste-dispatch":            ("15. Waste Management Dispatch Tracker.xlsx", "Waste management Tracker", 5, 6, "contiguous:0"),
    "boiler-consumption":        ("21. Boiler Consumption.xlsx", "Boiler Consumption", 2, 3, "contiguous:1"),
    "offloading-bin-report":     ("Theoretical Export Yield Prediction - Anagroci.xlsx", "Offloading BIN Report", 3, 4, "contiguous:1"),
    "wip-stock-report":          ("Daily production report.xlsx", "10.WIP Stock Report", 2, 3, "contiguous:13"),
}
# peeling-performance is handled separately (pyxlsb, not openpyxl) — see extract_peeling().


def resolve_columns(spec, n_fields):
    if isinstance(spec, list):
        return spec
    start = int(spec.split(":")[1])
    return list(range(start, start + n_fields))


def cellstr(v):
    """Every value on the wire is a string — mirrors extract-jute.py's text()/s() coercion."""
    if v is None:
        return ""
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return str(v).strip()


def is_blank_row(vals):
    return not any(v not in (None, "") for v in vals)


def extract_table(table_id):
    spec = FIELD_MAP[table_id]
    fields = spec["fields"]  # [{label, col}]
    file_, sheet, header_row, data_start, colspec = TABLE_SHEETS[table_id]
    path = os.path.join(DOCS, file_)
    if not os.path.exists(path):
        print(f"  ! {table_id}: source file not found — {file_}")
        return []
    cols = resolve_columns(colspec, len(fields))
    if len(cols) != len(fields):
        print(f"  ! {table_id}: column count mismatch ({len(cols)} cols vs {len(fields)} fields) — skipped")
        return []

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    if sheet not in wb.sheetnames:
        print(f"  ! {table_id}: sheet {sheet!r} not found in {file_} (has: {wb.sheetnames})")
        wb.close()
        return []
    ws = wb[sheet]

    # Header sanity check — same discipline the backend's headerCheck.ts applies, so a
    # workbook-shape change is caught loudly rather than silently misreading columns.
    header_vals = [c for c in next(ws.iter_rows(min_row=header_row, max_row=header_row, values_only=True))]
    mismatches = []
    for i, col_idx in enumerate(cols):
        found = cellstr(header_vals[col_idx]) if col_idx < len(header_vals) else ""
        expected = fields[i]["label"]
        if found != expected:
            mismatches.append((expected, found))
    if mismatches:
        print(f"  ! {table_id}: header mismatch ({len(mismatches)}/{len(fields)}) — extracting anyway, verify column mapping:")
        for exp, fnd in mismatches[:3]:
            print(f"      expected {exp!r}, found {fnd!r}")

    out = []
    for row in ws.iter_rows(min_row=data_start, values_only=True):
        vals = [row[c] if c < len(row) else None for c in cols]
        if is_blank_row(vals):
            continue
        out.append({f["col"]: cellstr(v) for f, v in zip(fields, vals)})
    wb.close()
    return out


def extract_peeling():
    """peeling-performance: the one .xlsb source. pyxlsb, not openpyxl — see UPLOAD_GUIDE.md for
    why the live-upload importer doesn't cover this file (exceljs, the backend's reader, can't read
    .xlsb at all) while this one-off seed extraction can."""
    try:
        from pyxlsb import open_workbook
    except ImportError:
        print("  ! peeling-performance: pyxlsb not installed — skipped (pip install pyxlsb)")
        return []
    path = os.path.join(DOCS, "Manual Peeling Individual peformance.xlsb")
    if not os.path.exists(path):
        print("  ! peeling-performance: source .xlsb not found")
        return []
    fields = FIELD_MAP["peeling-performance"]["fields"]
    out = []
    with open_workbook(path) as wb:
        if "Online Sheet" not in wb.sheets:
            print(f"  ! peeling-performance: sheet 'Online Sheet' not found (has: {wb.sheets})")
            return []
        with wb.get_sheet("Online Sheet") as sh:
            rows = list(sh.rows())
    header = [c.v for c in rows[2]] if len(rows) > 2 else []  # row 3 (0-indexed row 2)
    mismatches = sum(1 for f, h in zip(fields, header) if cellstr(h) != f["label"])
    if mismatches:
        print(f"  ! peeling-performance: {mismatches}/{len(fields)} header labels differ — extracting anyway")
    for row in rows[3:]:
        vals = [c.v for c in row[: len(fields)]]
        if is_blank_row(vals):
            continue
        rec = {}
        for f, v in zip(fields, vals):
            # Excel serial date (pyxlsb doesn't auto-convert) — the Date column is field 0.
            if f["col"] == "date" and isinstance(v, (int, float)) and v > 1000:
                rec[f["col"]] = (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(v))).isoformat()
            else:
                rec[f["col"]] = cellstr(v)
        out.append(rec)
    return out


def derive_headers(data):
    """Observed-union header tables — computed from what the row-level data actually contains,
    never fabricated. Mirrors seed.ts's masters pattern: first-writer-wins, provenance kept via the
    print warning on a genuine disagreement (never a silent pick)."""
    btm_bin: dict[str, str] = {}
    btm_conflicts = []
    for table_id in ("btm-receipt", "btm-input-quality", "calibration-run", "btm-tally-row"):
        for row in data.get(table_id, []):
            btm, bin_ = row.get("btmNo", "").strip(), row.get("binNo", "").strip()
            if not btm or not bin_:
                continue
            if btm in btm_bin and btm_bin[btm] != bin_:
                btm_conflicts.append((btm, btm_bin[btm], bin_))
                continue
            btm_bin.setdefault(btm, bin_)
    if btm_conflicts:
        print(f"  ! {len(btm_conflicts)} BTM(s) disagree on destination Bin across sheets — kept the first observed, reported here, NOT silently picked:")
        for btm, first, second in btm_conflicts[:5]:
            print(f"      BTM {btm}: {first!r} vs {second!r}")

    lot_bin: dict[str, str] = {}
    for row in data.get("cooking-run", []):
        lot, bin_ = row.get("lotNo", "").strip(), row.get("binNo", "").strip()
        if lot and bin_:
            lot_bin.setdefault(lot, bin_)

    all_bins: set[str] = set(btm_bin.values()) | set(lot_bin.values())
    for table_id, spec in FIELD_MAP.items():
        bin_col = "binNo" if spec["spine"] in ("bin",) else None
        for row in data.get(table_id, []):
            for key in ("binNo",):
                v = row.get(key, "").strip() if isinstance(row.get(key), str) else ""
                if v:
                    all_bins.add(v)

    btm_intakes = [{"btmNo": b, "binNo": n} for b, n in sorted(btm_bin.items())]
    lots = [{"lotNo": l, "binNo": n} for l, n in sorted(lot_bin.items())]
    bins_ = sorted(all_bins)
    return btm_intakes, lots, bins_


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "frontend/src/data/seed/productionData.json"))
    args = ap.parse_args()

    data = {}
    print("Extracting production tables from docs/Production/ ...")
    for table_id in TABLE_SHEETS:
        rows = extract_table(table_id)
        data[table_id] = rows
        print(f"  {table_id:28s} {len(rows):6d} rows")
    data["peeling-performance"] = extract_peeling()
    print(f"  {'peeling-performance':28s} {len(data['peeling-performance']):6d} rows")

    btm_intakes, lots, bins_ = derive_headers(data)

    out_dir = os.path.dirname(args.out)
    os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    headers_path = os.path.join(out_dir, "productionHeaders.json")
    with open(headers_path, "w", encoding="utf-8") as f:
        json.dump({"btmIntakes": btm_intakes, "lots": lots, "bins": bins_}, f, ensure_ascii=False, indent=1)

    total_rows = sum(len(v) for v in data.values())
    print()
    print(f"wrote {args.out}  ({total_rows} total rows across {len(data)} tables)")
    print(f"wrote {headers_path}  ({len(btm_intakes)} BTMs, {len(lots)} Lots, {len(bins_)} Bins observed)")

    # Known real defects, surfaced not fixed — a self-check that they're still present verbatim.
    composite_lots = sum(1 for r in data.get("final-output-sample", []) if "," in r.get("lotNo", ""))
    composite_bins = sum(1 for r in data.get("borma-trolley-row", []) if "/" in r.get("binNo", ""))
    shifted_batch = sum(1 for r in data.get("silos-stock-row", []) if r.get("batchNo", "").isdigit())
    print(f"defects preserved verbatim: composite lot cells={composite_lots}, composite bin cells={composite_bins}, silo batch/bin shift rows={shifted_batch}")


if __name__ == "__main__":
    main()
