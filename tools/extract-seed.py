#!/usr/bin/env python3
"""Regenerable seed extractor. Reads the real client workbooks and writes JSON that
frontend/src/data/seed/*.json is committed from. Re-run this and copy the output if the
source workbooks change; the app never reads .xlsx at build/runtime.

Sources (relative to this repo's docs/Procurement/new sheets):
  ANAGROCI DATA PROCUREMENT 2026.xlsx -> Truck Reception (986 real rows)
  ANAGROCI DATA PROCUREMENT 2026.xlsx -> Suppliers (58 real rows)

Mirrors backend/src/domain/imports/truckReception.ts's parser exactly — same stage-presence rule,
same stage field labels, same column mapping — so this seed is what the real importer would also
produce from the identical file. Two real columns from the OLD "OFFLOADINGS" sheet this replaces
have no equivalent here at all: "RM/FG" and "REF." are simply never written (see
truckReception.ts's own header comment; also see stages.ts, where both fields now carry v: "").
"""
import json
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[1] / "docs/Procurement/new sheets"
CONSOLIDATED_XL = ROOT / "ANAGROCI DATA PROCUREMENT 2026.xlsx"
OUT = Path(__file__).resolve().parents[1] / "frontend/src/data/seed"


def fmt_date(v):
    if v is None:
        return ""
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m-%d")
    return str(v).strip()


def s(v):
    return "" if v is None else str(v).strip()


def read_truck_reception():
    wb = openpyxl.load_workbook(CONSOLIDATED_XL, data_only=True)
    ws = wb["Truck Reception"]
    rows = []
    for r in range(2, ws.max_row + 1):
        no = ws.cell(row=r, column=1).value
        if no is None:
            continue
        vals = [ws.cell(row=r, column=c).value for c in range(1, 29)]
        # CRITICAL: column 10 is "fiche code", column 11 is "fiche offloading no" — the real FICHE
        # join key (StageVerifyDocs.fiche) is column 11, NOT column 10. Verified directly against
        # stages.ts's own documented sample truck (fiche offloading no = 72515 on the first real
        # row) before trusting this mapping.
        rows.append({
            "S N": s(vals[0]), "DATE OF ARRIVAL": fmt_date(vals[1]), "DATE OF OFFLOADING": fmt_date(vals[2]),
            "CREDIT/CASH": s(vals[3]), "WH LOCATION": s(vals[4]), "WH NO.": s(vals[5]),
            "SUPPLIERS NAME": s(vals[6]), "LBA CODE": s(vals[7]), "VEHICLE NO.": s(vals[8]),
            "FICHE CODE": s(vals[9]), "FICHE": s(vals[10]), "SACS": s(vals[11]),
            "GROSS WT KGS": s(vals[12]), "NET WT KGS": s(vals[13]), "BON SACS": s(vals[14]),
            "HUMID SACS": s(vals[15]), "Sacs déchirés": s(vals[16]), "Refraction": s(vals[17]),
            "PAID WT": s(vals[18]), "PRICE": s(vals[19]), "AMOUNT": s(vals[20]), "MOIS.": s(vals[21]),
            "NUT COUNT": s(vals[22]), "KOR": s(vals[23]), "FINAL KOR": s(vals[24]), "ORIGIN": s(vals[25]),
            "REMARKS": s(vals[26]), "WEEK": s(vals[27]),
        })
    return rows


def read_suppliers_sheet():
    """The dedicated "Suppliers" sheet (58 rows: No / supplier name / supplier code) is the
    canonical master now — see backend/src/domain/imports/suppliersMaster.ts, which treats it the
    same way. Returns {code: name}."""
    wb = openpyxl.load_workbook(CONSOLIDATED_XL, data_only=True)
    ws = wb["Suppliers"]
    out = {}
    for r in range(2, ws.max_row + 1):
        name = s(ws.cell(row=r, column=2).value)
        code = s(ws.cell(row=r, column=3).value)
        if code:
            out[code] = name
    return out


def build_masters(rows, suppliers_sheet):
    warehouses = sorted({r["WH LOCATION"] for r in rows if r["WH LOCATION"]})
    bins_ = sorted({r["WH NO."] for r in rows if r["WH NO."]})
    origins = sorted({r["ORIGIN"] for r in rows if r["ORIGIN"]})

    # Union of the dedicated Suppliers sheet (canonical) and codes only ever seen on a receipt row
    # (LBA CODE + SUPPLIERS NAME) — neither side silently drops a real code the other doesn't have.
    # The Suppliers sheet's own name wins where both exist, since that sheet IS the master.
    suppliers = dict(suppliers_sheet)
    derived_only = []
    for r in rows:
        if r["LBA CODE"] and r["LBA CODE"] not in suppliers:
            suppliers[r["LBA CODE"]] = r["SUPPLIERS NAME"] or r["LBA CODE"]
            derived_only.append(r["LBA CODE"])
    if derived_only:
        print(f"  {len(derived_only)} supplier code(s) appear on a receipt but not in the Suppliers sheet: {sorted(set(derived_only))[:10]}{'...' if len(derived_only) > 10 else ''}")
    sheet_only = [c for c in suppliers_sheet if not any(r["LBA CODE"] == c for r in rows)]
    if sheet_only:
        print(f"  {len(sheet_only)} supplier code(s) from the Suppliers sheet never appear on a receipt row (kept anyway — they're real master data).")

    return warehouses, bins_, suppliers, origins


def build_stage_data(row):
    """Mirrors truckReception.ts's parse() field-for-field: a stage exists if and only if at
    least one of its mapped fields is non-empty in this row (one deliberate exception: n-gate always
    exists; until Oct 2026 an empty n-tare did too — the tare is now a field of n-gross). No stage is ever fabricated, no branch is ever set — this is exactly what
    a real upload through the app's own importer would produce from this same file."""
    sd = {
        "n-gate": {
            "S N": row["S N"], "DATE OF ARRIVAL": row["DATE OF ARRIVAL"],
            "CREDIT/CASH": row["CREDIT/CASH"], "WH LOCATION": row["WH LOCATION"], "WH NO.": row["WH NO."],
            "VEHICLE NO.": row["VEHICLE NO."], "REMARKS": row["REMARKS"], "WEEK": row["WEEK"],
        },
    }

    def has(v):
        return bool(v.strip())

    def any_(*vs):
        return any(has(v) for v in vs)

    if any_(row["SUPPLIERS NAME"], row["LBA CODE"]):
        sd["n-verify"] = {
            "SUPPLIERS NAME": row["SUPPLIERS NAME"], "LBA CODE": row["LBA CODE"],
            "FICHE CODE": row["FICHE CODE"], "FICHE": row["FICHE"], "ORIGIN": row["ORIGIN"],
        }
    if any_(row["MOIS."], row["NUT COUNT"], row["KOR"], row["FINAL KOR"]):
        sd["n-qfs"] = {
            "MOIS. (moisture)": row["MOIS."], "NUT COUNT": row["NUT COUNT"], "KOR": row["KOR"],
            "FINAL KOR": row["FINAL KOR"],
        }
    if has(row["GROSS WT KGS"]):
        sd["n-gross"] = {"GROSS WT KGS": row["GROSS WT KGS"]}
    if any_(row["SACS"], row["BON SACS"], row["HUMID SACS"], row["Sacs déchirés"], row["Refraction"], row["DATE OF OFFLOADING"]):
        sd["n-unload"] = {
            "DATE OF OFFLOADING": row["DATE OF OFFLOADING"], "SACS (bags)": row["SACS"],
            "BON SACS (good bags)": row["BON SACS"], "HUMID SACS (damp bags)": row["HUMID SACS"],
            "Sacs déchirés (torn bags)": row["Sacs déchirés"], "Refraction": row["Refraction"],
        }
    if any_(row["NET WT KGS"], row["PAID WT"]):
        sd["n-netwt"] = {"NET WT KGS": row["NET WT KGS"], "PAID WT": row["PAID WT"]}
    if any_(row["PRICE"], row["AMOUNT"]):
        sd["n-grn"] = {"PRICE": row["PRICE"], "AMOUNT": row["AMOUNT"]}
    return sd


def main():
    rows = read_truck_reception()
    suppliers_sheet = read_suppliers_sheet()
    warehouses, bins_, suppliers, origins = build_masters(rows, suppliers_sheet)

    # Every real row, not a sample — the old 50-row demo sample (random.seed(42), TIERS/pick_tier)
    # is gone entirely. It fabricated a status spread (including a "rejected" branch) with no basis
    # in any real column; ground rule #4 forbids exactly this. Every receipt below gets only the
    # stages the sheet's own data actually supports, with no branch ever set on any of them.
    receipts = []
    for i, row in enumerate(sorted(rows, key=lambda r: r["DATE OF ARRIVAL"]), start=1):
        receipt_id = f"REC-2026-{i:04d}"
        sd = build_stage_data(row)
        receipts.append({
            "id": receipt_id, "source": "imported", "arrivalDate": row["DATE OF ARRIVAL"],
            "supplierName": row["SUPPLIERS NAME"], "lbaCode": row["LBA CODE"], "vehicleNo": row["VEHICLE NO."],
            "warehouse": row["WH LOCATION"], "origin": row["ORIGIN"],
            "lotNo": "", "binNo": "",
            "stageData": sd, "branches": {},
            "timeline": [{"status": "arrived", "at": row["DATE OF ARRIVAL"], "note": None}],
        })

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "receipts.json").write_text(json.dumps(receipts, indent=2, ensure_ascii=False))
    (OUT / "suppliers.json").write_text(json.dumps(
        [{"code": k, "name": v} for k, v in sorted(suppliers.items())], indent=2, ensure_ascii=False))
    (OUT / "warehouses.json").write_text(json.dumps(warehouses, indent=2, ensure_ascii=False))
    (OUT / "bins.json").write_text(json.dumps(bins_, indent=2, ensure_ascii=False))
    (OUT / "origins.json").write_text(json.dumps(origins, indent=2, ensure_ascii=False))
    # dryingJobs.json is INTENTIONALLY not written any more — no new-sheets importer produces
    # DryingJob rows (see backend/src/services/dryingBatches.ts's header comment: DryingBatch is
    # the replacement source, and it's a different table). If the file still exists from a
    # previous run, remove it so the seed can't accidentally resurrect stale demo data.
    stale = OUT / "dryingJobs.json"
    if stale.exists():
        stale.unlink()
        print("removed stale dryingJobs.json — no importer produces this any more")

    print(f"receipts={len(receipts)} suppliers={len(suppliers)} warehouses={warehouses} bins={len(bins_)} origins={len(origins)}")
    from collections import Counter
    print("stage-presence spread (informational only — no status is fabricated):", Counter(
        "n-grn" if "n-grn" in r["stageData"] else
        "n-netwt" if "n-netwt" in r["stageData"] else
        "n-unload" if "n-unload" in r["stageData"] else
        "n-gross" if "n-gross" in r["stageData"] else
        "n-qfs" if "n-qfs" in r["stageData"] else
        "n-verify" if "n-verify" in r["stageData"] else
        "n-gate-only"
        for r in receipts))


if __name__ == "__main__":
    main()
