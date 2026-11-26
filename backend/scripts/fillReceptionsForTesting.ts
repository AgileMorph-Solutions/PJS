/**
 * DEV-ONLY TEST DATA (the user's request, 24 Nov 2026). Fills the EMPTY required fields of every truck in the LOCAL database's
 * Reception, phase by phase (contract domain/phaseGate.ts: Arrival → Weight → Quality → Unloading → Bin → GRN), so the whole
 * flow can be tested end to end on the imported 2026 trucks, most of which the workbooks left half filled.
 *
 * This invents values, which the repo's rule forbids for real data — so it is only ever for a throwaway local database, and:
 *   - it refuses to run with NODE_ENV=production;
 *   - a value already recorded is never changed: only blanks are filled;
 *   - filled numbers follow the same warehouse's own recorded values (their median, varied a little per truck), and agree
 *     with each other: bags × ~80 kg = weight, final readings close to the sample ones, offloading on the arrival day;
 *   - calculated fields (total bags, net, paid, amount) are left to the app's own rules, written through the services;
 *   - a rejected truck stays rejected: it gets Arrival, Weight and Quality (and a reason if it had none), nothing after.
 * Back the database up first. Usage (in the backend container): npx tsx scripts/fillReceptionsForTesting.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";
import type { ReceiptRecord } from "@anagroci/contract/types/receipt";
import { computeDerivedFields, parseQty } from "@anagroci/contract/domain/receiptMath";
import { FINALISED_SAME_DAY, FINALISED_WHEN_LABEL } from "@anagroci/contract/domain/binFinalise";
import { PHASES, missingFields } from "@anagroci/contract/domain/phaseGate";
import { finaliseBin, listReceipts, setBranch, setStageFields } from "../src/services/receipts.js";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to run: this script invents test data and is for a local database only.");
const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

type StageData = ReceiptRecord["stageData"];
const get = (sd: StageData, s: string, l: string) => (sd[s]?.[l] ?? "").trim();
const num = (sd: StageData, s: string, l: string) => parseQty(get(sd, s, l));
const round = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

/** A stable small number from the receipt id, so every truck gets its own, repeatable variation. */
function jitter(id: string, salt: string): number {
  let h = 2166136261;
  for (const c of id + salt) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 2001) / 1000 - 1; // -1 … 1
}

function median(xs: number[], fallback: number): number {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)]! : fallback;
}
function mode(xs: string[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const x of xs) if (x) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}

/** What one warehouse's own records look like: what blanks are filled from. Fallbacks only where it recorded nothing. */
function profileOf(rs: ReceiptRecord[]) {
  const nums = (s: string, l: string) => rs.map((r) => num(r.stageData, s, l)).filter((x): x is number => x !== undefined && x > 0);
  const texts = (s: string, l: string) => rs.map((r) => get(r.stageData, s, l));
  return {
    creditCash: mode(texts("n-gate", "CREDIT/CASH"), "CREDIT"),
    whLocation: mode(texts("n-gate", "WH LOCATION"), rs[0]?.warehouse ?? ""),
    origin: mode(texts("n-verify", "ORIGIN"), ""),
    bags: median(nums("n-unload", "SACS (bags)"), 600),
    sampleMoisture: median(nums("n-qfs", "Sample moisture (%)"), 9),
    sampleNuts: median(nums("n-qfs", "Sample nut count"), 180),
    kor: median(nums("n-qfs", "KOR"), 46),
    finalMoisture: median(nums("n-qfs", "Final moisture (%)"), 9),
    price: median(nums("n-grn", "PRICE"), 425),
  };
}

interface Plan { id: string; steps: { what: string; run: () => Promise<unknown> }[]; fields: number }

async function main() {
  const receipts = await listReceipts();
  const admin = await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true, displayName: true } });
  if (!admin) throw new Error("No admin user to finalise Bins as.");
  const bins = await prisma.bin.findMany({ select: { code: true, warehouseName: true } });
  const sites = await prisma.warehouse.findMany({ select: { name: true, site: true } });
  const siteOf = (name: string | null) => (name ? sites.find((w) => w.name === name)?.site ?? name : null);
  const usedFiches = new Set(receipts.map((r) => get(r.stageData, "n-verify", "FICHE")).filter(Boolean));
  let nextFiche = 990001;

  const byWarehouse = new Map<string, ReceiptRecord[]>();
  for (const r of receipts) byWarehouse.set(siteOf(r.warehouse) ?? r.warehouse, [...(byWarehouse.get(siteOf(r.warehouse) ?? r.warehouse) ?? []), r]);

  const plans: Plan[] = [];
  const missingBefore = new Map<string, number>();
  for (const [site, rs] of byWarehouse) {
    const p = profileOf(rs);
    const siteBins = bins.filter((b) => siteOf(b.warehouseName) === site).map((b) => b.code).sort();
    console.log(`\n${site}: ${rs.length} trucks · ${siteBins.length} Bins in the master · profile`, p);
    rs.forEach((r, i) => {
      const sd = r.stageData;
      const j = (salt: string) => jitter(r.id, salt);
      const fill = (stageId: string, values: Record<string, string>) => Object.fromEntries(Object.entries(values).filter(([l, v]) => v !== "" && !get(sd, stageId, l)));
      const steps: Plan["steps"] = [];
      let fields = 0;
      const write = (stageId: string, values: Record<string, string>) => {
        const f = fill(stageId, values);
        const n = Object.keys(f).length;
        if (!n) return;
        fields += n;
        for (const l of Object.keys(f)) missingBefore.set(`${stageId} · ${l}`, (missingBefore.get(`${stageId} · ${l}`) ?? 0) + 1);
        steps.push({ what: `${stageId}: ${Object.keys(f).join(", ")}`, run: () => setStageFields(r.id, stageId, f) });
      };

      // ── Arrival ──
      let fiche = get(sd, "n-verify", "FICHE");
      if (!fiche) { while (usedFiches.has(String(nextFiche))) nextFiche++; fiche = String(nextFiche++); usedFiches.add(fiche); }
      write("n-gate", { "DATE OF ARRIVAL": r.arrivalDate, "CREDIT/CASH": p.creditCash, "WH LOCATION": p.whLocation, "VEHICLE NO.": r.vehicleNo || `TST${String(i + 1).padStart(4, "0")}` });
      write("n-verify", { "SUPPLIERS NAME": r.supplierName, "LBA CODE": r.lbaCode, FICHE: fiche, "FICHE CODE": get(sd, "n-verify", "FICHE CODE") || fiche, ORIGIN: p.origin });

      // ── Weight: bags × about 81 kg (80 kg of RCN and the 1 kg bag), from whichever of the two is already known. ──
      const knownBags = num(sd, "n-unload", "SACS (bags)") ?? computeDerivedFields(sd)["n-unload"]?.["SACS (bags)"];
      const gross0 = num(sd, "n-gross", "GROSS WT KGS");
      const bags = Number(knownBags ?? (gross0 ? round(gross0 / 81) : round(p.bags * (1 + 0.05 * j("bags")))));
      const gross = gross0 ?? round(bags * (81 + 2 * j("kg")));
      // In the app Gross is never typed: it is loaded truck − empty truck. So a missing one is filled through those two,
      // with an empty truck of about 15 t.
      if (gross0 === undefined) {
        const tare = num(sd, "n-gross", "Tare / empty truck weight (kg)") ?? round(15000 + 1500 * j("tare"));
        write("n-gross", { "Tare / empty truck weight (kg)": String(tare), "Loaded truck weight (kg)": String(tare + gross) });
      }

      // ── Quality (truck sampling) ──
      const sMoist = num(sd, "n-qfs", "Sample moisture (%)") ?? round(p.sampleMoisture + 0.8 * j("sm"), 1);
      const sNuts = num(sd, "n-qfs", "Sample nut count") ?? round(p.sampleNuts + 8 * j("sn"));
      const kor = num(sd, "n-qfs", "KOR") ?? round(p.kor + 1.2 * j("kor"), 2);
      write("n-qfs", { "Sample moisture (%)": String(sMoist), "Sample nut count": String(sNuts), KOR: String(kor) });

      const decision = r.branches["n-qfs"];
      if (decision === "fail") {
        if (!get(sd, "n-reject", "Reason for rejection")) {
          steps.push({ what: "n-qfs: rejected, reason recorded", run: () => setBranch(r.id, "n-qfs", "fail", "Quality below standard (test data)") });
        }
        if (steps.length) plans.push({ id: r.id, steps, fields });
        return;
      }
      // Passing issues the Lot, which the Bin needs; a truck already passed without one (an imported row) gets it too.
      if (decision !== "pass" || !r.lotNo) steps.push({ what: "n-qfs: pass (issues the Lot)", run: () => setBranch(r.id, "n-qfs", "pass") });

      // ── Unloading: good + damp + torn = the bags, so the total the app works out is the one already known. ──
      const torn = num(sd, "n-unload", "Sacs déchirés (torn bags)") ?? Math.min(3, Math.max(0, round(1.5 + 1.5 * j("torn"))));
      const damp = num(sd, "n-unload", "HUMID SACS (damp bags)") ?? 0;
      const good = num(sd, "n-unload", "BON SACS (good bags)") ?? Math.max(bags - torn - damp, 0);
      write("n-unload", {
        "DATE OF OFFLOADING": r.arrivalDate,
        "BON SACS (good bags)": String(good),
        "HUMID SACS (damp bags)": String(damp),
        "Sacs déchirés (torn bags)": String(torn),
        "Reconditioning of torn bags": String(Math.min(torn, num(sd, "n-unload", "Reconditioning of torn bags") ?? 0)),
        Refraction: "0",
      });

      // ── Bin: one of this warehouse's own master Bins, then finalised as the app does it. ──
      // The Bin already recorded is kept; a new one must be a master Bin of this warehouse (the app refuses any other).
      const binNo = get(sd, "n-bin", "Bin Number") || (siteBins.includes((r.binNo ?? "").trim().toUpperCase()) ? r.binNo!.trim().toUpperCase() : "") || siteBins[i % Math.max(siteBins.length, 1)] || "";
      write("n-bin", { "Bin Number": binNo, "Basis for allocation (moisture / quality / KOR / space)": "KOR", [FINALISED_WHEN_LABEL]: FINALISED_SAME_DAY });
      if (binNo && !get(sd, "n-bin", "Bin allocation date")) {
        fields++;
        missingBefore.set("n-bin · Bin allocation date", (missingBefore.get("n-bin · Bin allocation date") ?? 0) + 1);
        steps.push({ what: "n-bin: finalised", run: () => finaliseBin(r.id, admin) });
      }

      // ── Quality (final readings), close to the sample ones ──
      write("n-qfs", {
        "Final moisture (%)": String(round(sMoist - 0.3 + 0.4 * j("fm"), 1)),
        "Final nut count": String(round(sNuts + 4 * j("fn"))),
        "FINAL KOR": String(round(kor + 0.6 * j("fk"), 2)),
      });

      // ── GRN last: completing it locks the record and puts the truck in stock. Its weight is the net, as the form proposes. ──
      // The net, as the form proposes — unless the workbook's own gross makes it 0 or less (a gross of 0 was recorded on some
      // imported trucks): a GRN can't be negative, so those get 80 kg a bag instead (24 Nov 2026, after 197 came out negative).
      const recordedNet = parseQty(get(sd, "n-netwt", "NET WT KGS"));
      const net = recordedNet ?? gross - (good + damp + torn);
      const grn = net > 0 ? net : (good + damp + torn) * 80;
      write("n-grn", { "GRN Weight (kept separate from Gross/Net/Paid)": String(round(grn)), PRICE: String(round(p.price + 5 * j("price"))) });

      if (steps.length) plans.push({ id: r.id, steps, fields });
    });
  }

  console.log("\nEmpty required fields to fill:");
  for (const [k, n] of [...missingBefore].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log(`\n${plans.length} of ${receipts.length} trucks would change, ${plans.reduce((a, p) => a + p.fields, 0)} fields.`);
  if (!APPLY) { console.log("Dry run. Re-run with --apply to write."); return; }

  let done = 0;
  const failed: { id: string; what: string; error: string }[] = [];
  for (const plan of plans) {
    for (const step of plan.steps) {
      try { await step.run(); } catch (e) { failed.push({ id: plan.id, what: step.what, error: e instanceof Error ? e.message : String(e) }); break; }
    }
    if (++done % 50 === 0) console.log(`  ${done}/${plans.length}`);
  }
  console.log(`\nDone: ${plans.length - new Set(failed.map((f) => f.id)).size} trucks completed, ${failed.length} stopped.`);
  for (const f of failed.slice(0, 30)) console.log(`  ${f.id} · ${f.what} · ${f.error}`);

  // What is still missing, phase by phase, as the app's own gate sees it.
  const after = await listReceipts();
  const gaps = new Map<string, number>();
  for (const r of after) {
    const phases = r.branches["n-qfs"] === "fail" ? [PHASES.ARRIVAL, PHASES.WEIGHT, PHASES.QUALITY_SAMPLE] : Object.values(PHASES);
    for (const ph of phases) for (const m of missingFields(r.stageData, ph)) gaps.set(`${ph.title} · ${m}`, (gaps.get(`${ph.title} · ${m}`) ?? 0) + 1);
  }
  console.log(gaps.size ? "\nStill missing:" : "\nEvery truck's required fields are filled.");
  for (const [k, n] of gaps) console.log(`  ${String(n).padStart(4)}  ${k}`);
}

main().finally(() => prisma.$disconnect());
