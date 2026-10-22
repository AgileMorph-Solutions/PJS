/**
 * Emits the Prisma model blocks for the 17 per-stage tables, straight from STAGE_FIELD_MAP, so
 * column names in schema.prisma can never diverge from the labels in stages.ts.
 *
 * Output is pasted into prisma/schema.prisma (the rest of that file — relations, FKs, indexes,
 * the jute tables — is hand-maintained). tests/stageMap.schema.test.ts then asserts every
 * (model, col) in the map exists in the live Prisma DMMF, which is what actually enforces the
 * agreement; this script just makes getting there mechanical instead of a 74-line transcription.
 *
 *   npx tsx packages/contract/scripts/gen-prisma-models.ts
 */
import { STAGE_FIELD_MAP } from "@anagroci/contract/generated/stageFieldMap";
import { stages, rejectStage } from "@anagroci/contract/data/stages";

const byId = Object.fromEntries([...stages, rejectStage].map((s) => [s.id, s]));
// Columns that carry a typed shadow for reporting/DQ (see plan: all stage cols are String in v1).
const SHADOW: Record<string, string[]> = {
  "n-gross": ["loadedTruckWtKgs", "tareWtKgs", "grossWtKgs"], "n-netwt": ["netWtKgs", "paidWt"],
  "n-unload": ["sacs", "bonSacs", "humidSacs", "sacsDechires", "refraction"],
  "n-qfs": ["moisture", "nutCount", "kor", "finalKor"], "n-grn": ["price", "amount", "grnWeight"],
};
const out: string[] = [];
for (const [stageId, spec] of Object.entries(STAGE_FIELD_MAP)) {
  const s = byId[stageId];
  const many = spec.cardinality === "many";
  const pad = Math.max(...spec.fields.map((f) => f.col.length), 9);
  const lines = spec.fields.map((f) => `  ${f.col.padEnd(pad)} String?  /// ${f.label.replace(/\n/g, " ")}`);
  const shadows = (SHADOW[stageId] ?? []).map((c) => `  ${(c + "Num").padEnd(pad)} Decimal? /// typed shadow of ${c}, for reporting/DQ only — never round-tripped`);
  out.push(`/// Stage ${stageId} (${s.kind}) — ${s.title}
${s.file ? `/// Source: ${s.file}${s.sheet ? ` · ${s.sheet}` : ""}\n` : ""}model ${spec.model} {
${many ? `  id        String   @id @default(uuid())\n  receiptId String\n  seq       Int      /// order within the receipt; the assembler projects the highest seq into stageData` : `  receiptId String   @id`}
${lines.join("\n")}
${shadows.length ? shadows.join("\n") + "\n" : ""}  receipt   Receipt  @relation(fields: [receiptId], references: [id], onDelete: Cascade)
${many ? `\n  @@unique([receiptId, seq])\n  @@index([receiptId])` : ""}
}`);
}
console.log(out.join("\n\n"));
