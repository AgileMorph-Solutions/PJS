/**
 * A truck taken through every phase before the GRN the way a person does it in the app (arrival, weight, quality Pass, unloading,
 * Bin, final quality), so a test about the GRN, the price, the lock or the steps after it starts from a record the phase gates let
 * through. Writes as a person (`via: "direct"`), because that is the path the gates apply to; tests that only need rows to
 * exist can keep writing without an actor.
 *
 * The warehouse must be a real one with a Bin in the Bin master (`ensureBin`). Each call gets its own fiche and vehicle number,
 * since a fiche belongs to one truck at a warehouse.
 */
import { PrismaClient } from "@prisma/client";
import { createReceipt, finaliseBin, setBranch, setStageFields } from "../../src/services/receipts.js";

export const GRN_WEIGHT = "GRN Weight (kept separate from Gross/Net/Paid)";
let seq = 0;

/** A physical Bin for the warehouse in the Bin master, created once; returns its code. */
export async function ensureBin(prisma: PrismaClient, warehouse: string): Promise<string> {
  const code = `${warehouse}-BIN-T1`;
  await prisma.bin.upsert({ where: { code }, create: { code, warehouseName: warehouse }, update: { warehouseName: warehouse } });
  return code;
}

export interface TruckToGrnOptions {
  warehouse: string;
  actor: { id: string; displayName?: string };
  bin: string;
  arrivalDate?: string;
  supplierName?: string;
  lbaCode?: string;
  origin?: string;
  /** Stop after this phase: "weight" (arrival and weighing done, quality still to come), "pass" (the Lot is issued) or, by default, "grn" (ready for it). */
  upTo?: "weight" | "pass" | "grn";
}

export async function truckToGrn(o: TruckToGrnOptions): Promise<string> {
  const n = ++seq;
  const date = o.arrivalDate ?? "2026-11-10";
  const actor = { id: o.actor.id, via: "direct" as const };
  const id = (await createReceipt(o.warehouse, date)).id;
  await setStageFields(id, "n-gate", { "DATE OF ARRIVAL": date, "CREDIT/CASH": "CASH", "WH LOCATION": o.warehouse, "VEHICLE NO.": `TTG${n}${Date.now() % 100000}` }, { actor });
  await setStageFields(id, "n-verify", {
    "SUPPLIERS NAME": o.supplierName ?? "TTG SUPPLIER", "LBA CODE": o.lbaCode ?? (o.supplierName ? "" : "TTG-LBA"), "FICHE CODE": "0401-0007", FICHE: `TTG-${Date.now() % 1000000}-${n}`, ORIGIN: o.origin ?? "DIANRA",
  }, { actor });
  await setStageFields(id, "n-gross", { "Loaded truck weight (kg)": "56300", "Tare / empty truck weight (kg)": "15000" }, { actor });
  if (o.upTo === "weight") return id;
  await setStageFields(id, "n-qfs", {
    "Sample moisture (%)": "8.5", "Sample nut count": "170", "Sample – Good Kernel (g)": "270", "Sample – Immature (g)": "30", "Sample – Spotted (g)": "20",
  }, { actor });
  await setBranch(id, "n-qfs", "pass", undefined, { actor });
  if (o.upTo === "pass") return id;
  await setStageFields(id, "n-unload", { "DATE OF OFFLOADING": date, "BON SACS (good bags)": "463", "HUMID SACS (damp bags)": "0", "Sacs déchirés (torn bags)": "15", Refraction: "60", "Reconditioning of torn bags": "15" }, { actor });
  await setStageFields(id, "n-bin", { "Bin Number": o.bin, "Basis for allocation (moisture / quality / KOR / space)": "Moisture", "Finalised (same day / next day)": "Same day" }, { actor });
  await finaliseBin(id, { id: o.actor.id, displayName: o.actor.displayName ?? "Test" });
  await setStageFields(id, "n-qfs", {
    "Final moisture (%)": "8.2", "Final nut count": "168", "Final – Good Kernel (g)": "275", "Final – Immature (g)": "25", "Final – Spotted (g)": "20",
  }, { actor });
  return id;
}
