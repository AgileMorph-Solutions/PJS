#!/usr/bin/env python3
"""Regenerable extractor for the client's APPLICATION VIEW workbook (Oct 2026). Reads it with openpyxl
and writes frontend/src/data/seed/applicationView.json, which backend/src/services/applicationView.ts
applies on top of the receipts the app already holds.

Source (relative to docs/Procurement/new sheets):
  ANAGROCI - Unit Warehouse - 2026 APPLICATION VIEW - SATVIK STRUCTURE.xlsx
    Delivery Plan   -> the 10 plans (what was expected, before the trucks)
    Truck Reception -> per truck: the plan it belongs to, accepted/rejected, GRN quantity, Bin, approval
    Warehouse Receiving / Dispatch / Stock Transfers -> only the Bin codes they mention (the Bin master)

What this deliberately does NOT carry:
  - The client's typed Plan Status, Reception Type, flags and Receipt Status. Those are DERIVED by the
    app from the data (contract domain/deliveryPlan.ts, receiptStatus.ts); the workbook types them by
    hand and they already disagree with its own rows (a CANCELLED plan with three arrivals). The
    backend's applicationViewParity test compares the app's derived values with the workbook's.
  - Their 25 BKT transfers. Their Dispatch / Stock Transfers rows identify the transfer's paperwork
    (fiche 51505, receipt no. 951), never the supplier Lots on the truck, so putting them on a BKT as
    lines would mean inventing the link. The dispatch data is already in the app from the original
    reports; these rows drive the parity tests instead.
  - Lot numbers and Receipt IDs. The app issues its own and keeps the real warehouse lots; the
    workbook's are compared in the parity test, never applied.
  - "Not available in 2026 source" as a funding reference. That is a placeholder, not a reference.

Trucks are matched to the receipts the app already has by (truck no., fiche no., arrival date), the same
key a person would use — and, when two loads share all three, by the weighbridge and quality readings.

It also writes backend/tests/fixtures/application-view-expected.json: what the workbook SHOWS (the cached
results of its own formulas — plan totals, BKT variances and states), for backend/tests/
applicationViewParity.test.ts to hold the app's derived values against. A spreadsheet library can't be
trusted to read those (shared formulas lose their cached result), and this one can.

Run:  python3 tools/extract-application-view.py
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1] / "docs/Procurement/new sheets"
SRC = ROOT / "ANAGROCI - Unit Warehouse - 2026 APPLICATION VIEW - SATVIK STRUCTURE.xlsx"
OUT = Path(__file__).resolve().parents[1] / "frontend/src/data/seed"
FIXTURE = Path(__file__).resolve().parents[1] / "backend/tests/fixtures/application-view-expected.json"

PLACEHOLDER_FUNDING = "not available in 2026 source"
# A Bin is a place INSIDE a store: BKE-002-BIN-012. DIRECT-001 (a truck loaded straight from the
# supplier) and spellings like BKE-001-BIN23 are real strings in the sheets, but not Bin codes.
BIN_CODE = re.compile(r"^[A-Z0-9]+-\d{3}-BIN-\d{1,3}$")


def s(v):
    return "" if v is None else str(v).strip()


def date(v):
    return v.strftime("%Y-%m-%d") if hasattr(v, "strftime") else s(v)


def num(v):
    if v is None or s(v) == "":
        return None
    f = float(v)
    return int(f) if f == int(f) else f


def fiche(v):
    return str(int(v)) if isinstance(v, float) and v == int(v) else s(v)


def table(ws):
    head = {c.value: c.column for c in ws[1] if c.value}
    for r in range(2, ws.max_row + 1):
        if ws.cell(row=r, column=1).value is None:
            continue
        yield {k: ws.cell(row=r, column=col).value for k, col in head.items()}


def bins_in(value):
    return [p.strip() for p in re.split(r"[/,;]", s(value)) if BIN_CODE.match(p.strip())]


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)

    plans = []
    for row in table(wb["Delivery Plan"]):
        funding = s(row["Purchase / Funding Reference"])
        plans.append({
            "id": s(row["Delivery Plan ID"]),
            "planningDate": date(row["Planning Date"]),
            "supplierCode": s(row["LBA Code"]),
            "supplierName": s(row["Supplier Name"]),
            "expectedOrigin": s(row["Expected Origin"]) or None,
            "destinationStore": s(row["Destination Warehouse"]) or None,
            "expectedStart": date(row["Expected Delivery Start"]),
            "expectedEnd": date(row["Expected Delivery End"]) or None,
            "expectedQuantityKg": num(row["Expected Quantity (kg)"]),
            "expectedTrucks": num(row["Expected Trucks"]),
            "fundingReference": None if funding.lower() == PLACEHOLDER_FUNDING else (funding or None),
            "planStatusRaw": s(row["Plan Status"]),
            "planningScenario": s(row["Planning Scenario"]),
            "planningBasis": s(row["Planning Basis"]) or None,
        })

    receipts = []
    for row in table(wb["Truck Reception"]):
        plan_id = s(row["Delivery Plan ID"]) or None
        rejected = s(row["Receipt Status"]).upper() == "REJECTED"
        receipts.append({
            "key": {
                "vehicleNo": s(row["Truck No"]).upper(), "fiche": fiche(row["Fiche No"]), "arrivalDate": date(row["Arrival Date"]),
                "grossKg": num(row["Gross Weight (kg)"]),
                # Two loads of one truck on one day with one fiche and no weight (rejected ones) are told apart by their readings.
                "moisture": num(row["Moisture (%)"]), "nutCount": num(row["Nut Count"]), "kor": num(row["KOR"]),
            },
            "clientReceiptId": s(row["Receipt ID"]),
            "clientLot": s(row["Lot No"]) or None,
            "clientStore": s(row["Warehouse Code"]) or None,
            # Where the original sheets say the truck was received. 10 trucks the workbook links to a Bouaké plan
            # (DP-BKE-…) were received at YAKRO FACTORY; the app won't link a truck to another site's plan, so
            # applying skips those and reports them rather than moving either the truck or the plan.
            "receptionSite": s(row["Warehouse Location"]),
            "planId": plan_id,
            "rejected": rejected,
            # The sheet's own word, verbatim: for every rejected truck it is the single word REJECT, the same
            # as the original REMARKS — a marker, not a reason. The audit says so.
            "rejectionReason": (s(row["Rejection Reason"]) or None) if rejected else None,
            "grnQuantityKg": None if rejected else num(row["GRN Quantity (kg)"]),
            "bin": s(row["Bin No"]) or None,
            "exceptionApproved": s(row["Exception Approval Status"]).upper() == "APPROVED",
        })

    # A plan's site is the one whose code is printed in its ID (DP-BKE-… → BKE), which the app resolves from the
    # Warehouse master. Checked here so a plan with some other code isn't applied to the wrong site by accident.
    codes = {p["id"].split("-")[1] for p in plans}
    if codes != {"BKE"}:
        sys.exit(f"Plans carry more than one warehouse code {sorted(codes)} — each needs its own site, not a guess.")

    bin_codes = set()
    for sheet, cols in (("Truck Reception", ["Bin No"]), ("Warehouse Receiving", ["Unloading Bin", "After Drying Bin"]), ("Dispatch", ["Bin"]), ("Stock Transfers", ["Bin No"])):
        for row in table(wb[sheet]):
            for col in cols:
                bin_codes.update(bins_in(row.get(col)))

    # What the workbook shows, for the parity test: its own cached formula results, not ours.
    wbf = openpyxl.load_workbook(SRC, data_only=True)
    expected = {
        "source": SRC.name,
        "plans": [
            {"id": s(r["Delivery Plan ID"]), "expectedQuantityKg": num(r["Expected Quantity (kg)"]), "expectedTrucks": num(r["Expected Trucks"]),
             "actualKg": num(r["Actual Received Quantity (kg)"]), "arrivals": num(r["Actual Arrivals"]), "acceptedTrucks": num(r["Accepted Trucks"]),
             "remainingKg": num(r["Remaining Quantity (kg)"]), "varianceKg": num(r["Quantity Variance (kg)"])}
            for r in table(wbf["Delivery Plan"])
        ],
        "trucks": [
            {"clientReceiptId": s(r["Receipt ID"]), "receiptStatus": s(r["Receipt Status"]), "receptionType": s(r["Reception Type"]),
             "planId": s(r["Delivery Plan ID"]) or None, "grnKg": num(r["GRN Quantity (kg)"]), "grossKg": num(r["Gross Weight (kg)"]),
             "bags": num(r["Bags Count"]), "netKg": num(r["Net Weight (kg)"])}
            for r in table(wbf["Truck Reception"])
        ],
        "transfers": [
            {"id": s(r["Transfer ID"]), "bagsDispatched": num(r["Bags Dispatched"]), "bagsReceived": num(r["Bags Received"]),
             "loadedKg": num(r["Loaded Truck Weight (kg)"]), "receivedGrossKg": num(r["Gross Weight Received (kg)"]),
             "netDispatchedKg": num(r["Net Weight Dispatched (kg)"]), "netAtArrivalKg": num(r["Net Weight at Arrival (kg)"]),
             "bagVariance": num(r["Bag Variance"]), "weightVarianceKg": num(r["Weight Variance (kg)"]), "status": s(r["Transfer Status"])}
            for r in table(wbf["Stock Transfers"])
        ],
    }
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(expected, indent=2, ensure_ascii=False) + "\n")

    out = {
        "source": SRC.name,
        "plans": plans,
        "receipts": receipts,
        "bins": sorted(bin_codes),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "applicationView.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    from collections import Counter
    print(f"plans={len(plans)} receipts={len(receipts)} bins={len(bin_codes)}")
    print("rejected:", sum(r["rejected"] for r in receipts), "| linked to a plan:", sum(1 for r in receipts if r["planId"]),
          "| received at YAKRO but linked to a Bouaké plan:", sum(1 for r in receipts if r["planId"] and r["receptionSite"] != "BOUAKE"),
          "| with GRN:", sum(1 for r in receipts if r["grnQuantityKg"] is not None), "| with a Bin:", sum(1 for r in receipts if r["bin"]))
    print("plan status as typed in the workbook:", dict(Counter(p["planStatusRaw"] for p in plans)))


if __name__ == "__main__":
    main()
