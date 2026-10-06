/**
 * SEED_MODE=demo: a small, INVENTED data set in place of the client's real workbooks, so every
 * section of a receipt's detail page has something to show — Lot, Bin, GRN, drying, dispatch,
 * receiving at the central site, transfer, production issue.
 *
 * This deliberately breaks the repo's "never fabricate data" rule, on explicit request. The names
 * are realistic so screens read naturally, which means the data is NOT self-evidently fake: the
 * marker is `source = "demo"` on every master and downstream row, and none of it runs unless
 * SEED_MODE=demo is set. The real-data seed is untouched.
 *
 * Receipts, Lots, plans and transfers go through the same services the API uses, so their IDs are
 * the system-issued ones (REC-BKE01-2026-001, LOT-…, DP-…, BKT-…) and the derived weights are
 * computed, not typed. Only the downstream sheets (drying, dispatch, receiving, transfer receipt,
 * production issue) are written directly, because the app has no screen that creates them — they
 * arrive by workbook upload — and they join back to a receipt on its FICHE and Lot, exactly as the
 * real rows do (see services/receiptLinks.ts).
 */
import type { PrismaClient } from "@prisma/client";
import { createReceipt, patchReceipt, setStageFields, setBranch } from "../src/services/receipts.js";
import { createDeliveryPlan } from "../src/services/deliveryPlans.js";
import { createTransfer, setTransferStatus } from "../src/services/transfers.js";

const SITE = "BOUAKE";
const CENTRAL = "YAKRO FACTORY";
const SOURCE = "demo";

type Spec = { stop: Stop; drying?: "direct" | "indirect"; dried?: "done" | "running"; issued?: boolean };

interface Made { id: string; lot: string | null; fiche: string; bin: string | null; spec: Spec; i: number; bags: number; net: number; site: string; store: string; arrival: string }


const SUPPLIERS = [
  { code: "LBA-101-AKI", name: "RCN SCOOP AKISSI" },
  { code: "LBA-102-BAK", name: "RCN SCOOP BAKARY" },
  { code: "LBA-103-COU", name: "RCN SCOOP COULIBALY" },
  { code: "LBA-104-DIA", name: "RCN SCOOP DIABATE" },
  { code: "LBA-105-KON", name: "RCN SCOOP KONE" },
  { code: "LBA-106-OUA", name: "RCN SCOOP OUATTARA" },
];
const ORIGINS = ["DIANRA", "KORHOGO", "BOUAKE", "SEGUELA"];
const DRIVERS = ["KOUASSI YAO", "TRAORE ISSA", "SORO LASSINA", "KONAN BROU"];
const truckOf = (i: number) => `${2400 + i * 53}GE0${1 + (i % 4)}`;
const BOUAKE_BINS = ["BKE-001", "BKE-002", "BKE-003"];
const CENTRAL_BINS = ["BIN-001", "BIN-002", "BIN-003", "BIN-004"];
/** The store inside the Yakro factory site — what the central sheets call "warehouse". */
const CENTRAL_STORE = "ANAGROCI-01";
/** The central warehouse has no code from the client yet, and no ID can be issued without one — so
 * the demo gives it one. Only demo mode does this; real data still waits for an admin. */
const CENTRAL_CODE = "YAK01";

type Stop = "arrived" | "pending_qa" | "rejected" | "pending_unload" | "unloaded" | "grn" | "stock" | "drying" | "transferred";

/** One row per demo truck: how far it got. Order is arrival order. */
const PLAN: { stop: Stop; drying?: "direct" | "indirect"; dried?: "done" | "running"; issued?: boolean }[] = [
  { stop: "arrived" }, { stop: "arrived" }, { stop: "arrived" },
  { stop: "pending_qa" }, { stop: "pending_qa" },
  { stop: "rejected" }, { stop: "rejected" },
  { stop: "pending_unload" }, { stop: "pending_unload" }, { stop: "pending_unload" },
  { stop: "unloaded" }, { stop: "unloaded" }, { stop: "unloaded" },
  { stop: "grn" }, { stop: "grn" }, { stop: "grn" }, { stop: "grn" },
  { stop: "stock" }, { stop: "stock" }, { stop: "stock" },
  { stop: "drying", drying: "direct", dried: "running" }, { stop: "drying", drying: "indirect", dried: "running" },
  { stop: "drying", drying: "indirect", dried: "done" }, { stop: "drying", drying: "direct", dried: "done" },
  { stop: "transferred", issued: true }, { stop: "transferred", issued: true }, { stop: "transferred" }, { stop: "transferred" },
];

const REACHED: Record<Stop, number> = {
  arrived: 0, pending_qa: 1, rejected: 1, pending_unload: 2, unloaded: 3, grn: 4, stock: 5, drying: 6, transferred: 7,
};

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString().slice(0, 10); // from 2026-09-01

export async function seedDemoData(prisma: PrismaClient): Promise<void> {
  if ((await prisma.receipt.count()) > 0) {
    console.log("Database already has receipts - demo data skipped.");
    return;
  }

  await prisma.warehouse.update({ where: { name: CENTRAL }, data: { code: CENTRAL_CODE } });
  await prisma.supplier.createMany({ data: SUPPLIERS.map((s) => ({ ...s, source: SOURCE })), skipDuplicates: true });
  await prisma.origin.createMany({ data: ORIGINS.map((name) => ({ name, source: SOURCE })), skipDuplicates: true });
  await prisma.bin.createMany({
    data: [...BOUAKE_BINS, ...CENTRAL_BINS].map((code) => ({ code, warehouseName: null, source: SOURCE })), skipDuplicates: true,
  });

  // Delivery plans: the first few Bouaké trucks arrive against one; two are still waiting. The
  // central site has two of its own.
  const plans: string[] = [];
  for (let i = 0; i < 6; i++) {
    const s = SUPPLIERS[i % SUPPLIERS.length];
    const p = await createDeliveryPlan({
      supplierName: s.name, supplierCode: s.code, expectedQuantityKg: 24000 + i * 1500, expectedTruckType: "Semi-trailer",
      expectedArrivalDate: i < 4 ? day(i * 2) : day(40 + i), plannedDeliveryDate: i < 4 ? day(i * 2) : day(40 + i),
      destinationWarehouse: SITE, remarks: i === 5 ? "Truck announced by the supplier, not yet arrived" : null,
    });
    plans.push(p.id);
  }
  const centralPlans: string[] = [];
  for (let i = 0; i < 3; i++) {
    const s = SUPPLIERS[(i + 3) % SUPPLIERS.length];
    const date = i < 2 ? day(32 + i) : day(46);
    const p = await createDeliveryPlan({
      supplierName: s.name, supplierCode: s.code, expectedQuantityKg: 30000 + i * 2000, expectedTruckType: "Semi-trailer",
      expectedArrivalDate: date, plannedDeliveryDate: date, destinationWarehouse: CENTRAL,
      remarks: i === 2 ? "Direct delivery announced, not yet arrived" : "Direct delivery to the factory",
    });
    centralPlans.push(p.id);
  }

  /** One truck, taken as far as `spec` says, through the same services the app uses. */
  async function buildReceipt(o: {
    site: string; store: string; bins: string[]; i: number; spec: Spec; arrival: string; fiche: string; ficheCode: string;
    supplier: (typeof SUPPLIERS)[number]; origin: string; vehicle: string; planId?: string; stockType: string;
  }): Promise<Made> {
    const { site, store, bins, i, spec, arrival, fiche, supplier, origin, vehicle } = o;
    const reached = REACHED[spec.stop];

    const rec = await createReceipt(site, arrival, o.planId);
    const id = rec.id;
    await patchReceipt(id, { supplierName: supplier.name, lbaCode: supplier.code, vehicleNo: vehicle, origin });

    await setStageFields(id, "n-gate", {
      "S N": String(i + 1), "DATE OF ARRIVAL": arrival, "CREDIT/CASH": i % 3 === 0 ? "CASH" : "CREDIT",
      "WH LOCATION": site, "WH NO.": store, "VEHICLE NO.": vehicle, "REMARKS": "",
    });
    await setStageFields(id, "n-verify", {
      "SUPPLIERS NAME": supplier.name, "LBA CODE": supplier.code, "FICHE CODE": o.ficheCode, "FICHE": fiche, "ORIGIN": origin,
    });
    const loaded = 38000 + (i % 7) * 900;
    let bags = 0;
    let net = 0;
    if (reached >= 1) {
      await setStageFields(id, "n-gross", { "Loaded truck weight (kg)": String(loaded) });
      await setStageFields(id, "n-qfs", {
        "MOIS. (moisture)": (9.5 + (i % 5) * 0.4).toFixed(1), "NUT COUNT": String(168 + (i % 6) * 3),
        "KOR": (46 + (i % 6) * 0.7).toFixed(2), "FINAL KOR": (46.4 + (i % 6) * 0.7).toFixed(2),
      });
    }
    if (spec.stop === "rejected") {
      await setBranch(id, "n-qfs", "fail", "Moisture above the accepted limit");
    } else if (reached >= 2) {
      await setBranch(id, "n-qfs", "pass"); // issues the Lot
    }
    if (reached >= 3) {
      const good = 430 + (i % 5) * 12;
      const damp = i % 4;
      const torn = 3 + (i % 5);
      bags = good + damp + torn;
      await setStageFields(id, "n-tare", { "Tare / empty truck weight (kg)": String(Math.round(loaded * 0.18)) });
      await setStageFields(id, "n-unload", {
        "DATE OF OFFLOADING": arrival, "BON SACS (good bags)": String(good), "HUMID SACS (damp bags)": String(damp),
        "Sacs déchirés (torn bags)": String(torn), "Refraction": String(40 + (i % 4) * 10),
      });
    }
    if (reached >= 4) await setStageFields(id, "n-grn", { "PRICE": String(450 + (i % 4) * 10) });

    const lot = (await prisma.stageLotAssignment.findUnique({ where: { receiptId: id }, select: { lotNumber: true } }))?.lotNumber ?? null;
    let bin: string | null = null;
    if (lot && reached >= 4) {
      bin = bins[i % bins.length];
      await setStageFields(id, "n-bin", {
        "Bin Number": bin, "Linked Lot Number(s)": lot,
        "Basis for allocation (moisture / quality / KOR / space)": "Moisture", "Finalised (same day / next day)": "Same day",
      });
    }
    if (reached >= 5) {
      await setStageFields(id, "n-stock", {
        "Warehouse stock ledger entry": `Stock in - ${lot ?? "no Lot"}`, "Warehouse type (Village/Regional/Factory)": o.stockType,
      });
    }
    if (spec.drying) {
      await setBranch(id, "n-drying", spec.drying);
      await setStageFields(id, "n-drying", {
        "Decision (Direct to drying / Warehouse → Drying)": spec.drying === "direct" ? "Direct to drying" : "Warehouse → Drying",
        "Moisture % — before drying": (11.5 + (i % 3) * 0.3).toFixed(1),
        ...(spec.dried === "done" ? { "Moisture % — after drying": "8.6", "Original Lot/truck traceability retained": "Yes" } : {}),
      });
    }
    net = bags ? loaded - Math.round(loaded * 0.18) - bags : 0; // gross − 1 kg per bag (contract receiptMath)
    return { id, lot, fiche, bin, spec, i, bags, net, site, store, arrival };
  }

  // Drying batch rows — the "drying status" on the receipt's linked records. One sheet-style
  // serial per store, as in the real workbook.
  const dryingSn = new Map<string, number>();
  async function dryingBatch(m: Made, bins: string[]) {
    if (!m.spec.drying || !m.lot) return;
    const done = m.spec.dried === "done";
    const sn = (dryingSn.get(m.store) ?? 0) + 1;
    dryingSn.set(m.store, sn);
    const date = m.arrival;
    await prisma.dryingBatch.create({
      data: {
        sn, dryingDate: new Date(date), dryingDateRaw: date, warehouseSite: m.site, warehouse: m.store,
        sourceBinNo: m.bin, destinationBinNo: done ? bins[bins.length - 1] : null, lotNoRaw: m.lot, lotNo: m.lot, ficheNoRaw: m.fiche,
        supplierNameRaw: SUPPLIERS[m.i % SUPPLIERS.length].name, status: done ? "COMPLETED" : "IN PROGRESS", dryType: "SUN DRYING",
        destinationRaw: done ? bins[bins.length - 1] : null, inputBagsForDrying: m.bags, outputBagsAfterDrying: done ? m.bags : null,
        inputMoisturePct: "11.8", outputMoisturePct: done ? "8.6" : null, inputKor: "47.2", outputKor: done ? "48.1" : null,
        issuedNetWeightKg: m.net, receivedNetWeightKg: done ? Math.round(m.net * 0.93) : null, dryingLossKg: done ? m.net - Math.round(m.net * 0.93) : null,
        source: SOURCE, sheetRow: sn,
      },
    });
  }

  // ── Bouaké (unit) ───────────────────────────────────────────────────────
  const made: Made[] = [];
  for (let i = 0; i < PLAN.length; i++) {
    made.push(await buildReceipt({
      site: SITE, store: BOUAKE_BINS[i % 3], bins: BOUAKE_BINS, i, spec: PLAN[i], arrival: day(i + 1), fiche: String(88100 + i),
      ficheCode: `0401-${String(i + 1).padStart(4, "0")}`, supplier: SUPPLIERS[i % SUPPLIERS.length], origin: ORIGINS[i % ORIGINS.length],
      vehicle: `${1200 + i * 37}KT0${1 + (i % 4)}`, planId: i < 4 ? plans[i] : undefined, stockType: "Regional",
    }));
  }
  for (const m of made) await dryingBatch(m, BOUAKE_BINS);

  // ── Transfers Bouaké → Yakro ────────────────────────────────────────────
  // One transfer request per trip through the real service, plus the paper trail on each side:
  // the dispatch at Bouaké, and — for the trip that has arrived — the truck's own reception at the
  // factory, which gets its own Lot there. The two ends share the batch's FICHE, which is what the
  // detail page joins on, so each Lot shows the other's records.
  const moved = made.filter((m) => m.spec.stop === "transferred" && m.lot);
  const trips = [moved.slice(0, 2), moved.slice(2)];
  const central: Made[] = [];
  let sheetRow = 1;
  let tsn = 1;
  let btmSeq = 1;
  for (const [n, group] of trips.entries()) {
    if (!group.length) continue;
    const date = day(30 + n * 3);
    const t = await createTransfer({
      transferDate: date, fromWarehouse: SITE, toWarehouse: CENTRAL, remarks: "Regular weekly transfer to the factory",
      lines: group.map((m) => ({ receiptId: m.id, bags: m.bags, netWeightKg: m.net })),
    });
    await setTransferStatus(t.id, "dispatched");
    if (n === 0) await setTransferStatus(t.id, "received");

    for (const m of group) {
      await prisma.warehouseDispatchLine.create({
        data: {
          sn: sheetRow, chargeDate: new Date(date), chargeDateRaw: date, warehouseSite: SITE, vyogeNumber: t.id, vyogeNumberRaw: t.id,
          warehouse: BOUAKE_BINS[0], bin: m.bin, truckNo: truckOf(m.i), transporter: "TRANSPORT KONE & FILS", driver: DRIVERS[m.i % DRIVERS.length],
          ficheCca: m.fiche, totalBags: m.bags, binwiseLoadedBags: m.bags, netWeight: m.net, status: "DISPATCHED",
          source: SOURCE, sheetRow: sheetRow++,
        },
      });
      if (n !== 0) continue;

      // Received at the factory: the truck is a receipt there, taken through reception to the stage
      // the batch has reached (the one that was issued to production went through drying first).
      const at = await buildReceipt({
        site: CENTRAL, store: CENTRAL_STORE, bins: CENTRAL_BINS, i: central.length, arrival: date, fiche: m.fiche,
        ficheCode: `0501-${String(tsn).padStart(4, "0")}`, supplier: SUPPLIERS[m.i % SUPPLIERS.length], origin: ORIGINS[m.i % ORIGINS.length],
        vehicle: truckOf(m.i), stockType: "Factory",
        spec: m.spec.issued ? { stop: "drying", drying: "direct", dried: "done" } : { stop: "stock" },
      });
      central.push(at);

      await prisma.warehouseDischarge.create({
        data: {
          sn: tsn, warehouseSite: CENTRAL, warehouse: CENTRAL_STORE, lotNo: at.lot ?? String(tsn),
          ficheCca: m.fiche, truckNo: truckOf(m.i), arrivalDate: new Date(date), arrivalDateRaw: date,
          supplierName: SUPPLIERS[m.i % SUPPLIERS.length].name, totalRecd: m.bags, netWeight: m.net, source: SOURCE, sheetRow: tsn,
        },
      });
      // The transfer receipt, whose idTransfer is the production BTM number.
      const btmNo = m.spec.issued ? `BTM-${String(btmSeq++).padStart(3, "0")}` : null;
      await prisma.juteWarehouseTransferReceipt.create({
        data: {
          sn: tsn, receivedDate: new Date(date), rawDate: date, idTransfer: btmNo, truckRegistration: truckOf(m.i),
          lotNo: m.lot, noFiche: m.fiche, binNo: m.bin, sourceWarehouse: SITE, destinationWarehouse: CENTRAL,
          destinationProvenance: "inferred", origin: ORIGINS[m.i % ORIGINS.length], bagsDispatched: m.bags, bagsReceived: m.bags,
          netWeightDispatched: m.net,
        },
      });
      if (btmNo) {
        const prodBin = `ANA-0${btmSeq - 1}A`;
        await prisma.productionBin.create({ data: { binNo: prodBin, source: SOURCE } });
        await prisma.btmIntake.create({ data: { btmNo, binNo: prodBin, source: SOURCE } });
        await prisma.issuedToProduction.create({
          data: { btmNo, date: day(36), sourceBin: at.bin, dryBin: prodBin, binStatus: "ISSUED", source: SOURCE, sheetRow: tsn },
        });
      }
      tsn++;
    }
  }

  // ── Yakro Factory: trucks that came straight from suppliers ─────────────
  const direct: Spec[] = [
    { stop: "stock" }, { stop: "drying", drying: "indirect", dried: "running" }, { stop: "unloaded" }, { stop: "pending_qa" },
  ];
  for (const [k, spec] of direct.entries()) {
    const i = central.length;
    central.push(await buildReceipt({
      site: CENTRAL, store: CENTRAL_STORE, bins: CENTRAL_BINS, i, spec, arrival: day(33 + k), fiche: String(99100 + k),
      ficheCode: `0501-${String(100 + k).padStart(4, "0")}`, supplier: SUPPLIERS[(k + 3) % SUPPLIERS.length], origin: ORIGINS[(k + 1) % ORIGINS.length],
      vehicle: `${3100 + k * 41}AB0${1 + (k % 4)}`, planId: k < 2 ? centralPlans[k] : undefined, stockType: "Factory",
    }));
  }
  for (const m of central) await dryingBatch(m, CENTRAL_BINS);

  console.log(
    `Demo data: ${made.length} Bouaké + ${central.length} Yakro receipts, ${plans.length + centralPlans.length} delivery plans, ` +
    `${[...dryingSn.values()].reduce((a, b) => a + b, 0)} drying batches, ${moved.length} transferred.`
  );
}
