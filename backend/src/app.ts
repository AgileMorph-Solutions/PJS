import Fastify from "fastify";
import { receiptRoutes } from "./routes/receipts.js";
import { ledgerRoutes } from "./routes/ledgers.js";
import { masterRoutes } from "./routes/masters.js";
import { dryingRoutes } from "./routes/drying.js";
import { dashboardRoutes } from "./routes/dashboard.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get("/api/health", async () => ({ ok: true }));

  app.register(receiptRoutes);
  app.register(ledgerRoutes);
  app.register(masterRoutes);
  app.register(dryingRoutes);
  app.register(dashboardRoutes);

  return app;
}
