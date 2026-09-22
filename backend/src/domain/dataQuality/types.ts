/**
 * Data-quality findings.
 *
 * Ground rule §4: real data-quality problems in the client's workbooks must be SURFACED, never
 * silently normalised away. So these are never errors — a write carrying a warning still
 * succeeds (200 with `warnings`), and the import of the real data must not be blocked by them.
 *
 * Findings are AGGREGATE. 367 identical "DIFF is degenerate" rows is one finding with
 * affectedCount 367, not 367 findings — otherwise the signal is unreadable.
 */
export type Severity = "info" | "warning" | "critical";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  /** Which table/ledger this concerns. */
  entity: string;
  affectedCount: number;
  /** A few example keys, for drilling in. Never the full set. */
  sampleIds: string[];
  /** What was measured, and where the underlying data came from. */
  evidence: string;
}

export interface CheckContext {
  prisma: import("@prisma/client").PrismaClient;
}

export interface Check {
  id: string;
  run(ctx: CheckContext): Promise<Finding | null>;
}

export const finding = (f: Finding): Finding => f;
