/**
 * The check registry. Each check returns one aggregate Finding, or null when clean.
 *
 * Counts in the comments are what was measured against the real workbooks and seed data at the
 * time of writing — they double as expectations for tests/dataQuality.test.ts.
 */
import type { Check } from "./types.js";
import { negativeBalanceRows, transferFlagRows } from "../juteBalance.js";
import { STAGE_FIELD_MAP } from "@anagroci/contract/generated/stageFieldMap";
import { storedFormulaMismatches } from "@anagroci/contract/domain/receiptMath";
import { legacyLotSeq, parseSiteId } from "@anagroci/contract/domain/ids";

/** The number inside a lot, whether system-format (LOT-BKE01-2026-017) or still the workbook's bare 17. */
const lotSeq = (lot: string) => parseSiteId(lot)?.seq ?? legacyLotSeq(lot) ?? lot;
import { RECEIPT_INCLUDE, assembleStageData } from "../../stageStore.js";

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
    // DELIBERATELY RETIRED, not deleted — see domain/juteBalance.ts's balanceDriftRows() for the
    // full reasoning. The new-sheets "Jute Bags movement" export has no BALANCE column at all, so
    // every row it produces has reportedBalance = null; this check's query only ever matched rows
    // where reportedBalance WAS reported (comparing it against the computed running total), so it
    // now has nothing left to compare. Returning null unconditionally is the honest state — the
    // alternative (leaving the old query in place) would silently pass for a different reason than
    // it used to (nothing to check, not "checked and clean"), which is exactly the kind of quiet
    // drift this app's own data-quality discipline exists to catch, not commit.
    async run() {
      return null;
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
          "The running balance computed from Jute Bags movement (the source sheet itself carries no " +
          "BALANCE column any more — see jute_balance_drift's own retirement note) turns negative and " +
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
        title: "Origins observed in an upload but absent from the curated master",
        entity: "Origin", affectedCount: added.length,
        sampleIds: added.slice(0, 5).map((o) => o.name),
        evidence:
          "Origin here is the RCN's upstream supply town, not a warehouse. These values appear in an " +
          "uploaded sheet but not in the curated origins master — 7 from the warehouse-transfer sheet " +
          "(including a literal 'Not Mentiond ') and 11 from the unit-warehouse discharge sheet. Two of " +
          "the latter are the same town spelled two ways (SAKASSOU / SAKKASSOU), which is why these are " +
          "reported rather than auto-merged. Kept as soft references so no real row is dropped.",
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
    id: "lot_namespace_disagreement",
    async run({ prisma }) {
      // Replaces the old `lot_namespace_conflict`, which asked whether the two lot SETS overlapped
      // at all and self-suppressed the moment they did. Both namespaces are small integers, so once
      // receipts gained real lots the sets overlapped immediately and that check went quiet — a
      // false all-clear. What actually matters is whether the SAME physical batch carries the SAME
      // lot in both places, so this compares them per-batch, joined on the fiche that identifies it.
      const withLot = await prisma.stageLotAssignment.findMany({
        where: { lotNumber: { not: null } },
        select: { lotNumber: true, receipt: { select: { verify: { select: { fiche: true } } } } },
      });
      const lotByFiche = new Map<string, string>();
      for (const r of withLot) {
        const f = r.receipt.verify?.fiche?.trim();
        const l = (r.lotNumber ?? "").trim();
        if (f && l) lotByFiche.set(f, l);
      }
      if (!lotByFiche.size) return null;

      const [dry, xfer] = await Promise.all([
        prisma.dryingJob.findMany({ select: { ficheNo: true, lotNo: true } }),
        prisma.juteWarehouseTransferReceipt.findMany({ select: { noFiche: true, lotNo: true } }),
      ]);

      let compared = 0;
      const disagreements: string[] = [];
      const note = (label: string, fiche: string, theirs: string) => {
        const ours = lotByFiche.get(fiche);
        if (!ours || !theirs) return;
        compared += 1;
        // Compared by sequence number: since the Oct 2026 renumber one side can be LOT-BKE01-2026-017
        // and the other the bare 17 it was before — the same number, not a disagreement.
        if (lotSeq(ours) !== lotSeq(theirs)) disagreements.push(`${label} fiche ${fiche}: unit-warehouse Lot ${ours} vs ${theirs}`);
      };
      for (const d of dry) note("drying", (d.ficheNo ?? "").trim(), (d.lotNo ?? "").trim());
      for (const t of xfer) note("transfer", (t.noFiche ?? "").trim(), (t.lotNo ?? "").trim());

      if (!disagreements.length) return null;
      return {
        id: "lot_namespace_disagreement", severity: "critical",
        title: "The same batch carries a different Lot Number at each warehouse",
        entity: "StageLotAssignment", affectedCount: disagreements.length,
        sampleIds: disagreements.slice(0, 5),
        evidence:
          `Of ${compared} batches where a lot is recorded both at the unit warehouse (the discharge ` +
          `sheet, which is where a Lot is assigned) and again downstream, ${disagreements.length} ` +
          "disagree — e.g. fiche 72566 is Lot 17 at Bouaké and Lot 20 at Yakro. Each site appears to " +
          "run its own 1..N sequence, so a lot number is only meaningful together with its warehouse. " +
          "That is why lot uniqueness is enforced per warehouse. The receipt-to-drying/transfer links " +
          "(services/receiptLinks.ts) were switched to match on lot on explicit request despite this " +
          "finding — most matched rows are a coincidental lot collision, not the same batch; that " +
          "tradeoff is flagged inline via `ficheAgrees` rather than fixed here, since which site's " +
          "number is authoritative is a question only the client can answer.",
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
      // Generic over any alias, not just ANAGROCI-01 — that one specific alias moved to
      // "stated-in-source" provenance once the consolidated workbook placed it in a real column
      // next to its site (see prisma/seed.ts's backfillWarehouseTypology), so this check goes quiet
      // for it. It stays here as the guard for the NEXT inferred alias, whatever site names it names.
      const rows = await prisma.warehouseAlias.findMany({ where: { provenance: "inferred" } });
      if (!rows.length) return null;
      return {
        id: "warehouse_alias_inferred", severity: "warning",
        title: "Warehouse aliases inferred, not confirmed",
        entity: "WarehouseAlias", affectedCount: rows.length,
        sampleIds: rows.map((r) => `${r.alias} -> ${r.warehouseName}`),
        evidence:
          "A workbook names a warehouse that matches no entry in the warehouse master, and the " +
          "mapping to a real site was inferred from a file or sheet name only — the client has not " +
          "stated it in an actual column. Recorded with provenance and surfaced here for confirmation " +
          "rather than applied silently.",
      };
    },
  },
  {
    id: "warehouse_site_name_variants",
    async run({ prisma }) {
      // Distinct from warehouse_alias_inferred above: this isn't about a NEW warehouse needing a
      // mapping, it's about ONE site legitimately having multiple names across the client's own
      // sheets (master: "YAKRO FACTORY", drying: "ANAGROCI-01" as a store, receiving: site column
      // literally says "YAMOUSSOUKRO"). Every stated-in-source alias is one more name for a site
      // that already has a canonical one — worth a standing count so a third or fourth variant
      // doesn't slip in unnoticed.
      const rows = await prisma.warehouseAlias.findMany({ where: { provenance: "stated-in-source" } });
      if (!rows.length) return null;
      return {
        id: "warehouse_site_name_variants", severity: "info",
        title: "A site is known by more than one name across the source workbooks",
        entity: "WarehouseAlias", affectedCount: rows.length,
        sampleIds: rows.map((r) => `${r.alias} -> ${r.warehouseName}`),
        evidence:
          "Each row here is a real alternate name for a site, stated directly in a source column " +
          "(not inferred) — e.g. the receiving sheet's 'warehouse site' column says YAMOUSSOUKRO on " +
          "exactly the rows the master calls YAKRO FACTORY. Recorded as an alias rather than merged, " +
          "so no receipt's real warehouse value is silently rewritten.",
      };
    },
  },
  {
    id: "store_site_not_canonical",
    async run({ prisma }) {
      // A store's `site` should point at a CANONICAL site row (one with a real `kind` —
      // Village/Regional/Factory) — that's the one thing `resolveSite()`'s store lookup
      // (`where: { site: name }`) actually matches against. Found while building the two-section
      // frontend: `upsertObservedStores` (services/imports.ts) stores whatever site value a sheet's
      // own column says, verbatim — same discipline as warehouse_site_name_variants above — so
      // ANAGROCI-01 ended up with `site: "YAMOUSSOUKRO"` (the Warehouse Receiving sheet's own
      // column), not `site: "YAKRO FACTORY"` (the kind-bearing canonical row). resolveSite() still
      // works today because the WarehouseAlias table independently maps YAMOUSSOUKRO -> YAKRO
      // FACTORY — but anything that reads Warehouse.site directly (e.g. a per-site store filter)
      // will miss this store. Reported, not silently repointed: doing that would be exactly the
      // kind of "fix" ground rule #4 forbids.
      const stores = await prisma.warehouse.findMany({
        where: { site: { not: null } }, select: { name: true, site: true },
      });
      const canonicalSites = new Set(
        (await prisma.warehouse.findMany({ where: { kind: { not: null } }, select: { name: true } }))
          .map((w) => w.name)
      );
      const bad = stores.filter((s) => !canonicalSites.has(s.site!));
      if (!bad.length) return null;
      return {
        id: "store_site_not_canonical", severity: "warning",
        title: "A store's site points at an alias, not the canonical site name",
        entity: "Warehouse", affectedCount: bad.length,
        sampleIds: bad.map((s) => `${s.name} -> ${s.site}`),
        evidence:
          `${bad.map((s) => `${s.name} points at "${s.site}"`).join(", ")} — none of these are a ` +
          "kind-bearing (canonical) site row. A source sheet's own site column named an alias " +
          "instead of the master's canonical name; the WarehouseAlias table still resolves it " +
          "correctly for API scoping, but anything reading Warehouse.site directly will not.",
      };
    },
  },
  {
    id: "stage_warehouse_type_shadows_master",
    async run({ prisma }) {
      // Two stage columns (n-gate.warehouseType, n-stock.warehouseType) carry the label "Warehouse
      // type (Village/Regional/Factory)" but are never written to — the kind now lives on the
      // Warehouse master (Warehouse.kind) instead, resolved from Receipt.warehouse, so there is
      // exactly one place a receipt's site kind can be looked up. This check is the tripwire: if
      // either column is ever filled in, it's a second, driftable copy of a fact the master already
      // owns — CLAUDE.md's "one source of truth per fact" rule, made concrete and testable.
      const [gate, stock] = await Promise.all([
        prisma.stageGateEntry.findMany({ where: { warehouseType: { not: null, notIn: [""] } }, select: { receiptId: true, warehouseType: true } }),
        prisma.stageStockUpdate.findMany({ where: { warehouseType: { not: null, notIn: [""] } }, select: { receiptId: true, warehouseType: true } }),
      ]);
      const rows = [...gate, ...stock];
      if (!rows.length) return null;
      return {
        id: "stage_warehouse_type_shadows_master", severity: "warning",
        title: "A receipt's Warehouse type was hand-typed instead of read from the master",
        entity: "StageGateEntry / StageStockUpdate", affectedCount: rows.length,
        sampleIds: rows.slice(0, 5).map((r) => `${r.receiptId}: "${r.warehouseType}"`),
        evidence:
          "These columns exist in the stage model (they mirror the real workbook's own header) but " +
          "the app deliberately never writes them — a receipt's warehouse kind is resolved from " +
          "Warehouse.kind via Receipt.warehouse instead, so it can't drift from the master. A non-blank " +
          "value here means something bypassed that and typed a second, unverified copy.",
      };
    },
  },
  {
    id: "transfer_destination_inferred",
    async run({ prisma }) {
      // Same discipline as warehouse_alias_inferred: a real fact (every transfer in this sheet
      // really does arrive at Yakro), asserted only by column HEADERS ("Gross Weight (Yakro)
      // Recived", "KOR Received (At Yakro)", ...) rather than a per-row cell — so it's surfaced for
      // confirmation rather than silently treated as equivalent to a stated value. Stays non-zero by
      // construction until a sheet variant states the destination in an actual column.
      const rows = await prisma.juteWarehouseTransferReceipt.findMany({
        where: { destinationProvenance: "inferred" }, select: { sn: true, destinationWarehouse: true },
      });
      if (!rows.length) return null;
      return {
        id: "transfer_destination_inferred", severity: "warning",
        title: "Transfer destination inferred from column headers, not stated per row",
        entity: "JuteWarehouseTransferReceipt", affectedCount: rows.length,
        sampleIds: rows.slice(0, 5).map((r) => `sn ${r.sn} -> ${r.destinationWarehouse}`),
        evidence:
          `All ${rows.length} rows in ledger 4 are read as arriving at ${rows[0]!.destinationWarehouse}, ` +
          "but no cell in the sheet says so — the fact comes only from column headers naming Yakro " +
          "('Gross Weight (Yakro) Recived', 'KOR Received (At Yakro)', ...). Recorded with provenance " +
          "and reported here rather than treated as equivalent to a stated per-row value.",
      };
    },
  },
  {
    id: "transfer_in_has_no_ledger1_counterpart",
    async run({ prisma }) {
      const inbound = await prisma.juteWarehouseTransferReceipt.findMany({
        where: { destinationWarehouse: { not: null } }, select: { destinationWarehouse: true },
      });
      if (!inbound.length) return null;
      const destinations = [...new Set(inbound.map((r) => r.destinationWarehouse!))];
      const ledger1Sites = await prisma.juteWarehouseMovement.findMany({
        where: { whLocation: { in: destinations } }, select: { whLocation: true }, distinct: ["whLocation"],
      });
      const covered = new Set(ledger1Sites.map((r) => r.whLocation));
      const uncovered = destinations.filter((d) => !covered.has(d));
      if (!uncovered.length) return null;
      const affected = inbound.filter((r) => uncovered.includes(r.destinationWarehouse!)).length;
      return {
        id: "transfer_in_has_no_ledger1_counterpart", severity: "warning",
        title: "A transfer's destination warehouse has no warehouse-stock ledger of its own",
        entity: "JuteWarehouseTransferReceipt", affectedCount: affected, sampleIds: uncovered,
        evidence:
          `Ledger 1 (warehouse-stock) records only BOUAKE — ${uncovered.join(", ")} has 0 rows there, ` +
          `so every one of the ${affected} inbound TRANSFER_IN movements now surfaced by ` +
          "jute_reconciliation has nothing on the receiving side to reconcile against. The gap was " +
          "invisible before destinationWarehouse existed, because TRANSFER_IN wasn't attributed to any " +
          "warehouse at all; it's real now, not new. One of the clearest arguments for tracking the " +
          "central warehouse as its own section rather than an extension of the unit warehouse's ledger.",
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
    id: "drying_batch_multi_lot",
    async run({ prisma }) {
      const rows = await prisma.dryingBatch.findMany({
        where: { lotNoRaw: { not: null }, lotNo: null },
        select: { id: true, sn: true, lotNoRaw: true },
      });
      // Multi-value ambiguity only — NOT the separate bin-code contamination case (see
      // drying_batch_lot_column_holds_bin_code), so filter to the two genuinely ambiguous shapes:
      // comma/slash-joined text, or a plausible numeric concatenation. Mirrors
      // dryingBatch.ts's resolveCleanLotNo() exactly, so this stays in sync with the importer's
      // own rule rather than re-deriving a second one.
      const ambiguous = rows.filter((r) => {
        const raw = (r.lotNoRaw ?? "").trim();
        if (/[,/]/.test(raw)) return true;
        return /^\d+$/.test(raw) && Number(raw) >= 1000;
      });
      if (!ambiguous.length) return null;
      return {
        id: "drying_batch_multi_lot", severity: "warning",
        title: "Drying Batch's Lot No column names more than one lot in a single cell",
        entity: "DryingBatch", affectedCount: ambiguous.length,
        sampleIds: ambiguous.slice(0, 5).map((r) => `sn ${r.sn}: "${r.lotNoRaw}"`),
        evidence:
          `${ambiguous.length} rows carry a lot value that cannot be split without guessing — 11 ` +
          "comma/slash-joined (e.g. \"387, 401\") and 11 numerically concatenated 6-digit values " +
          "(e.g. 246253, ambiguously 246+253 or 24+6253 or ...). Both are stored verbatim in " +
          "lotNoRaw; lotNo stays null for these rows rather than picking a split. The sheet's own " +
          "'needs lot allocation clarification' flag agrees on all but one of these — a genuine " +
          "client-side inconsistency, also preserved rather than silently corrected.",
      };
    },
  },
  {
    id: "drying_batch_lot_column_holds_bin_code",
    async run({ prisma }) {
      const rows = await prisma.dryingBatch.findMany({
        where: { lotNoRaw: { not: null }, lotNo: null }, select: { id: true, sn: true, lotNoRaw: true },
      });
      const contaminated = rows.filter((r) => /^(BIN|ANA)[-\s]?\d/i.test((r.lotNoRaw ?? "").trim()));
      if (!contaminated.length) return null;
      return {
        id: "drying_batch_lot_column_holds_bin_code", severity: "info",
        title: "Drying Batch's Lot No column holds a bin code on some rows",
        entity: "DryingBatch", affectedCount: contaminated.length,
        sampleIds: [...new Set(contaminated.map((r) => r.lotNoRaw!))].slice(0, 5),
        evidence:
          `${contaminated.length} of the real "Drying Batch" rows carry a bin code ` +
          "(BIN-03B/BIN-005/BIN-007/BIN-015/BIN-016) in the lot column, not a lot number at all — " +
          "the same disjoint-namespace confusion production_input_quality_lot_column_mislabeled " +
          "already documents on the production side. Stored verbatim under lotNoRaw; lotNo stays " +
          "null rather than treating a bin code as if it were a real lot.",
      };
    },
  },
  {
    // The reconciliation the plan asked for before deciding whether DryingBatch replaces DryingJob:
    // both cover exactly the same 81 central (ANAGROCI-01) rows, joined on their shared FICHE. The
    // result is NOT clean — see this finding's evidence — so DryingJob stays the live source for
    // receiptLinks.ts and the drying page this pass; this check is the standing, re-runnable proof
    // of that decision rather than a one-off note in a comment.
    // DELIBERATELY RETIRED (see jute_balance_drift's own retirement note for the same pattern):
    // prisma/seed.ts no longer seeds DryingJob at all, and no importer writes to it any more either
    // — DryingBatch is the sole replacement source (dryingBatches.ts). The `if (!jobs.length...)
    // return null` guard below makes this permanently inert now, not because the reconciliation
    // passed, but because there is nothing left on the DryingJob side to compare. Kept as live code
    // (not deleted) so the 33-of-81-rows-disagree finding that justified keeping DryingJob as the
    // read path for as long as it was the read path stays legible.
    id: "drying_batch_vs_drying_job_drift",
    async run({ prisma }) {
      const [jobs, batches] = await Promise.all([
        prisma.dryingJob.findMany({ where: { warehouse: "ANAGROCI-01" } }),
        prisma.dryingBatch.findMany({ where: { warehouse: "ANAGROCI-01" } }),
      ]);
      if (!jobs.length || !batches.length) return null;
      const byFiche = new Map(batches.map((b) => [(b.ficheNoRaw ?? "").trim(), b]));
      const affected: string[] = [];
      for (const j of jobs) {
        const b = byFiche.get((j.ficheNo ?? "").trim());
        if (!b) { affected.push(`${j.id}: no matching DryingBatch row for fiche ${j.ficheNo}`); continue; }
        const bDate = b.dryingDate ? b.dryingDate.toISOString().slice(0, 10) : b.dryingDateRaw;
        const reasons: string[] = [];
        if ((j.date ?? "").trim() !== (bDate ?? "").trim()) reasons.push(`date ${j.date} vs ${bDate}`);
        if ((j.status ?? "").trim() !== (b.status ?? "").trim()) reasons.push(`status ${j.status} vs ${b.status}`);
        if ((j.destination ?? "").trim() !== (b.destinationRaw ?? "").trim()) reasons.push(`destination ${j.destination} vs ${b.destinationRaw}`);
        if (reasons.length) affected.push(`${j.id}: ${reasons.join(", ")}`);
      }
      if (!affected.length) return null;
      return {
        id: "drying_batch_vs_drying_job_drift", severity: "warning",
        title: "DryingBatch's central rows disagree with the existing DryingJob rows for the same fiche",
        entity: "DryingJob / DryingBatch", affectedCount: affected.length,
        sampleIds: affected.slice(0, 5),
        evidence:
          `${affected.length} of ${jobs.length} DryingJob rows (all ANAGROCI-01 / central) disagree ` +
          "with their matched DryingBatch row on date, status, and/or destination when joined on the " +
          "same FICHE both sheets carry (bin and lot agree on all 81). Measured, not assumed: this is " +
          "why receiptLinks.ts and the drying page still read DryingJob rather than DryingBatch — the " +
          "plan's own condition for switching ('only if reconciliation reports zero drift') is not met.",
      };
    },
  },
  {
    id: "production_issue_fiche_column_contaminated",
    async run({ prisma }) {
      const rows = await prisma.issuedToProduction.findMany({
        where: { ficheNo: { not: null } }, select: { id: true, ficheNo: true },
      });
      if (!rows.length) return null;
      const looksLikeBin = rows.filter((r) => /^(BIN|ANA)[-\s]?\d/i.test((r.ficheNo ?? "").trim()));
      if (!looksLikeBin.length) return null;
      return {
        id: "production_issue_fiche_column_contaminated", severity: "info",
        title: "Issued to Production's Fiche No column mostly holds dry-bin codes, not fiches",
        entity: "IssuedToProduction", affectedCount: looksLikeBin.length,
        sampleIds: [...new Set(looksLikeBin.map((r) => r.ficheNo!))].slice(0, 5),
        evidence:
          `${looksLikeBin.length} of ${rows.length} non-blank "Fiche No" values in the real ` +
          "\"Issued to Production Section\" sheet are dry-bin-code strings (e.g. \"BIN-03B\"), not a " +
          "real fiche number — verified directly against the file before deciding not to join on " +
          "this column, matching the same contamination pattern found in a similar sheet. Stored " +
          "verbatim; never used to link a row back to a Receipt.",
      };
    },
  },
  {
    id: "production_issue_source_dry_bin_pairs",
    async run({ prisma }) {
      const rows = await prisma.issuedToProduction.findMany({
        where: { OR: [{ sourceBin: { not: null } }, { dryBin: { not: null } }] },
        select: { sourceBin: true, dryBin: true },
      });
      if (!rows.length) return null;
      const pairs = new Set(rows.map((r) => `${r.sourceBin ?? ""} -> ${r.dryBin ?? ""}`));
      return {
        id: "production_issue_source_dry_bin_pairs", severity: "info",
        title: "Source Bin / DRY BIN observed pairs (procurement <-> production bin bridge)",
        entity: "IssuedToProduction", affectedCount: pairs.size, sampleIds: [...pairs].slice(0, 5),
        evidence:
          `${pairs.size} distinct (Source Bin, DRY BIN) pairs observed across the real "Issued to ` +
          "Production Section\" sheet — the first *stated* bridge between procurement's BIN-0xx bin " +
          "namespace and production's ANA-x/…-DRY namespace. Recorded here as reporting-only " +
          "observed data; no bin-namespace normalisation is applied anywhere in this codebase.",
      };
    },
  },
  {
    id: "production_issue_btm_not_in_production_master",
    async run({ prisma }) {
      const rows = await prisma.issuedToProduction.findMany({
        where: { btmNo: { not: null } }, select: { btmNo: true },
      });
      if (!rows.length) return null;
      const distinctBtms = [...new Set(rows.map((r) => r.btmNo!.trim()))];
      const known = await prisma.btmIntake.findMany({
        where: { btmNo: { in: distinctBtms } }, select: { btmNo: true },
      });
      const knownSet = new Set(known.map((k) => k.btmNo));
      const missing = distinctBtms.filter((b) => !knownSet.has(b));
      if (!missing.length) return null;
      return {
        id: "production_issue_btm_not_in_production_master", severity: "info",
        title: "Issued-to-production BTMs with no matching BtmIntake",
        entity: "IssuedToProduction", affectedCount: missing.length, sampleIds: missing.slice(0, 5),
        evidence:
          `${missing.length} of ${distinctBtms.length} distinct BTM numbers in the real "Issued to ` +
          "Production Section\" sheet have no matching BtmIntake — btmNo is a SOFT reference on " +
          "this table by design, so this is expected whenever the warehouse's own issue record runs " +
          "ahead of production's intake records. Never auto-created; reported only.",
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
  {
    // Oct 2026: SACS, NET, PAID and AMOUNT are calculated (contract's domain/receiptMath.ts). The
    // imported rows keep what the workbook recorded; where that disagrees with the formula it is
    // reported here, never recalculated. Measured: 44 Truck Reception rows' bag totals
    // (good + damp + torn ≠ SACS); net, paid and amount agreed on every real row.
    id: "stored_value_disagrees_with_formula",
    async run({ prisma }) {
      const rows = await prisma.receipt.findMany({ include: RECEIPT_INCLUDE });
      const byField = new Map<string, string[]>();
      for (const row of rows) {
        for (const m of storedFormulaMismatches(assembleStageData(row as Record<string, unknown>))) {
          const list = byField.get(m.label) ?? [];
          list.push(`${row.id} (${m.stored} vs ${m.expected})`);
          byField.set(m.label, list);
        }
      }
      const affected = [...byField.values()].flat();
      if (!affected.length) return null;
      return {
        id: "stored_value_disagrees_with_formula", severity: "warning",
        title: "Recorded totals that don't match how they are calculated",
        entity: "Receipt", affectedCount: affected.length, sampleIds: affected.slice(0, 5),
        evidence:
          [...byField].map(([label, l]) => `${label}: ${l.length}`).join("; ") +
          ". These values came from the workbook and are kept exactly as recorded. New entries are " +
          "calculated, so a mismatch here is a question for whoever filled the original sheet.",
      };
    },
  },
  {
    // A Lot is issued on quality pass and never taken back — so a truck whose decision was later
    // changed to Fail still holds one. Not wrong, but worth a look.
    id: "rejected_receipt_holds_lot",
    async run({ prisma }) {
      const rows = await prisma.receiptBranch.findMany({
        where: { stageId: "n-qfs", branchId: "fail", receipt: { lot: { lotNumber: { not: "" } } } },
        select: { receiptId: true, receipt: { select: { lot: { select: { lotNumber: true } } } } },
      });
      const hits = rows.filter((r) => r.receipt.lot?.lotNumber);
      if (!hits.length) return null;
      return {
        id: "rejected_receipt_holds_lot", severity: "info",
        title: "Rejected trucks that still hold a Lot",
        entity: "Receipt", affectedCount: hits.length,
        sampleIds: hits.slice(0, 5).map((h) => `${h.receiptId} (${h.receipt.lot!.lotNumber})`),
        evidence:
          "These trucks passed quality (which issued the Lot) and were later marked Fail. The Lot " +
          "stays with the truck — an issued Lot is never reused — so it doesn't hold any stock.",
      };
    },
  },
  {
    // Measured: YAKRO FACTORY (302 seeded receipts) has no code until an admin sets one.
    id: "warehouse_without_code",
    async run({ prisma }) {
      const sites = await prisma.warehouse.findMany({
        where: { site: null, code: null },
        select: { name: true, _count: { select: { receipts: true, deliveryPlans: true } } },
      });
      const pending = sites.filter((s) => s._count.receipts + s._count.deliveryPlans > 0);
      if (!pending.length) return null;
      return {
        id: "warehouse_without_code", severity: "warning",
        title: "Warehouses with records but no ID code",
        entity: "Warehouse", affectedCount: pending.length,
        sampleIds: pending.map((s) => `${s.name} (${s._count.receipts} receipts)`),
        evidence:
          "No Receipt ID, Lot or Delivery Plan can be issued at these warehouses, and their existing " +
          "records keep their old numbers, until an admin sets the code in Masters › Warehouses and " +
          "the renumber (backend/scripts/renumberIds.ts) is run again.",
      };
    },
  },
];
