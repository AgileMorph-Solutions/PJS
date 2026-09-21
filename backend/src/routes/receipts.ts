// Mirrors the ReceiptRecord-related methods on TrackingApi in
// frontend/src/state/TrackingContext.tsx: createReceipt, updateReceiptField, setStageField,
// setBranch, plus list/get reads the frontend currently gets for free from `state.receipts`.
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { toReceiptRecord } from "../serialize.js";
import { assertLotBeforeBin, assertRejectionHasReason, ValidationError } from "../domain/validation.js";
import { deriveStatus } from "../domain/receiptStatus.js";
import { DECISION_BRANCHES } from "../domain/decisions.js";

async function loadReceipt(id: string) {
  return prisma.receipt.findUnique({ where: { id }, include: { timeline: true } });
}

function nextReceiptId(existingIds: string[]): string {
  const year = new Date().getFullYear();
  const max = existingIds
    .map((id) => Number(id.split("-").pop()))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `REC-${year}-${String(max + 1).padStart(4, "0")}`;
}

export async function receiptRoutes(app: FastifyInstance) {
  app.get("/api/receipts", async () => {
    const rows = await prisma.receipt.findMany({ include: { timeline: true }, orderBy: { createdAt: "asc" } });
    return rows.map(toReceiptRecord);
  });

  app.get("/api/receipts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await loadReceipt(id);
    if (!row) return reply.code(404).send({ error: `Receipt ${id} not found` });
    return toReceiptRecord(row);
  });

  // Mirrors createReceipt(): a blank receipt, id auto-assigned REC-<year>-NNNN.
  app.post("/api/receipts", async () => {
    const existing = await prisma.receipt.findMany({ select: { id: true } });
    const id = nextReceiptId(existing.map((r) => r.id));
    const now = new Date().toISOString();
    const row = await prisma.receipt.create({
      data: {
        id,
        source: "entered",
        arrivalDate: now.slice(0, 10),
        supplierName: "",
        lbaCode: "",
        vehicleNo: "",
        warehouse: "",
        stageData: "{}",
        branches: "{}",
        timeline: { create: [{ status: "planned", at: now }] },
      },
      include: { timeline: true },
    });
    return toReceiptRecord(row);
  });

  // Mirrors updateReceiptField(id, patch): a partial patch of top-level ReceiptRecord fields.
  app.patch("/api/receipts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const patch = req.body as Partial<{
      source: string;
      arrivalDate: string;
      supplierName: string;
      lbaCode: string;
      vehicleNo: string;
      warehouse: string;
      origin: string | null;
      lotNo: string | null;
      binNo: string | null;
    }>;

    const existing = await loadReceipt(id);
    if (!existing) return reply.code(404).send({ error: `Receipt ${id} not found` });

    // "" means "not assigned yet", same as null — lotNo is @unique, and multiple "" rows would
    // collide under that constraint the way multiple NULLs don't (see prisma/seed.ts's note).
    if ("lotNo" in patch) patch.lotNo = patch.lotNo || null;
    if ("binNo" in patch) patch.binNo = patch.binNo || null;

    try {
      if ("binNo" in patch) assertLotBeforeBin(existing, patch.binNo);
      if ("lotNo" in patch && patch.lotNo) {
        const clash = await prisma.receipt.findUnique({ where: { lotNo: patch.lotNo } });
        if (clash && clash.id !== id) {
          throw new ValidationError(`Lot ${patch.lotNo} is already assigned to receipt ${clash.id} — one truck = one Lot, always.`);
        }
      }
    } catch (e) {
      if (e instanceof ValidationError) return reply.code(422).send({ error: e.message });
      throw e;
    }

    const row = await prisma.receipt.update({ where: { id }, data: patch, include: { timeline: true } });
    return toReceiptRecord(row);
  });

  // Mirrors setStageField(id, stageId, fieldName, value). Special-cases the two fields that the
  // top-level lotNo/binNo columns need to stay in sync with, so uniqueness/lot-before-bin can
  // actually be enforced (the frontend never needed this — localStorage has no constraints).
  app.put("/api/receipts/:id/stage-field", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { stageId, fieldName, value } = req.body as { stageId: string; fieldName: string; value: string };

    const existing = await loadReceipt(id);
    if (!existing) return reply.code(404).send({ error: `Receipt ${id} not found` });

    const stageData = JSON.parse(existing.stageData) as Record<string, Record<string, string>>;
    stageData[stageId] = { ...stageData[stageId], [fieldName]: value };

    const extra: Record<string, string | null> = {};
    try {
      if (stageId === "n-lot" && fieldName === "Lot Number") {
        if (value) {
          const clash = await prisma.receipt.findUnique({ where: { lotNo: value } });
          if (clash && clash.id !== id) {
            throw new ValidationError(`Lot ${value} is already assigned to receipt ${clash.id} — one truck = one Lot, always.`);
          }
        }
        extra.lotNo = value || null;
      }
      if (stageId === "n-bin" && fieldName === "Bin Number") {
        assertLotBeforeBin(existing, value);
        extra.binNo = value || null;
      }
    } catch (e) {
      if (e instanceof ValidationError) return reply.code(422).send({ error: e.message });
      throw e;
    }

    const row = await prisma.receipt.update({
      where: { id },
      data: { stageData: JSON.stringify(stageData), ...extra },
      include: { timeline: true },
    });
    return toReceiptRecord(row);
  });

  // Mirrors setBranch(id, stageId, branchId): sets a decision branch, recomputes status
  // server-side, appends a timeline entry — exactly as TrackingContext.tsx does client-side
  // today, just now as the single source of truth instead of a client-only computation.
  app.post("/api/receipts/:id/branch", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { stageId, branchId, reason } = req.body as { stageId: string; branchId: string; reason?: string };

    const known = DECISION_BRANCHES[stageId];
    if (!known || !known.some((b) => b.id === branchId)) {
      return reply.code(400).send({ error: `Unknown branch "${branchId}" for stage "${stageId}"` });
    }

    const existing = await loadReceipt(id);
    if (!existing) return reply.code(404).send({ error: `Receipt ${id} not found` });

    try {
      if (stageId === "n-qfs") assertRejectionHasReason(branchId, reason);
    } catch (e) {
      if (e instanceof ValidationError) return reply.code(422).send({ error: e.message });
      throw e;
    }

    const branches = JSON.parse(existing.branches) as Record<string, string>;
    branches[stageId] = branchId;
    const stageData = JSON.parse(existing.stageData) as Record<string, Record<string, string>>;
    if (stageId === "n-qfs" && branchId === "fail" && reason) {
      stageData["n-reject"] = { ...stageData["n-reject"], "Reason for rejection": reason };
    }

    const status = deriveStatus({ branches, stageData });
    const now = new Date().toISOString();

    const row = await prisma.receipt.update({
      where: { id },
      data: {
        branches: JSON.stringify(branches),
        stageData: JSON.stringify(stageData),
        timeline: { create: [{ status, at: now }] },
      },
      include: { timeline: true },
    });
    return toReceiptRecord(row);
  });
}
