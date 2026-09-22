#!/usr/bin/env python3
"""
Extract the two jute ledgers that have real row-level source data, straight from the client's
workbooks with openpyxl — same approach as extract-seed.py, nothing fabricated.

  Ledger 1 (warehouse-stock)                  BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx
                                              -> 'JUTE BAGS ISSUED', header row 2, 298 data rows
  Ledger 4 (warehouse-to-warehouse-movement)  BOUAKE RCN RECEIVING at Yamoussoukro as on 9.9.2026.xlsx
                                              -> 'Bouake Stock Reciving', header row 6, 367 data rows

Ledgers 2 and 3 are deliberately NOT extracted as rows: their only source is an undated hand tally
with no transaction ids, so rows would have to be invented. Those figures come out as labelled
snapshots instead (see TALLY below).

Two rules this script follows, from ground rule §4:
  * Values are preserved as they appear. Mixed-type columns get a *Raw twin rather than coercion,
    so '44,94' and a hand-typed 'DD-MM-YYYY' date survive intact.
  * Nothing is cleaned. The negative balances, the degenerate DIFF column and the empty template
    column are all carried through; they are reported by /api/data-quality, not fixed here.

Usage:  python3 tools/extract-jute.py [--out frontend/src/data/seed/juteLedgers.json]
"""
import argparse, datetime, json, os, sys

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is required:  pip install openpyxl")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XL = os.path.join(os.path.dirname(ROOT), "flow-xl-map", "Procurement")

L1 = ("BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx", "JUTE BAGS ISSUED", 2)
L4 = ("BOUAKE RCN RECEIVING at Yamoussoukro as on 9.9.2026.xlsx", "Bouake Stock Reciving", 6)


def num(v):
    """int if it's a clean number, else None. Never guesses at a string."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return int(round(v))
    return None


def dec(v):
    """float for a numeric cell, else None — the raw text is kept separately."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    return None


def text(v):
    if v is None:
        return None
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%d")
    return str(v).strip() or None


def date_parts(v):
    """(iso_date, raw_string). A real datetime gives a date; anything else is kept verbatim."""
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%d"), None
    t = text(v)
    return (None, t) if t else (None, None)


def rows_of(path, sheet, header_row):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[sheet]
    out = []
    for i, row in enumerate(ws.iter_rows(min_row=header_row + 1), start=header_row + 1):
        vals = [c.value for c in row]
        if not any(v not in (None, "") for v in vals):
            continue
        out.append((i, vals))
    return out


def extract_l1():
    path = os.path.join(XL, L1[0])
    recs = []
    for seq, (sheet_row, v) in enumerate(rows_of(path, L1[1], L1[2]), start=1):
        iso, raw = date_parts(v[1])
        recs.append({
            "seq": seq, "sheetRow": sheet_row, "sn": num(v[0]),
            "movementDate": iso, "rawDate": raw,
            # Overloaded column: sometimes a category, sometimes a supplier name. Kept raw.
            "activitiesType": text(v[2]) or "",
            "supplierCode": text(v[3]),
            "whLocation": text(v[4]) or "",
            "truckNumber": text(v[5]), "wrNo": text(v[6]),
            "bagsIssued": num(v[7]), "bagsReceived": num(v[8]),
            # The workbook's own BALANCE. Stored, never written by the app; it genuinely goes
            # negative and the running balance is recomputed by a SQL view for comparison.
            "reportedBalance": num(v[9]),
        })
    return recs


# Column index -> (field, kind) for ledger 4's 34 real columns. juteBags.ts models only 12 of
# these for the UI form; all 34 are extracted so normalization doesn't discard 22 columns of data.
L4_COLS = [
    (0, "sn", num), (1, "receivedDate", "date"), (2, "month", text), (3, "dryUndry", text),
    (4, "idTransfer", text), (5, "truckRegistration", text), (6, "lotNo", text),
    (7, "lotDry", text), (8, "noFiche", text), (9, "ccaFicheNumber", text), (10, "binNo", text),
    (11, "damagedBags", num), (12, "newBagsUsed", num), (13, "recondition", num),
    (14, "sourceWarehouse", text), (15, "origin", text),
    (16, "bagsDispatched", num), (17, "bagsReceived", num), (18, "reportedDifference", num),
    (19, "finalBagsAfterRebagging", num), (20, "reportedDiff", num),
    (21, "laissePasserEntree", text), (22, "fullyLoadedTruckWeight", num),
    (23, "emptyTruckTareWeight", num), (24, "grossWeightReceived", num),
    (25, "netWeightAtArrival", num), (26, "netWeightDispatched", num), (27, "weightDifference", num),
    (28, "korReceived", "dec"), (29, "korDispatched", "dec"),
    (30, "moistureReceived", "dec"), (31, "moistureDispatched", "dec"),
    (32, "ncArrival", text), (33, "comment", text),
]


def extract_l4():
    path = os.path.join(XL, L4[0])
    recs = []
    for sheet_row, v in rows_of(path, L4[1], L4[2]):
        # SN is the row key; rows past the real data have no SN.
        if num(v[0]) is None:
            continue
        rec = {"sheetRow": sheet_row}
        for idx, field, kind in L4_COLS:
            val = v[idx] if idx < len(v) else None
            if kind == "date":
                iso, raw = date_parts(val)
                rec["receivedDate"], rec["rawDate"] = iso, raw
            elif kind == "dec":
                # Mixed-type: keep both the parsed number and the original text ('44,94').
                rec[field] = dec(val)
                rec[field + "Raw"] = None if isinstance(val, (int, float)) or val is None else text(val)
            else:
                rec[field] = kind(val)
        recs.append(rec)
    return recs


# The undated hand-typed tally that is the ONLY source for ledgers 2 and 3. Transcribed from
# SUPPLIER OFFLOADING - Factory warehouse 9.9.2026.xlsx -> 'JUte Bag Record', as already documented
# in juteBags.ts's flag text. Not a ledger: no dates, no transaction ids.
TALLY = [
    ("supplier-movement", "Total Issued to Supplier", 135851),
    ("supplier-movement", "Total Recondition", 21705),
    ("supplier-movement", "Total Balance", 22119),
    ("factory-production-tracking", "Issued to Drying", 10000),
    ("factory-production-tracking", "Issued to Calibrator", 33240),
    ("factory-production-tracking", "Good Bag", 25235),
    ("factory-production-tracking", "Damaged Bag", 8215),
    ("factory-production-tracking", "Bag Stiched", 6866),
    ("factory-production-tracking", "Good Bag Balance", 3675),
    ("factory-production-tracking", "Balance Bag (Damaged Bag)", 18444),
]
TALLY_SOURCE = "SUPPLIER OFFLOADING - Factory warehouse 9.9.2026.xlsx"
TALLY_SHEET = "JUte Bag Record (undated hand tally)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "frontend/src/data/seed/juteLedgers.json"))
    args = ap.parse_args()

    l1, l4 = extract_l1(), extract_l4()
    payload = {
        "warehouseStock": l1,
        "warehouseTransfers": l4,
        "tallySnapshots": [
            {"ledgerId": lid, "label": lab, "value": val, "source": TALLY_SOURCE,
             "sheet": TALLY_SHEET, "capturedAt": None}
            for lid, lab, val in TALLY
        ],
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    # Report what came out, including the known defects, so a silent change is obvious.
    run, drift, neg = 0, 0, 0
    for r in l1:
        run += (r["bagsReceived"] or 0) - (r["bagsIssued"] or 0)
        if r["reportedBalance"] is not None and r["reportedBalance"] != run:
            drift += 1
        if (r["reportedBalance"] or 0) < 0:
            neg += 1
    degen = sum(1 for r in l4 if r["reportedDiff"] is not None and r["bagsReceived"] is not None
                and r["reportedDiff"] == -r["bagsReceived"])
    print(f"ledger 1 warehouse-stock      : {len(l1)} rows | final balance {run} | "
          f"reported-vs-computed drift {drift} | negative reported {neg}")
    print(f"ledger 4 warehouse transfers  : {len(l4)} rows | degenerate DIFF {degen}/{len(l4)}")
    print(f"tally snapshots (ledgers 2,3) : {len(payload['tallySnapshots'])}")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
