import { prisma } from "../../db.js";
import { CHECKS } from "./checks.js";
import type { Finding } from "./types.js";
import type { ReceiptRecord } from "@anagroci/contract/types/receipt";

export type { Finding } from "./types.js";

/** The full audit, for GET /api/data-quality. */
export async function scanAll(): Promise<{ generatedAt: string; checks: Finding[] }> {
  const results = await Promise.all(CHECKS.map((c) => c.run({ prisma })));
  const order = { critical: 0, warning: 1, info: 2 } as const;
  return {
    generatedAt: new Date().toISOString(),
    checks: results.filter((f): f is Finding => f !== null).sort((a, b) => order[a.severity] - order[b.severity]),
  };
}

/**
 * Cheap, synchronous warnings attached to a single write's response, so a problem shows up at the
 * point of capture instead of only in the nightly-style audit. Never blocks the write.
 */
export function warningsForReceipt(r: ReceiptRecord): string[] {
  const w: string[] = [];
  if (r.branches["n-qfs"] === "fail" && !r.stageData["n-reject"]?.["Reason for rejection"]) {
    w.push("This truck is rejected but has no recorded reason — doc §3 requires the record to persist WITH a reason.");
  }
  for (const [stageId, fields] of Object.entries(r.stageData)) {
    const vals = Object.values(fields);
    if (vals.length && vals.every((v) => String(v).trim() === "")) {
      w.push(`Stage "${stageId}" counts as reached but every field is blank — this affects the derived status.`);
    }
  }
  const g = Number(r.stageData["n-gross"]?.["GROSS WT KGS"]);
  const n = Number(r.stageData["n-netwt"]?.["NET WT KGS"]);
  const s = Number(r.stageData["n-unload"]?.["SACS (bags)"]);
  if (Number.isFinite(g) && Number.isFinite(n) && Number.isFinite(s) && g && n && s && Math.abs(g - s - n) >= 0.5) {
    w.push(`Net weight ${n} does not equal Gross ${g} − bag count ${s}, which is the rule the imported data follows.`);
  }
  return w;
}

/**
 * The production twins of warningsForReceipt, for the { data, warnings } envelope
 * routes/production.ts returns on every mutating call. Deliberately minimal right now: this pass
 * has no seeded production data yet (see the plan's "Deferred" section — the extractor is a later
 * pass), so there is no measured real-data pattern to warn about yet the way warningsForReceipt's
 * three checks were built from the 50 real seeded receipts. Extension points, not empty forever.
 */
export function warningsForBtm(_row: { btmNo: string; binNo: string }): string[] {
  return [];
}

export function warningsForLot(_row: { lotNo: string; binNo: string }): string[] {
  return [];
}
