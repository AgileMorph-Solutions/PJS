import type { FastifyInstance } from "fastify";
import type { OpeningBalanceInput } from "@anagroci/contract/domain/juteOpeningBalance";
import { currentUser } from "../auth/plugin.js";
import { scopedSite, scopedWarehouse } from "../auth/scope.js";
import { listOpeningBalances, setOpeningBalance } from "../services/juteOpeningBalances.js";

// Warehouse Incharge / admin only: auth/policy.ts is default-deny for the narrow roles, and neither route is listed there.
export async function juteOpeningBalanceRoutes(app: FastifyInstance) {
  app.get("/api/jute-opening-balances", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listOpeningBalances(await scopedSite(req, warehouse));
  });

  app.put("/api/jute-opening-balances", async (req, reply) => {
    const body = (req.body ?? {}) as OpeningBalanceInput & { warehouse?: string };
    const warehouse = scopedWarehouse(req, body.warehouse);
    if (!warehouse) return reply.code(400).send({ error: "warehouse is required" });
    return setOpeningBalance(body, warehouse, currentUser(req));
  });
}
