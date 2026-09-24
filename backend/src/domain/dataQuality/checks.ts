/**
 * The check registry. Each check returns one aggregate Finding, or null when clean.
 *
 * Counts in the comments are what was measured against the real workbooks and seed data at the
 * time of writing — they double as expectations for tests/dataQuality.test.ts.
 */
import type { Check } from "./types.js";
import { balanceDriftRows, negativeBalanceRows, transferFlagRows } from "../juteBalance.js";
import { STAGE_FIELD_MAP } from "@anagroci/contract/generated/stageFieldMap";

export const CHECKS: Check[] = [
  {
    id: "rejected_without_reason",
    async run({ prisma }) {
      const failed = await prisma.receiptBranch.findMany({
        where: { stageId: "n-qfs", branchId: "fail" }, select: { receiptId: true },
      });
      if (!failed.length) return null;
      const withReason = await prisma.stageRejection.findMany({
        where: { receiptId: { in: failed.map((f) => f.receiptId) }, reason: { not: null } },
        select: { receiptId: true },
      });
      const have = new Set(withReason.map((r) => r.receiptId));
      const missing = failed.map((f) => f.receiptId).filter((id) => !have.has(id));
      if (!missing.length) return null;
      return {
        id: "rejected_without_reason", severity: "critical",
        title: "Rejected trucks with no recorded reason",
        entity: "Receipt", affectedCount: missing.length, sampleIds: missing.slice(0, 5),
        evidence:
          "Doc §3 requires a rejected truck to persist with Status = Rejected AND a reason. These " +
          "receipts were imported already rejected with no reason in the source sheet. The API " +
          "rejects new reasonless rejections (422); these are historical and are reported, not invented.",
      };
    },
  },
  {
    id: "stage_present_but_empty",
    async run({ prisma }) {
      const entries = await prisma.stageEntry.findMany({ select: { receiptId: true, stageId: true } });
      const empty: string[] = [];
      for (const [stageId, spec] of Object.entries(STAGE_FIELD_MAP)) {
        const ids = entries.filter((e) => e.stageId === stageId).map((e) => e.receiptId);
        if (!ids.length) continue;
        const delegate = spec.model.charAt(0).toLowerCase() + spec.model.slice(1);
        const rows: any[] = await (prisma as any)[delegate].findMany({ where: { receiptId: { in: ids } } });
        const byId = new Map(rows.map((r) => [r.receiptId, r]));
        for (const id of ids) {
          const row = byId.get(id);
          const anyValue = row && spec.fields.some((f) => {
            const v = row[f.col];
            return v !== null && v !== undefined && String(v).trim() !== "";
          });
          if (!anyValue) empty.push(`${id}/${stageId}`);
        }
      }
      if (!empty.length) return null;
      return {
        id: "stage_present_but_empty", severity: "warning",
        title: "Stage reached but every field is blank",
        entity: "StageEntry", affectedCount: empty.length, sampleIds: empty.slice(0, 5),
        evidence:
          "deriveStatus() treats the PRESENCE of a stage as progress, regardless of content, and the " +
          "form writes a field the moment it is touched — so typing and deleting one character in a " +
          "system stage advances the status permanently. Preserved deliberately (the migration is " +
          "behaviour-preserving) and reported here rather than silently changed.",
      };
    },
  },
  {
    id: "tare_never_recorded",
    async run({ prisma }) {
      const total = await prisma.receipt.count();
      if (!total) return null;
      const withTare = await prisma.stageTareWeight.count({ where: { tareWtKgs: { not: null, notIn: [""] } } });
      if (withTare === total) return null;
      return {
        id: "tare_never_recorded", severity: "warning",
        title: "Tare weight is never captured",
        entity: "StageTareWeight", affectedCount: total - withTare, sampleIds: [],
        evidence:
          "The OFFLOADINGS sheet has no Tare column — only Gross and the resulting Net — so the tare " +
          "reading is lost today. This matters because stages.ts documents Net = Gross − Tare, but " +
          "see net_uses_bag_count_not_tare: the data says otherwise.",
      };
    },
  },
  {
    id: "net_uses_bag_count_not_tare",
    async run({ prisma }) {
      const rows = await prisma.receipt.findMany({
        select: {
          id: true,
          gross: { select: { grossWtKgsNum: true } },
          netwt: { select: { netWtKgsNum: true } },
          unload: { select: { sacsNum: true } },
        },
      });
      const matches = rows.filter((r) => {
        const g = r.gross?.grossWtKgsNum, n = r.netwt?.netWtKgsNum, s = r.unload?.sacsNum;
        if (!g || !n || !s) return false;
        return Math.abs(Number(g) - Number(s) - Number(n)) < 0.5;
      });
      if (!matches.length) return null;
      return {
        id: "net_uses_bag_count_not_tare", severity: "critical",
        title: "Net weight is Gross − bag count, not Gross − Tare",
        entity: "StageNetWeight", affectedCount: matches.length, sampleIds: matches.slice(0, 5).map((r) => r.id),
        evidence:
          "stages.ts's n-netwt note says 'Net = Gross − Tare, less refraction'. On every receipt where " +
          "all three values exist, NET WT KGS = GROSS WT KGS − SACS (the bag count), exactly. " +
          "PAID WT = NET − Refraction likewise. Net is therefore NOT computed server-side: doing so " +
          "would overwrite real imported values with a formula the data contradicts. Needs the client " +
          "to confirm which rule is correct.",
      };
    },
  },
  {
    id: "jute_balance_drift",
    async run() {
      const rows = await balanceDriftRows();
      if (!rows.length) return null;
      return {
        id: "jute_balance_drift", severity: "critical",
        title: "Reported jute balance disagrees with its own arithmetic",
        entity: "JuteWarehouseMovement", affectedCount: rows.length,
        sampleIds: rows.slice(0, 5).map((r) => `seq ${r.seq}`),
        evidence:
          "The workbook's BALANCE column vs the running sum of (received − issued) computed by the " +
          "jute_warehouse_movement_balance view. This is 0 on the imported data, so a non-zero count " +
          "here means a row was entered whose balance does not follow — a standing regression guard.",
      };
    },
  },
  {
    id: "jute_balance_negative",
    async run() {
      const rows = await negativeBalanceRows();
      if (!rows.length) return null;
      return {
        id: "jute_balance_negative", severity: "warning",
        title: "Warehouse jute balance goes negative",
        entity: "JuteWarehouseMovement", affectedCount: rows.length,
        sampleIds: rows.slice(0, 5).map((r) => `seq ${r.seq}`),
        evidence:
          "The running balance in BOUAKE WAREHOUSE JUTE BAGS MOVEMENT REPORT.xlsx turns negative and " +
          "reaches −11,027 by the last row. The arithmetic is internally consistent, so this is not a " +
          "formula bug — it means issues exceed recorded receipts, i.e. bag receipts are being " +
          "under-recorded. Preserved verbatim; a real question for the client.",
      };
    },
  },
  {
    id: "ledger4_diff_degenerate",
    async run() {
      const rows = await transferFlagRows();
      const bad = rows.filter((r) => r.diff_is_degenerate);
      if (!bad.length) return null;
      return {
        id: "ledger4_diff_degenerate", severity: "warning",
        title: "Ledger 4's DIFF column is a broken formula",
        entity: "JuteWarehouseTransferReceipt", affectedCount: bad.length,
        sampleIds: bad.slice(0, 5).map((r) => `SN ${r.sn}`),
        evidence:
          "DIFF equals exactly −(Received Bags) on every filled row — it carries no independent " +
          "information. Distinct from 'Diffrence in Bag at Receiving', which IS meaningful. Stored " +
          "verbatim rather than dropped (that would lose client data) or generated (that would " +
          "enshrine the bug).",
      };
    },
  },
  {
    id: "origin_not_in_master",
    async run({ prisma }) {
      // The seeder adds every observed origin to the master, so an orphan can't exist by
      // construction — provenance is what identifies the ones the curated master never had.
      const added = await prisma.origin.findMany({
        where: { source: { not: "seed/origins.json" } }, select: { name: true },
      });
      if (!added.length) return null;
      return {
        id: "origin_not_in_master", severity: "info",
        title: "Transfer origins missing from the origins master",
        entity: "Origin", affectedCount: added.length,
        sampleIds: added.slice(0, 5).map((o) => o.name),
        evidence:
          "Origin here is the RCN's upstream supply town, not a warehouse. These values appear in the " +
          "transfer sheet but not in the origins master — including at least one literal " +
          "'Not Mentiond '. Kept as a soft reference so no real row is dropped.",
      };
    },
  },
  {
    id: "bin_not_in_master",
    async run({ prisma }) {
      // Same as origins: the master is the observed union, so provenance is the signal.
      const added = await prisma.bin.findMany({
        where: { source: { not: "seed/bins.json" } }, select: { code: true, source: true },
      });
      if (!added.length) return null;
      return {
        id: "bin_not_in_master", severity: "warning",
        title: "Bin codes from disjoint namespaces",
        entity: "Bin", affectedCount: added.length, sampleIds: added.slice(0, 5).map((b) => b.code),
        evidence:
          "The workbooks use two unrelated bin namespaces — Bouaké's BKE-00x and Yakro's BIN-0xx — " +
          "because they are two different physical sites, not two spellings of one. No mapping is " +
          "invented; bin stays a soft reference and the orphans are listed here.",
      };
    },
  },
  {
    id: "bin_allocated_without_lot",
    async run({ prisma }) {
      // Stage tables relate to Receipt, not to each other, so this joins through the receipt.
      const rows = await prisma.receipt.findMany({
        where: { bin: { binNumber: { not: null, notIn: [""] } } },
        select: { id: true, lot: { select: { lotNumber: true } } },
      });
      const orphans = rows.filter((r) => !(r.lot?.lotNumber ?? "").trim());
      if (!orphans.length) return null;
      return {
        id: "bin_allocated_without_lot", severity: "critical",
        title: "Stock is in a Bin with no Lot Number to trace it by",
        entity: "StageBinAllocation", affectedCount: orphans.length,
        sampleIds: orphans.slice(0, 5).map((r) => r.id),
        evidence:
          "The confirmed rule is that a Lot Number is assigned first and the Bin allocated after, " +
          "because one Bin mixes several Lots and the Lot is the only thing keeping truck-level " +
          "traceability. The OFFLOADINGS sheet has no Lot column at all, so every imported receipt " +
          "has a Bin but no Lot — which is exactly the traceability gap the n-lot stage was added to " +
          "close. The API blocks this for new writes (422); these are historical.",
      };
    },
  },
  {
    id: "lot_namespace_conflict",
    async run({ prisma }) {
      const [lots, dry] = await Promise.all([
        prisma.stageLotAssignment.findMany({ where: { lotNumber: { not: null } }, select: { lotNumber: true } }),
        prisma.dryingJob.findMany({ select: { lotNo: true } }),
      ]);
      const a = new Set(lots.map((l) => l.lotNumber!).filter(Boolean));
      const b = new Set(dry.map((d) => d.lotNo).filter(Boolean));
      if (!a.size || !b.size) return null;
      const overlap = [...b].filter((x) => a.has(x));
      if (overlap.length) return null;
      return {
        id: "lot_namespace_conflict", severity: "critical",
        title: "Receipt lots and drying-job lots share no keys",
        entity: "StageLotAssignment", affectedCount: b.size, sampleIds: [...b].slice(0, 5),
        evidence:
          "Zero of the drying jobs' lot numbers match any receipt's Lot Number — they are different " +
          "identifier spaces (the drying lots match ledger 4's integer LOT NO instead). Until the " +
          "client confirms the real lot namespace, no Lot entity is created and lot stays a soft " +
          "reference. Note ledger 4's LOT NO itself contains duplicates, which would contradict " +
          "'one truck = one Lot, always'.",
      };
    },
  },
  {
    id: "transfer_out_undercounted",
    async run({ prisma }) {
      const [outRows, inRows] = await Promise.all([
        prisma.juteWarehouseMovement.findMany({
          where: { OR: [{ activitiesType: { contains: "TRANSFF", mode: "insensitive" } }, { activitiesType: { contains: "TRANSFER", mode: "insensitive" } }] },
          select: { seq: true, bagsIssued: true },
        }),
        prisma.juteWarehouseTransferReceipt.count(),
      ]);
      if (!inRows || !outRows.length) return null;
      if (outRows.length >= inRows) return null;
      const bagsOut = outRows.reduce((n, r) => n + (r.bagsIssued ?? 0), 0);
      return {
        id: "transfer_out_undercounted", severity: "critical",
        title: "Outbound transfers are recorded far less often than inbound receipts",
        entity: "JuteWarehouseMovement", affectedCount: inRows - outRows.length, sampleIds: [],
        evidence:
          `Ledger 1 records ${outRows.length} transfer-out rows (${bagsOut.toLocaleString()} bags) while ` +
          `ledger 4 records ${inRows} inbound transfer receipts for the same Bouaké -> Yamoussoukro ` +
          "flow. The two sides cannot be reconciled as-is. This comparison is impossible in the " +
          "client's current sheets and is the clearest argument for the four linked ledgers.",
      };
    },
  },
  {
    id: "ledger1_date_mixed_type",
    async run({ prisma }) {
      const rows = await prisma.juteWarehouseMovement.findMany({
        where: { rawDate: { not: null } }, select: { seq: true, rawDate: true },
      });
      if (!rows.length) return null;
      return {
        id: "ledger1_date_mixed_type", severity: "info",
        title: "The DATE column mixes real dates with hand-typed text",
        entity: "JuteWarehouseMovement", affectedCount: rows.length,
        sampleIds: rows.slice(0, 5).map((r) => `seq ${r.seq} = "${r.rawDate}"`),
        evidence:
          "Most DATE cells are real dates, but these were typed as text in DD-MM-YYYY form. They are " +
          "stored in rawDate verbatim rather than being reinterpreted — a text '13-01-2026' is " +
          "unambiguous here, but guessing at date order is how real dates get silently corrupted. " +
          "They display as written.",
      };
    },
  },
  {
    id: "activities_type_overloaded",
    async run({ prisma }) {
      const rows = await prisma.juteWarehouseMovement.findMany({
        where: { supplierCode: { not: null } }, select: { seq: true, activitiesType: true },
      });
      if (!rows.length) return null;
      const distinct = [...new Set(rows.map((r) => r.activitiesType))];
      return {
        id: "activities_type_overloaded", severity: "info",
        title: "ACTIVITIES TYPE holds supplier names as well as movement categories",
        entity: "JuteWarehouseMovement", affectedCount: distinct.length, sampleIds: distinct.slice(0, 5),
        evidence:
          "One column carries two different kinds of value: a process category on purchase/rebagging " +
          "rows, a supplier name on issue-to-supplier rows. Kept raw in activitiesType; activityCategory " +
          "holds our derived reading, so neither interpretation destroys the other.",
      };
    },
  },
  {
    id: "warehouse_alias_inferred",
    async run({ prisma }) {
      const rows = await prisma.warehouseAlias.findMany({ where: { provenance: "inferred" } });
      if (!rows.length) return null;
      return {
        id: "warehouse_alias_inferred", severity: "warning",
        title: "Warehouse aliases inferred, not confirmed",
        entity: "WarehouseAlias", affectedCount: rows.length,
        sampleIds: rows.map((r) => `${r.alias} -> ${r.warehouseName}`),
        evidence:
          "The drying workbook names its warehouse 'ANAGROCI-01', which matches no entry in the " +
          "warehouse master. The mapping to the Yakro factory warehouse is inferred from the file and " +
          "sheet names only — the client has not stated it. Recorded with provenance and surfaced here " +
          "for confirmation rather than applied silently.",
      };
    },
  },
  {
    id: "ledger_has_no_row_level_source",
    async run({ prisma }) {
      const [supplier, production, snaps] = await Promise.all([
        prisma.juteSupplierMovement.count(),
        prisma.juteProductionMovement.count(),
        prisma.juteTallySnapshot.count(),
      ]);
      const empty = [supplier === 0 && "supplier-movement", production === 0 && "factory-production-tracking"].filter(Boolean) as string[];
      if (!empty.length) return null;
      return {
        id: "ledger_has_no_row_level_source", severity: "warning",
        title: "Ledgers 2 and 3 have no row-level source data",
        entity: "JuteSupplierMovement / JuteProductionMovement", affectedCount: empty.length,
        sampleIds: empty,
        evidence:
          `The only source for these two ledgers is an undated, hand-typed tally block — real numbers ` +
          `(${snaps} captured as JuteTallySnapshot) but no dates and no transaction ids. Seeding them as ` +
          "ledger rows would mean fabricating both, so the tables are intentionally empty and the " +
          "figures are kept as labelled snapshots. Getting a dated per-event log is a client ask.",
      };
    },
  },
  {
    id: "drying_dry_type_out_of_domain",
    async run({ prisma }) {
      const rows = await prisma.dryingJob.findMany({ select: { id: true, dryType: true } });
      if (!rows.length) return null;
      const odd = rows.filter((r) => /^BIN-/i.test(r.dryType));
      if (!odd.length) return null;
      return {
        id: "drying_dry_type_out_of_domain", severity: "info",
        title: "Drying job dryType holds a bin code",
        entity: "DryingJob", affectedCount: odd.length, sampleIds: odd.slice(0, 5).map((r) => r.id),
        evidence:
          "dryType mixes a real category ('Supplier') with a warehouse name and a bin code — the bin " +
          "values look like a shifted source row. Kept as-is rather than dropped.",
      };
    },
  },

  // ── Production checks below. All degrade gracefully to null against empty tables — there is no
  // seeded production data yet (the extractor is a later pass); these are written and tested now
  // against disposable fixture rows so the logic is proven ahead of real data arriving. ──────────

  {
    id: "production_btm_namespace_split",
    async run({ prisma }) {
      const rows = await prisma.btmIntake.findMany({ select: { btmNo: true } });
      if (!rows.length) return null;
      const nums = rows.map((r) => r.btmNo).filter((b) => /^\d+$/.test(b)).map(Number);
      const low = nums.filter((n) => n < 1000);
      const high = nums.filter((n) => n >= 1000);
      if (!low.length || !high.length) return null;
      return {
        id: "production_btm_namespace_split", severity: "info",
        title: "BTM numbers span two disjoint ranges",
        entity: "BtmIntake", affectedCount: nums.length,
        sampleIds: [...low.slice(0, 3), ...high.slice(0, 2)].map(String),
        evidence:
          `BTM numbers observed in two disjoint ranges (e.g. 101-153 and 1001-1055 in the real ` +
          `"1. RCN Receipts.xlsx") — ${low.length} below 1000, ${high.length} at or above. Not an ` +
          "error, just two numbering series in the source data; kept verbatim.",
      };
    },
  },
  {
    id: "production_source_bin_spelling_drift",
    async run({ prisma }) {
      const rows = await prisma.btmReceipt.findMany({ select: { sourceBinNo: true } });
      const vals = rows.map((r) => r.sourceBinNo).filter((v): v is string => !!v && v.trim() !== "");
      if (!vals.length) return null;
      const byNorm = new Map<string, Set<string>>();
      for (const v of vals) {
        const norm = v.trim().replace(/^BIN[\s-]?0*/i, "").replace(/^0+(?=\d)/, "");
        if (!norm) continue;
        if (!byNorm.has(norm)) byNorm.set(norm, new Set());
        byNorm.get(norm)!.add(v.trim());
      }
      const drifted = [...byNorm.entries()].filter(([, spellings]) => spellings.size > 1);
      if (!drifted.length) return null;
      const affected = drifted.reduce((n, [, s]) => n + s.size, 0);
      return {
        id: "production_source_bin_spelling_drift", severity: "warning",
        title: "The same source bin is spelled more than one way",
        entity: "BtmReceipt", affectedCount: affected,
        sampleIds: drifted.slice(0, 5).flatMap(([, s]) => [...s]).slice(0, 5),
        evidence:
          `${drifted.length} bin(s) recorded under more than one spelling in "Source Bin No" (e.g. ` +
          `"BIN-010" vs "BIN-10", bare numerics like "95") — up to three spellings for the same ` +
          "physical bin in the real workbook. Stored verbatim, never normalised.",
      };
    },
  },
  {
    id: "production_composite_cell",
    async run({ prisma }) {
      const [samples, trolleys] = await Promise.all([
        prisma.finalOutputSample.findMany({ select: { id: true, lotNo: true } }),
        prisma.bormaTrolleyRow.findMany({ select: { id: true, binNo: true } }),
      ]);
      const compositeLots = samples.filter((s) => s.lotNo && /[,/]/.test(s.lotNo));
      const compositeBins = trolleys.filter((t) => t.binNo && /[,/]/.test(t.binNo));
      const affected = compositeLots.length + compositeBins.length;
      if (!affected) return null;
      return {
        id: "production_composite_cell", severity: "warning",
        title: "A lot/bin cell names more than one lot or bin",
        entity: "FinalOutputSample / BormaTrolleyRow", affectedCount: affected,
        sampleIds: [...compositeLots.slice(0, 3).map((s) => s.id), ...compositeBins.slice(0, 2).map((t) => t.id)],
        evidence:
          `Composite cells like "ANG26E01,E02" (a sample spanning two cooking lots) and ` +
          `"ANA-03B/10/16" (a trolley routed through more than one bin) are real — confirmed against ` +
          "flow-xl-map/ANAGROCI_Data_Capture_Audit_Questions.md §2.8, evidence that lots genuinely " +
          "combine downstream of cooking. Stored verbatim, never split or picked-first.",
      };
    },
  },
  {
    id: "production_silo_batch_bin_column_shift",
    async run({ prisma }) {
      const rows = await prisma.silosStockRow.findMany({ select: { id: true, batchNo: true } });
      const shifted = rows.filter((r) => r.batchNo && /^\d+$/.test(r.batchNo.trim()));
      if (!shifted.length) return null;
      return {
        id: "production_silo_batch_bin_column_shift", severity: "warning",
        title: "Silo stock's Batch No / BIN No columns look shifted",
        entity: "SilosStockRow", affectedCount: shifted.length, sampleIds: shifted.slice(0, 5).map((r) => r.id),
        evidence:
          'The real "5. Calibrated RCN Silos Stock report.xlsx" holds small integers (matching ' +
          'Adjusted Qty) in what its header calls "Batch No", not a bin code or batch identifier — ' +
          "confirmed against flow-xl-map/ANAGROCI_Data_Capture_Audit_Questions.md §2.4. Stored " +
          "verbatim under the sheet's own column name, never remapped.",
      };
    },
  },
  {
    id: "production_input_quality_lot_column_mislabeled",
    async run({ prisma }) {
      const rows = await prisma.btmInputQuality.findMany({ select: { id: true, lotNo: true } });
      const populated = rows.filter((r) => r.lotNo && r.lotNo.trim());
      if (!populated.length) return null;
      return {
        id: "production_input_quality_lot_column_mislabeled", severity: "info",
        title: "2. Input RCN Quality report's own Lot No column holds Source Bin values",
        entity: "BtmInputQuality", affectedCount: populated.length, sampleIds: populated.slice(0, 5).map((r) => r.id),
        evidence:
          'The real workbook\'s "Lot No" column holds the same values as "1. RCN Receipts.xlsx"\'s ' +
          '"Source Bin No" column (e.g. 96, 95, 122) — a Lot does not exist until Cooking, so these ' +
          "cannot be real Lot numbers. Same disjoint-namespace confusion procurement's " +
          "lot_namespace_conflict already documents. Stored verbatim under the sheet's own column name.",
      };
    },
  },
];
