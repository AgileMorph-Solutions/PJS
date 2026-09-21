#!/usr/bin/env python3
"""Regenerable seed extractor. Reads the real client workbooks and writes JSON that
frontend/src/data/seed/*.json is committed from. Re-run this and copy the output if the
source workbooks change; the app never reads .xlsx at build/runtime.

Sources (relative to this repo's ../../flow-xl-map):
  Procurement/drive-download-20260903T100404Z-1-001/Rcn Offloading Details 2026.xlsx -> OFFLOADINGS
  Procurement/Drying Report_Factory warehouse.xlsx -> FINAL DRY RCN-YAKRO-2026
"""
import json, re, random
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[2] / "flow-xl-map"
OFFLOAD_XL = ROOT / "Procurement/drive-download-20260903T100404Z-1-001/Rcn Offloading Details 2026.xlsx"
DRYING_XL = ROOT / "Procurement/Drying Report_Factory warehouse.xlsx"
OUT = Path(__file__).resolve().parents[1] / "frontend/src/data/seed"

random.seed(42)

def fmt_date(v):
    if v is None:
        return ""
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m-%d")
    return str(v).strip()

def s(v):
    return "" if v is None else str(v).strip()

def read_offloadings():
    wb = openpyxl.load_workbook(OFFLOAD_XL, data_only=True)
    ws = wb["OFFLOADINGS"]
    rows = []
    for r in range(2, ws.max_row + 1):
        sn = ws.cell(row=r, column=1).value
        if sn is None or str(sn).strip() == "S N":
            continue
        vals = [ws.cell(row=r, column=c).value for c in range(1, 29)]
        rows.append({
            "S N": s(vals[0]), "DATE OF ARRIVAL": fmt_date(vals[1]), "DATE OF OFFLOADING": fmt_date(vals[2]),
            "RM/FG": s(vals[3]), "CREDIT/CASH": s(vals[4]), "WH LOCATION": s(vals[5]), "WH NO.": s(vals[6]),
            "SUPPLIERS NAME": s(vals[7]), "LBA CODE": s(vals[8]), "VEHICLE NO.": s(vals[9]),
            "FICHE CODE": s(vals[10]), "REF.": s(vals[11]), "FICHE": s(vals[12]), "SACS": s(vals[13]),
            "GROSS WT KGS": s(vals[14]), "NET WT KGS": s(vals[15]), "BON SACS": s(vals[16]),
            "HUMID SACS": s(vals[17]), "Sacs déchirés": s(vals[18]), "Refraction": s(vals[19]),
            "PAID WT": s(vals[20]), "PRICE": s(vals[21]), "AMOUNT": s(vals[22]), "MOIS.": s(vals[23]),
            "NUT COUNT": s(vals[24]), "KOR": s(vals[25]), "FINAL KOR": s(vals[26]), "ORIGIN": s(vals[27]),
        })
    return rows

def build_masters(rows):
    warehouses = sorted({r["WH LOCATION"] for r in rows if r["WH LOCATION"]})
    bins_ = sorted({r["WH NO."] for r in rows if r["WH NO."]})
    suppliers = {}
    for r in rows:
        if r["LBA CODE"] and r["SUPPLIERS NAME"]:
            suppliers[r["LBA CODE"]] = r["SUPPLIERS NAME"]
    origins = sorted({r["ORIGIN"] for r in rows if r["ORIGIN"]})
    return warehouses, bins_, suppliers, origins

# Progress tiers determine which stages get stageData + which branch, so seeded trucks land
# on a realistic spread of statuses rather than all being "complete".
TIERS = (
    ("pending_qa", 0.12, ["n-gate", "n-verify"]),
    ("pending_unload_pass", 0.10, ["n-gate", "n-verify", "n-qfs"]),
    ("rejected", 0.06, ["n-gate", "n-verify", "n-qfs"]),
    ("unloaded", 0.14, ["n-gate", "n-verify", "n-qfs", "n-gross", "n-lot", "n-bin", "n-unload"]),
    ("grn_completed", 0.16, ["n-gate", "n-verify", "n-qfs", "n-gross", "n-lot", "n-bin", "n-unload", "n-tare", "n-netwt", "n-grn"]),
    ("in_drying", 0.10, ["n-gate", "n-verify", "n-qfs", "n-gross", "n-lot", "n-bin", "n-unload", "n-tare", "n-netwt", "n-grn", "n-stock", "n-drying"]),
    ("transferred_out", 0.10, ["n-gate", "n-verify", "n-qfs", "n-gross", "n-lot", "n-bin", "n-unload", "n-tare", "n-netwt", "n-grn", "n-stock", "n-otheract", "n-ledger", "n-xferdec"]),
    ("in_stock", 0.22, ["n-gate", "n-verify", "n-qfs", "n-gross", "n-lot", "n-bin", "n-unload", "n-tare", "n-netwt", "n-grn", "n-stock"]),
)

def pick_tier():
    x = random.random()
    acc = 0.0
    for name, weight, stages in TIERS:
        acc += weight
        if x <= acc:
            return name, stages
    return TIERS[-1][0], TIERS[-1][2]

def build_stage_data(row, stages_included, tier_name, idx):
    sd = {}
    if "n-gate" in stages_included:
        sd["n-gate"] = {
            "S N": row["S N"], "DATE OF ARRIVAL": row["DATE OF ARRIVAL"], "RM/FG": row["RM/FG"],
            "CREDIT/CASH": row["CREDIT/CASH"], "WH LOCATION": row["WH LOCATION"], "WH NO.": row["WH NO."],
            "VEHICLE NO.": row["VEHICLE NO."],
        }
    if "n-verify" in stages_included:
        sd["n-verify"] = {
            "SUPPLIERS NAME": row["SUPPLIERS NAME"], "LBA CODE": row["LBA CODE"],
            "FICHE CODE": row["FICHE CODE"], "REF.": row["REF."], "FICHE": row["FICHE"],
            "ORIGIN": row["ORIGIN"],
        }
    if "n-qfs" in stages_included:
        sd["n-qfs"] = {
            "MOIS. (moisture)": row["MOIS."], "NUT COUNT": row["NUT COUNT"], "KOR": row["KOR"],
            "FINAL KOR": row["FINAL KOR"],
        }
    if "n-gross" in stages_included:
        sd["n-gross"] = {"GROSS WT KGS": row["GROSS WT KGS"]}
    if "n-lot" in stages_included:
        sd["n-lot"] = {
            "Lot Number": f"LOT-{2026}{idx:04d}", "Truck reference": row["VEHICLE NO."],
            "Assigned by (Warehouse Team)": "Warehouse Team", "Date/time assigned": row["DATE OF OFFLOADING"] or row["DATE OF ARRIVAL"],
        }
    if "n-bin" in stages_included:
        sd["n-bin"] = {
            "Bin Number": row["WH NO."] or "BKE-001", "Linked Lot Number(s)": f"LOT-{2026}{idx:04d}",
            "Basis for allocation (moisture / quality / KOR / space)": "Moisture within range, space available",
            "Finalised (same day / next day)": "Same day",
        }
    if "n-unload" in stages_included:
        sd["n-unload"] = {
            "DATE OF OFFLOADING": row["DATE OF OFFLOADING"] or row["DATE OF ARRIVAL"], "SACS (bags)": row["SACS"],
            "BON SACS (good bags)": row["BON SACS"], "HUMID SACS (damp bags)": row["HUMID SACS"],
            "Sacs déchirés (torn bags)": row["Sacs déchirés"], "Refraction": row["Refraction"],
        }
    if "n-netwt" in stages_included:
        sd["n-netwt"] = {"NET WT KGS": row["NET WT KGS"], "PAID WT": row["PAID WT"]}
    if "n-grn" in stages_included:
        sd["n-grn"] = {"PRICE": row["PRICE"], "AMOUNT": row["AMOUNT"]}
    if "n-stock" in stages_included:
        sd["n-stock"] = {"Warehouse stock ledger entry": "Posted", "Current stock balance": row["NET WT KGS"]}
    if "n-drying" in stages_included:
        sd["n-drying"] = {
            "Decision (Direct to drying / Warehouse → Drying)": "Direct to drying",
            "Moisture % — before drying": row["MOIS."],
        }
    if "n-otheract" in stages_included:
        sd["n-otheract"] = {"Movement between locations": "Moved to central bin"}
    if "n-ledger" in stages_included:
        sd["n-ledger"] = {"Activity type (discharge, weight, reconditioning, destacking, drying, triage, sèches)": "weight", "Performed by": "Warehouse Team"}
    if "n-xferdec" in stages_included:
        sd["n-xferdec"] = {"Decision (Stays / Transfers)": "Transfers", "Driven by (space at warehouse)": "Space at unit warehouse"}
    return sd

def build_branches(tier_name):
    if tier_name == "rejected":
        return {"n-qfs": "fail"}
    b = {}
    if tier_name != "pending_qa":
        b["n-qfs"] = "pass"
    if tier_name == "in_drying":
        b["n-drying"] = "direct"
    if tier_name == "transferred_out":
        b["n-xferdec"] = "transfer"
    return b

def main():
    rows = read_offloadings()
    warehouses, bins_, suppliers, origins = build_masters(rows)
    sample = random.sample(rows, min(50, len(rows)))
    receipts = []
    for i, row in enumerate(sample, start=1):
        tier_name, stages_included = pick_tier()
        receipt_id = f"REC-2026-{i:04d}"
        sd = build_stage_data(row, stages_included, tier_name, i)
        branches = build_branches(tier_name)
        note = "Failed QFS — moisture/KOR out of spec" if tier_name == "rejected" else None
        receipts.append({
            "id": receipt_id, "source": "imported", "arrivalDate": row["DATE OF ARRIVAL"],
            "supplierName": row["SUPPLIERS NAME"], "lbaCode": row["LBA CODE"], "vehicleNo": row["VEHICLE NO."],
            "warehouse": row["WH LOCATION"], "origin": row["ORIGIN"],
            "lotNo": sd.get("n-lot", {}).get("Lot Number", ""), "binNo": sd.get("n-bin", {}).get("Bin Number", ""),
            "stageData": sd, "branches": branches,
            "timeline": [{"status": "arrived", "at": row["DATE OF ARRIVAL"], "note": note}],
        })
    receipts.sort(key=lambda r: r["arrivalDate"])

    drying_jobs = []
    try:
        wb = openpyxl.load_workbook(DRYING_XL, data_only=True)
        ws = wb["FINAL DRY RCN-YAKRO-2026"]
        for r in range(3, min(ws.max_row + 1, 40)):
            sno = ws.cell(row=r, column=1).value
            if sno is None:
                continue
            vals = [ws.cell(row=r, column=c).value for c in range(1, 12)]
            if not any(vals):
                continue
            drying_jobs.append({
                "id": f"DRY-{s(vals[0]) or r}", "date": fmt_date(vals[1]), "warehouse": s(vals[2]),
                "bin": s(vals[3]), "lotNo": s(vals[4]), "ficheNo": s(vals[5]), "status": s(vals[6]) or "In progress",
                "dryType": s(vals[7]), "destination": s(vals[8]),
            })
    except Exception as e:
        print("drying extract skipped:", e)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "receipts.json").write_text(json.dumps(receipts, indent=2, ensure_ascii=False))
    (OUT / "suppliers.json").write_text(json.dumps(
        [{"code": k, "name": v} for k, v in sorted(suppliers.items())], indent=2, ensure_ascii=False))
    (OUT / "warehouses.json").write_text(json.dumps(warehouses, indent=2, ensure_ascii=False))
    (OUT / "bins.json").write_text(json.dumps(bins_, indent=2, ensure_ascii=False))
    (OUT / "origins.json").write_text(json.dumps(origins, indent=2, ensure_ascii=False))
    (OUT / "dryingJobs.json").write_text(json.dumps(drying_jobs, indent=2, ensure_ascii=False))
    print(f"receipts={len(receipts)} suppliers={len(suppliers)} warehouses={warehouses} bins={bins_} drying_jobs={len(drying_jobs)}")
    from collections import Counter
    print("tier spread (approx, by branches/stageData):", Counter(
        "rejected" if t["branches"].get("n-qfs") == "fail" else
        "transferred_out" if t["branches"].get("n-xferdec") == "transfer" else
        "in_drying" if "n-drying" in t["stageData"] else
        "in_stock" if "n-stock" in t["stageData"] else
        "grn_completed" if "n-grn" in t["stageData"] else
        "unloaded" if "n-unload" in t["stageData"] else
        "pending_unload" if "n-qfs" in t["stageData"] else
        "pending_qa"
        for t in receipts))

if __name__ == "__main__":
    main()
