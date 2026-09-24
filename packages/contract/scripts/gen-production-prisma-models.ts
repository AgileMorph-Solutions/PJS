/**
 * Emits the Prisma model blocks for the 22 production storage tables, straight from
 * PRODUCTION_FIELD_MAP, so column names in schema.prisma can never diverge from productionTables.ts
 * — the production twin of gen-prisma-models.ts.
 *
 * All 22 tables are cardinality "many": unlike procurement's per-stage tables (genuinely 1:1 with
 * a Receipt — a truck passes through Gate Entry exactly once), production's real workbooks proved
 * event-sourced even where the domain model suggested a snapshot — e.g. 6. Cooking Process Report
 * has 107 distinct Lots across 108 rows (one lot was cooked twice), 1. RCN Receipts has 7 BTMs with
 * >1 line (a BTM can draw from more than one source bin). Treating any of these as a hard 1:1 with
 * a synthetic-free natural-key PK would mean the second real row either fails a unique constraint
 * or silently overwrites the first — exactly what the repo's "never silently drop real rows" rule
 * forbids. So every table gets its own uuid PK plus a soft, indexed link column.
 *
 * Output is pasted into prisma/schema.prisma by hand (the rest of that file — BtmIntake,
 * ProductionBin, ProductionLot, relations, FKs, indexes — is hand-maintained, same split as the
 * procurement side). backend/tests/productionRoundTrip.test.ts then asserts every (model, col) in
 * the map exists in the live Prisma DMMF.
 *
 *   npx tsx packages/contract/scripts/gen-production-prisma-models.ts
 */
import { PRODUCTION_FIELD_MAP } from "@anagroci/contract/generated/productionFieldMap";
import { productionStageById } from "@anagroci/contract/data/productionStages";

// The natural column name every spine's own real workbook column already slugs to (BTM No ->
// btmNo, Lot No -> lotNo, BIN No -> binNo) — not a synthetic id. Most tables in a spine already
// carry that exact real column (the sheet restates its own Lot/BTM/Bin on every row), so the
// parent link reuses it rather than storing the same fact twice under two names (repo rule: one
// source of truth per fact). A table without that column gets an explicit nullable link column of
// the same name instead.
const PARENT_COL: Record<string, string | null> = { btm: "btmNo", lot: "lotNo", bin: "binNo", standalone: null };

const out: string[] = [];
for (const [tableId, spec] of Object.entries(PRODUCTION_FIELD_MAP)) {
  const primaryNode = productionStageById[spec.sourceNodeIds[0]];
  const parentCol = PARENT_COL[spec.spine];
  const natural = parentCol ? spec.fields.find((f) => f.col === parentCol) : undefined;
  const renderFields = natural ? spec.fields.filter((f) => f !== natural) : spec.fields;
  const pad = Math.max(...spec.fields.map((f) => f.col.length), parentCol?.length ?? 0, 9);
  const lines = renderFields.map((f) => `  ${f.col.padEnd(pad)} String?  /// ${f.label.replace(/\n/g, " ")}`);

  let idBlock: string;
  let extra = "";
  if (!parentCol) {
    idBlock = `  id ${" ".repeat(Math.max(0, pad - 2))} String @id @default(uuid())`;
  } else {
    const comment = natural
      ? `this row's own ${natural.label} column, doubling as the ${spec.spine === "lot" ? "Lot" : spec.spine === "btm" ? "BTM" : "Bin"} link`
      : `soft link — no ${parentCol} column exists in the real sheet`;
    idBlock = `  id       String  @id @default(uuid())\n  ${parentCol.padEnd(pad)} String? /// ${comment}`;
    extra = `\n\n  @@index([${parentCol}])`;
  }

  out.push(`/// Table ${tableId} (${spec.spine}, many) — from ${primaryNode?.title ?? tableId}
${primaryNode?.file ? `/// Source: ${primaryNode.file}${primaryNode.sheet ? ` · ${primaryNode.sheet}` : ""}\n` : ""}model ${spec.model} {
${idBlock}
${lines.join("\n")}${extra}
}`);
}
console.log(out.join("\n\n"));
