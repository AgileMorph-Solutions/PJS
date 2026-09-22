// AUTO-TRANSCRIBED from the Jute bag management panel in ../../../flow-xl-map/NewProcurement.html
// Ledger 1's real columns/sample rows come from BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx →
// JUTE BAGS ISSUED (229 real rows), read directly with openpyxl — not fabricated.
// Ledger 4's real columns/sample rows come from BOUAKE RCN RECEIVING at Yamoussoukro as on
// 9.9.2026.xlsx → Bouake Stock Reciving (367 real rows), also read directly with openpyxl.
// Ledgers 2 and 3 are still backed only by a hand-tallied, undated summary block on
// SUPPLIER OFFLOADING - Factory warehouse 9.9.2026.xlsx → JUte Bag Record — real numbers, but not
// a row-per-event ledger yet, so their columns stay "new" (see each ledger's flag for the figures).
import type { JuteLedger } from "../types/stage.js";

export const juteLedgers: JuteLedger[] = [
  {
    id: "warehouse-stock",
    title: "1. Warehouse stock — now backed by a real workbook",
    file: "BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx",
    sheet: "JUTE BAGS ISSUED · 10 columns · 229 rows",
    flag:
      'ACTIVITIES TYPE is overloaded — sometimes a process category ("JUTE BAGS PURCHASED/UNLOADINGS", "REBAGGING DURING UNLOADING/DRYING/LOADING/STACKING"), sometimes a supplier name. The running BALANCE goes negative from row 195 onward, down to −11,027 by the last row — a real data-quality signal worth raising with the client, not assumed away. No good/damaged/repairable condition split exists anywhere in this sheet.',
    columns: [
      { label: "S N", real: true , col: "sn"},
      { label: "Date", real: true , col: "movementDate"},
      { label: "Activities type", real: true , col: "activitiesType"},
      { label: "Supplier code", real: true , col: "supplierCode"},
      { label: "WH location", real: true , col: "whLocation"},
      { label: "Truck number", real: true , col: "truckNumber"},
      { label: "W/R No.", real: true , col: "wrNo"},
      { label: "Bags issued", real: true , col: "bagsIssued"},
      { label: "Bags received", real: true , col: "bagsReceived"},
      { label: "Balance", real: true , col: "reportedBalance"},
      { label: "Good bags available", real: false , col: "goodBagsAvailable"},
      { label: "Completely damaged/discarded", real: false , col: "completelyDamaged"},
      { label: "Damaged/repairable", real: false , col: "damagedRepairable"},
    ],
    sampleRows: [
      {
        "S N": "1",
        Date: "2026-01-13",
        "Activities type": "JUTE BAGS PURCHASED/UNLOADINGS",
        "Supplier code": "",
        "WH location": "BOUAKE",
        "Truck number": "7270HL01",
        "W/R No.": "453",
        "Bags issued": "",
        "Bags received": "30000",
        Balance: "30000",
      },
      {
        "S N": "12",
        Date: "2026-02-11",
        "Activities type": "CAPCD SCOOPS",
        "Supplier code": "LBA-010-CAP",
        "WH location": "BOUAKE",
        "Truck number": "5978-GX-01",
        "W/R No.": "",
        "Bags issued": "3000",
        "Bags received": "",
        Balance: "329000",
      },
      {
        "S N": "37",
        Date: "2026-02-24",
        "Activities type": "TRANSFFER TO YAMOUSSOUKRO",
        "Supplier code": "",
        "WH location": "BOUAKE",
        "Truck number": "558-PQ-01",
        "W/R No.": "544",
        "Bags issued": "26625",
        "Bags received": "",
        Balance: "240906",
      },
    ],
  },
  {
    id: "supplier-movement",
    title: "2. Supplier movement",
    file: "SUPPLIER OFFLOADING - Factory warehouse 9.9.2026.xlsx",
    sheet: "JUte Bag Record · per-supplier discharge totals + an undated hand tally, not a dated ledger",
    flag:
      'The raw rows already exist in ledger 1\'s real sheet (ACTIVITIES TYPE holding a supplier name, e.g. "CAPCD SCOOPS", with Supplier code = the same LBA code captured at Verify supplier documents) but aren\'t yet rolled up into a per-supplier running balance. This workbook also has a per-supplier "Bag Discharged" total for every LBA/DIS code (e.g. SCAAMT COOP CA 54,212; COP JAVA SCOOP 11,902 — 187 suppliers listed), plus, further down the same sheet, a hand-typed summary with no dates or transaction IDs that tracks exactly this ledger\'s numbers as one-off running totals: "Total Issued to Supplier" 135,851, "Reccondition"/"Total Recondition" 21,705, "Total Balance" 22,119. So the concepts are captured on paper today — just not as a per-supplier dated log with a running balance, which is what the columns below assume.',
    columns: [
      { label: "Bags issued to supplier", real: false , col: "bagsIssuedToSupplier"},
      { label: "Returned through RCN deliveries", real: false , col: "returnedViaDeliveries"},
      { label: "Pending/balance with supplier", real: false , col: "pendingWithSupplier"},
      { label: "Damaged", real: false , col: "damaged"},
      { label: "Reusable/reconditionable", real: false , col: "reusable"},
    ],
  },
  {
    id: "factory-production-tracking",
    title: "3. Factory/Production tracking",
    file: "SUPPLIER OFFLOADING - Factory warehouse 9.9.2026.xlsx",
    sheet: "JUte Bag Record · same undated hand tally as ledger 2",
    flag:
      'The same undated summary block that backs ledger 2 also carries this ledger\'s numbers: "Issued to Drying" 10,000; "Issued to Calibrator" 33,240 / "Received from Calibrator"; a good-vs-damaged split at that stage, "Good Bag" 25,235 vs "Damaged Bag" 8,215; "Bag Stiched" (repaired and put back into rotation) 6,866; and an overall "Good Bag Balance" 3,675 vs "Balance Bag (Damaged Bag)" 18,444. That maps roughly onto Good bags recovered / Completely damaged / Partially damaged (repair) below — but again as one static tally with no date or transaction ID, not the row-per-event ledger these columns assume.',
    columns: [
      { label: "Issued to Production", real: false , col: "issuedToProduction"},
      { label: "Good bags recovered", real: false , col: "goodBagsRecovered"},
      { label: "Completely damaged", real: false , col: "completelyDamaged"},
      { label: "Partially damaged (repair)", real: false , col: "partiallyDamaged"},
      { label: "Returned to warehouse", real: false , col: "returnedToWarehouse"},
      { label: "Closing balance", real: false , col: "closingBalance"},
    ],
  },
  {
    id: "warehouse-to-warehouse-movement",
    title: "4. Warehouse-to-warehouse movement — now backed by a real workbook",
    file: "BOUAKE RCN RECEIVING at Yamoussoukro as on 9.9.2026.xlsx",
    sheet: "Bouake Stock Reciving · 367 real rows",
    description:
      "A transfer reduces the source warehouse's stock and increases the destination's, recorded as its own movement (e.g. Warehouse A → Warehouse B).",
    flag:
      'This sheet is literally titled "Stock transfer receipt" and is the Yamoussoukro-side receiving log for exactly the Bouaké transfers ledger 1 only shows as an outgoing deduction (e.g. its 26,625-bag "TRANSFFER TO YAMOUSSOUKRO" row on 2026-02-24). Every one of the 367 rows here is BOUAKE → Yamoussoukro (the "Transfer -Bouake" column is a constant "BOUAKE"; there is no other source warehouse in the data yet) — "Origin" is the RCN\'s upstream supply town (29 of them, e.g. MANKONO, NIAKARA), not a warehouse. DAMAGED BAG (92/367 rows) and NEW JUTE BAG USED (85/367) are real but sparse; RECONDITION is filled in only 6/367 rows. DIFF is always exactly −(Received Bags) in all 367 filled rows — a redundant/likely-broken formula column, not independent data. FINAL BAGS AFTER REBAGGING W/H exists as a header but is empty in all 459 rows of the sheet (including the 92 beyond row 367) — a template column nobody fills in.',
    columns: [
      { label: "SN", real: true , col: "sn"},
      { label: "Date", real: true , col: "receivedDate"},
      { label: "Truck registration", real: true , col: "truckRegistration"},
      { label: "LOT NO", real: true , col: "lotNo"},
      { label: "BIN NO.", real: true , col: "binNo"},
      { label: "Origin", real: true , col: "origin"},
      { label: "Bags Dispatched From Bouake", real: true , col: "bagsDispatched"},
      { label: "Received Bags", real: true , col: "bagsReceived"},
      { label: "Diffrence in Bag at Receiving", real: true , col: "reportedDifference"},
      { label: "Damaged Bag", real: true , col: "damagedBags"},
      { label: "New Jute Bag Used", real: true , col: "newBagsUsed"},
      { label: "Recondition", real: true , col: "recondition"},
    ],
    sampleRows: [
      {
        SN: "1",
        Date: "2026-03-18",
        "Truck registration": "7957GN01/ 3599KV01",
        "LOT NO": "3",
        "BIN NO.": "BIN-02B",
        Origin: "MANKONO",
        "Bags Dispatched From Bouake": "590",
        "Received Bags": "618",
        "Diffrence in Bag at Receiving": "28",
        "Damaged Bag": "23",
        "New Jute Bag Used": "11",
        Recondition: "",
      },
      {
        SN: "2",
        Date: "2026-03-18",
        "Truck registration": "1796GC01/ 3922BB04",
        "LOT NO": "2",
        "BIN NO.": "BIN-007",
        Origin: "NIAKARA",
        "Bags Dispatched From Bouake": "574",
        "Received Bags": "574",
        "Diffrence in Bag at Receiving": "0",
        "Damaged Bag": "21",
        "New Jute Bag Used": "51",
        Recondition: "",
      },
      {
        SN: "208",
        Date: "2026-07-09",
        "Truck registration": "AA718FY01/2275LG01",
        "LOT NO": "209",
        "BIN NO.": "BIN-018",
        Origin: "BOUAKE",
        "Bags Dispatched From Bouake": "470",
        "Received Bags": "465",
        "Diffrence in Bag at Receiving": "-5",
        "Damaged Bag": "14",
        "New Jute Bag Used": "",
        Recondition: "40",
      },
    ],
  },
];

export const juteReconciliationRule =
  "opening + receipts + transfers in − issues − damaged/discarded − transfers out = closing stock. Every movement traces to Warehouse → Supplier/Department → Activity → Quantity → Movement Type → Responsible Person/Team → Date, and links back to the Truck/Lot/RCN delivery where applicable. Ledger 1 already approximates this with its running Balance column; ledgers 2–4 still need to be split out of it.";

export const juteFlowTouchpoints =
  "step 7 (Unload) is where bag counts are actually checked, updating the Warehouse and Supplier ledgers; the transfer decision at the bottom is where a warehouse-to-warehouse bag movement would be triggered alongside any RCN transfer.";
