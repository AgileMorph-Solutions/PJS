/**
 * Writes docs/QUALITY_KOR_AND_LOCKING.md: the client's question "the exact form name and workflow for the KOR calculation and
 * record locking", answered from the code itself (the form definitions, the KOR formula, the lock rule) so it cannot drift from
 * what the app does. `--check` fails when the committed file is stale, like the other generated files here.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROLE_FORMS } from "../src/data/roles.ts";
import { DERIVED_RULES, KOR_FACTOR } from "../src/domain/receiptMath.ts";
import { LOCKED_DECISIONS, LOCKED_STAGES } from "../src/domain/recordLock.ts";
import { MODULE_LABELS, MODULE_STAGES } from "../src/data/modules.ts";
import { stages, rejectStage } from "../src/data/stages.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "QUALITY_KOR_AND_LOCKING.md");

const qfs = ROLE_FORMS.find((f) => f.id === "qfs-jute-check")!;
const bm = ROLE_FORMS.find((f) => f.id === "bm-reception")!;
const labelsOf = (stageId: string) => qfs.stages.find((s) => s.stageId === stageId)?.labels ?? [];
const korRules = DERIVED_RULES.filter((r) => r.target[1] === "KOR" || r.target[1] === "FINAL KOR");
const TITLES = new Map([...stages, rejectStage].map((s) => [s.id, s.title] as const));
const titleOf = (id: string) => TITLES.get(id) ?? id;

const body = `# Quality (KOR) and record locking: the form, the workflow, the rule

_Generated from the application's own definitions (\`npm run gen\` in packages/contract). Do not edit by hand._

## 1. The form

**"${qfs.title}"** is the form the QFS Officer fills for a truck. It is a form of the **${titleOf("n-qfs")}** step.

| Part | Fields |
|---|---|
| Quality readings and cut test | ${labelsOf("n-qfs").join(", ")} |
| Jute bags | ${labelsOf("n-unload").join(", ")} |

The **Pass / Fail** decision is **not** part of this form: the Warehouse Incharge records it, because a Fail rejects the truck
(a reason is then required, and the rejected truck stays on record).

## 2. How KOR is calculated

${korRules.map((r) => `- **${r.target[1]}** = ${r.formula}`).join("\n")}

- The constant is **${KOR_FACTOR}** (80 lb of kernels per 1000 g sample), taken from the client's own Warehouse Receiving sheet.
- Enter the cut-test grams and KOR is **calculated by the application** and shown read-only.
- If the grams are not entered, KOR can still be **typed**, as every 2026 truck was recorded.
- Once the grams are recorded, the calculated KOR replaces a typed one and can no longer be edited by hand.

## 3. The workflow

1. The **QFS Officer** submits the form above for the truck.
2. The **Warehouse Incharge** reviews it and approves (or rejects) the submission. Until it is approved, nothing is written to the truck.
3. On approval the values are written to the truck's quality step, with who submitted, who approved, and when.
4. The Warehouse Incharge records **Pass** (the truck gets its Lot Number automatically) or **Fail** (with a reason).
5. The **Branch Manager's** separate form ("${bm.title}") covers ${bm.stages.flatMap((s) => s.labels).join(", ")}, and is approved the same way.

## 4. Record locking

A truck's reception record **locks automatically when its GRN is complete**: the GRN quantity and the price are both recorded
(in either order; they are entered by different people).

- **What locks:** the reception record from the gate to the GRN. ${[...LOCKED_STAGES].map((s) => titleOf(s)).join("; ")}; and the Pass / Fail decision (${[...LOCKED_DECISIONS].map(titleOf).join(", ")}).
- **What stays open:** the steps that follow the GRN: the system's stock update, the drying decision and drying, other warehouse
  activities, and the transfer decision.
- **A locked record cannot be changed** from the screens or by an Excel upload (the upload reports the row as an error).
- **Bin allocation** has its own close: pressing **Finalise** stamps the bin allocation date and who did it, and closes that step.
- **Only an Admin can reopen** a locked record or a finalised bin, and must give a **reason**, which is kept on the truck's timeline
  together with who reopened it. It locks again by itself the next time its GRN is completed.
- Records that existed before locking was introduced are **not** locked retroactively.

## 5. The two receiving modules

${(Object.keys(MODULE_STAGES) as (keyof typeof MODULE_STAGES)[]).map((m) => `- **${MODULE_LABELS[m]}**: ${MODULE_STAGES[m].map(titleOf).join(" → ")}`).join("\n")}
`;

const check = process.argv.includes("--check");
if (check) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== body) {
    console.error("docs/QUALITY_KOR_AND_LOCKING.md is STALE: run `npm run gen` and commit the result.");
    process.exit(1);
  }
  console.log("QUALITY_KOR_AND_LOCKING.md up to date.");
} else {
  writeFileSync(OUT, body);
  console.log(`Wrote ${OUT}`);
}
