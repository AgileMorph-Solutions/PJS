/**
 * Production routes — the production twin of routes/receipts.ts + routes/drying.ts. Thin: parse
 * the request, call a service, return JSON. All the real work is in services/production/*.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { PRODUCTION_FIELD_MAP } from "@anagroci/contract/generated/productionFieldMap";
import { sendError } from "./receipts.js";
import {
  listBtmIntakes, getBtmIntake, addBtmReceiptLine, addBtmInputQualityRow, addCalibrationRunRow,
  addBtmRow, listBtmChildRows,
} from "../services/production/btm.js";
import {
  listLots, getLot, createCookingRun, addShellingRunRow, addBormaRunRow, addPackingRecordRow,
  addLotTableRow, listLotChildRows,
} from "../services/production/lots.js";
import { listBins, getBin, listBinTable, addBinRow, getBinPhaseProgress } from "../services/production/bins.js";
import { listStandaloneTable, addStandaloneRow } from "../services/production/standalone.js";
import { warningsForBtm, warningsForLot } from "../domain/dataQuality/index.js";
import { ValidationError } from "../domain/validation.js";

async function requireBtm(btmNo: string, reply: FastifyReply) {
  const row = await getBtmIntake(btmNo);
  if (!row) { reply.code(404).send({ error: `BTM ${btmNo} not found` }); return null; }
  return row;
}

async function requireLot(lotNo: string, reply: FastifyReply) {
  const row = await getLot(lotNo);
  if (!row) { reply.code(404).send({ error: `Lot ${lotNo} not found` }); return null; }
  return row;
}

export async function productionRoutes(app: FastifyInstance) {
  // ── BTM ──────────────────────────────────────────────────────────────────
  app.get("/api/production/btm", async () => listBtmIntakes());

  app.get("/api/production/btm/:btmNo", async (req, reply) => {
    const { btmNo } = req.params as { btmNo: string };
    return requireBtm(btmNo, reply);
  });

  app.post("/api/production/btm/:btmNo/receipt-lines", async (req, reply) => {
    const { btmNo } = req.params as { btmNo: string };
    const { binNo, fields } = (req.body ?? {}) as { binNo?: string; fields?: Record<string, string> };
    try {
      const data = await addBtmReceiptLine(btmNo, binNo ?? "", fields ?? {});
      return { data, warnings: warningsForBtm({ btmNo, binNo: binNo ?? "" }) };
    } catch (e) { return sendError(reply, e); }
  });

  app.post("/api/production/btm/:btmNo/quality", async (req, reply) => {
    const { btmNo } = req.params as { btmNo: string };
    const { binNo, fields } = (req.body ?? {}) as { binNo?: string; fields?: Record<string, string> };
    try {
      const data = await addBtmInputQualityRow(btmNo, binNo ?? "", fields ?? {});
      return { data, warnings: warningsForBtm({ btmNo, binNo: binNo ?? "" }) };
    } catch (e) { return sendError(reply, e); }
  });

  app.post("/api/production/btm/:btmNo/calibration", async (req, reply) => {
    const { btmNo } = req.params as { btmNo: string };
    const { binNo, fields } = (req.body ?? {}) as { binNo?: string; fields?: Record<string, string> };
    try {
      const data = await addCalibrationRunRow(btmNo, binNo ?? "", fields ?? {});
      return { data, warnings: warningsForBtm({ btmNo, binNo: binNo ?? "" }) };
    } catch (e) { return sendError(reply, e); }
  });

  // ── Bin (the pivot — read-only in this pass, see services/production/bins.ts) ─────────────────
  app.get("/api/production/bins", async () => listBins());

  app.get("/api/production/bins/:binNo", async (req, reply) => {
    const { binNo } = req.params as { binNo: string };
    const row = await getBin(binNo);
    if (!row) return reply.code(404).send({ error: `Bin ${binNo} not found` });
    return row;
  });

  app.get("/api/production/bins/:binNo/phase-progress", async (req, reply) => {
    const { binNo } = req.params as { binNo: string };
    const bin = await getBin(binNo);
    if (!bin) return reply.code(404).send({ error: `Bin ${binNo} not found` });
    return getBinPhaseProgress(binNo);
  });

  // ── Lot ──────────────────────────────────────────────────────────────────
  app.get("/api/production/lots", async () => listLots());

  app.get("/api/production/lots/:lotNo", async (req, reply) => {
    const { lotNo } = req.params as { lotNo: string };
    return requireLot(lotNo, reply);
  });

  app.post("/api/production/lots/:lotNo/cooking", async (req, reply) => {
    const { lotNo } = req.params as { lotNo: string };
    const { binNo, fields } = (req.body ?? {}) as { binNo?: string; fields?: Record<string, string> };
    try {
      const data = await createCookingRun(lotNo, binNo ?? "", fields ?? {});
      return { data, warnings: warningsForLot({ lotNo, binNo: binNo ?? "" }) };
    } catch (e) { return sendError(reply, e); }
  });

  app.post("/api/production/lots/:lotNo/shelling", async (req, reply) => {
    const { lotNo } = req.params as { lotNo: string };
    const { fields } = (req.body ?? {}) as { fields?: Record<string, string> };
    try {
      const data = await addShellingRunRow(lotNo, fields ?? {});
      return { data, warnings: [] };
    } catch (e) { return sendError(reply, e); }
  });

  app.post("/api/production/lots/:lotNo/borma", async (req, reply) => {
    const { lotNo } = req.params as { lotNo: string };
    const { fields } = (req.body ?? {}) as { fields?: Record<string, string> };
    try {
      const data = await addBormaRunRow(lotNo, fields ?? {});
      return { data, warnings: [] };
    } catch (e) { return sendError(reply, e); }
  });

  app.post("/api/production/lots/:lotNo/packing", async (req, reply) => {
    const { lotNo } = req.params as { lotNo: string };
    const { fields } = (req.body ?? {}) as { fields?: Record<string, string> };
    try {
      const data = await addPackingRecordRow(lotNo, fields ?? {});
      return { data, warnings: [] };
    } catch (e) { return sendError(reply, e); }
  });

  // ── Generic per-table access — covers every table beyond the named endpoints above, so a new
  // table (or any of the 18 not yet given its own named route) is reachable without a new route
  // file. tableId is validated against its spine before dispatching, same rejection pattern
  // addLotRow already uses for "not a Lot-spine table". ────────────────────────────────────────
  function parseLimit(req: any): number | undefined {
    const raw = (req.query as { limit?: string })?.limit;
    const n = raw ? Number(raw) : undefined;
    return Number.isFinite(n) ? n : undefined;
  }

  app.get("/api/production/btm/:btmNo/tables/:tableId", async (req, reply) => {
    const { btmNo, tableId } = req.params as { btmNo: string; tableId: string };
    if (PRODUCTION_FIELD_MAP[tableId]?.spine !== "btm") return reply.code(400).send({ error: `"${tableId}" is not a BTM-spine table.` });
    return listBtmChildRows(tableId, btmNo);
  });

  app.post("/api/production/btm/:btmNo/tables/:tableId", async (req, reply) => {
    const { btmNo, tableId } = req.params as { btmNo: string; tableId: string };
    const { binNo, fields } = (req.body ?? {}) as { binNo?: string; fields?: Record<string, string> };
    try {
      if (PRODUCTION_FIELD_MAP[tableId]?.spine !== "btm") throw new ValidationError(`"${tableId}" is not a BTM-spine table.`);
      const data = await addBtmRow(tableId, btmNo, binNo ?? "", fields ?? {}, {});
      return { data, warnings: warningsForBtm({ btmNo, binNo: binNo ?? "" }) };
    } catch (e) { return sendError(reply, e); }
  });

  app.get("/api/production/lots/:lotNo/tables/:tableId", async (req, reply) => {
    const { lotNo, tableId } = req.params as { lotNo: string; tableId: string };
    if (PRODUCTION_FIELD_MAP[tableId]?.spine !== "lot") return reply.code(400).send({ error: `"${tableId}" is not a Lot-spine table.` });
    return listLotChildRows(tableId, lotNo);
  });

  app.post("/api/production/lots/:lotNo/tables/:tableId", async (req, reply) => {
    const { lotNo, tableId } = req.params as { lotNo: string; tableId: string };
    const { fields } = (req.body ?? {}) as { fields?: Record<string, string> };
    try {
      const data = await addLotTableRow(tableId, lotNo, fields ?? {});
      return { data, warnings: [] };
    } catch (e) { return sendError(reply, e); }
  });

  app.get("/api/production/bins/:binNo/tables/:tableId", async (req, reply) => {
    const { binNo, tableId } = req.params as { binNo: string; tableId: string };
    try {
      return await listBinTable(tableId, binNo, parseLimit(req));
    } catch (e) { return sendError(reply, e); }
  });

  app.post("/api/production/bins/:binNo/tables/:tableId", async (req, reply) => {
    const { binNo, tableId } = req.params as { binNo: string; tableId: string };
    const { fields } = (req.body ?? {}) as { fields?: Record<string, string> };
    try {
      const data = await addBinRow(tableId, binNo, fields ?? {});
      return { data, warnings: [] };
    } catch (e) { return sendError(reply, e); }
  });

  // ── Standalone tables (no Lot/BTM/Bin column — shell-dispatch, waste-dispatch,
  // boiler-consumption, wip-stock-report) ─────────────────────────────────────────────────────
  app.get("/api/production/standalone/:tableId", async (req, reply) => {
    const { tableId } = req.params as { tableId: string };
    try {
      return await listStandaloneTable(tableId, parseLimit(req));
    } catch (e) { return sendError(reply, e); }
  });

  app.post("/api/production/standalone/:tableId", async (req, reply) => {
    const { tableId } = req.params as { tableId: string };
    const { fields } = (req.body ?? {}) as { fields?: Record<string, string> };
    try {
      const data = await addStandaloneRow(tableId, fields ?? {});
      return { data, warnings: [] };
    } catch (e) { return sendError(reply, e); }
  });
}
