/**
 * Production's wire-format types — the production twin of types/stage.ts.
 *
 * Deliberately a SEPARATE set of interfaces rather than widening `Stage`/`StageField`: this
 * package's index.ts is a flat `export *` (see production's own subpath export below), and
 * procurement's Stage already has real consumers (backend's gen-prisma-models.ts, the frontend's
 * StageForm) that assume exactly the 4-kind StageKind union. Production needs two more kinds
 * (utility, byproduct — plant infrastructure and waste-stream nodes that capture no per-batch
 * record) that don't apply to procurement, so it gets its own type rather than widening a type
 * three other files already depend on the shape of.
 */

export type ProductionStageKind = "entry" | "decision" | "system" | "gap" | "utility" | "byproduct";

export interface ProductionStageField {
  /** Field/column name exactly as the real workbook (or the Bordereau de Transfer form) names it. */
  n: string;
  /** Sample value from the real workbook; "" if the field has no real backing yet (a gap). */
  v: string;
  /**
   * Storage column name — see StageField.col in types/stage.ts for why this is always declared,
   * never slugged from `n` at read time. Mechanically slugged once during transcription here
   * (see the bootstrap script's history), checked for per-table uniqueness and the 63-byte
   * Postgres identifier limit by scripts/gen-production-map.ts, same as procurement's generator.
   */
  col: string;
}

/**
 * One node in the production flow map (flow-xl-map/Production.html). 78 of these exist across 8
 * phases + a utilities lane. Several sibling nodes share one physical storage table (the same
 * workbook row, highlighted at a different column per step) — see productionTables.ts for the
 * deduped storage view; this type is the flow/presentation unit, not the storage unit.
 */
export interface ProductionStage {
  id: string;
  title: string;
  phase: string;
  kind: ProductionStageKind;
  /** Present only when a real workbook (or the BTM form) backs this node today. */
  file?: string;
  sheet?: string;
  /** How the flow-map itself referred to this step, when different from `title` (rare). */
  asDrawn?: string;
  note: string;
  fields: ProductionStageField[];
}

/** A production decision node's branch options — the production twin of BranchOutcome. */
export interface ProductionBranchOutcome {
  id: string;
  label: string;
  note: string;
}

/** Which of the two spines a storage table hangs off, or neither. */
export type ProductionTableSpine = "btm" | "bin" | "lot" | "standalone";

/**
 * One of the 22 real storage tables production's 78 flow nodes collapse into. This is the unit
 * scripts/gen-production-map.ts (mirroring gen-stage-map.ts) turns into Prisma models — analogous
 * to gen-stage-map.ts's hand-declared STAGE_MODELS, but data-driven here since there are 22 of
 * these rather than 16 hand-writable entries.
 */
export interface ProductionTable {
  id: string;
  /** Prisma model name. */
  model: string;
  spine: ProductionTableSpine;
  cardinality: "one" | "many";
  /** Which flow nodes in productionStages.ts write into this table (the `reuse` relationship). */
  sourceNodeIds: string[];
  fields: ProductionStageField[];
}
