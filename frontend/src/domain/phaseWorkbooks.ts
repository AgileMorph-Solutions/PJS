import { stages } from "../data/stages";

export interface PhaseWorkbook {
  phase: string;
  /** file -> sheet(s) referenced by stages in this phase, in stage order, de-duplicated */
  files: { file: string; sheet?: string }[];
}

/** Derived from stages.ts (the field dictionary) rather than hand-maintained, so it can't drift:
 * which real workbook backs each phase, if any. Most phases are still doc-only/new-requirement —
 * that's shown as plainly as the ones with a real file behind them. */
export function getPhaseWorkbooks(): PhaseWorkbook[] {
  const order: string[] = [];
  const byPhase = new Map<string, { file: string; sheet?: string }[]>();

  for (const s of stages) {
    if (!byPhase.has(s.phase)) {
      byPhase.set(s.phase, []);
      order.push(s.phase);
    }
    if (s.file) {
      const list = byPhase.get(s.phase)!;
      if (!list.some((f) => f.file === s.file)) {
        list.push({ file: s.file, sheet: s.sheet });
      }
    }
  }

  return order.map((phase) => ({ phase, files: byPhase.get(phase) ?? [] }));
}
