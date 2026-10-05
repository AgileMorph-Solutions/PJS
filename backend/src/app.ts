import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { registerAuth } from "./auth/plugin.js";
import { authRoutes } from "./routes/auth.js";
import { userRoutes } from "./routes/users.js";
import { submissionRoutes } from "./routes/submissions.js";
import { supplierAccessRoutes } from "./routes/supplierAccess.js";
import { receiptRoutes } from "./routes/receipts.js";
import { ledgerRoutes } from "./routes/ledgers.js";
import { masterRoutes } from "./routes/masters.js";
import { dryingRoutes } from "./routes/drying.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { dataQualityRoutes } from "./routes/dataQuality.js";
import { importRoutes } from "./routes/imports.js";
import { workbookRoutes } from "./routes/workbook.js";
import { productionRoutes } from "./routes/production.js";
import { warehouseDispatchRoutes } from "./routes/warehouseDispatches.js";
import { dryingBatchRoutes } from "./routes/dryingBatches.js";
import { dryingSortingReportRoutes } from "./routes/dryingSortingReports.js";
import { warehouseActivityLedgerRoutes } from "./routes/warehouseActivityLedger.js";
import { issuedToProductionRoutes } from "./routes/issuedToProduction.js";
import { warehouseDischargeRoutes } from "./routes/warehouseDischarges.js";
import { deliveryPlanRoutes } from "./routes/deliveryPlans.js";
import { transferRoutes } from "./routes/transfers.js";
import { ValidationError, UnauthorizedError, ForbiddenError } from "./domain/validation.js";
import { UnknownStageFieldError } from "./stageStore.js";
import { ImportRejectedError, ImportTokenError } from "./services/imports.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  // In compose the browser reaches /api same-origin through nginx, so CORS is never exercised.
  // It matters for `vite dev` against a bare `npm run dev` backend, and for direct API calls.
  const origins = (process.env.CORS_ORIGIN ?? "http://localhost:5173,http://localhost:8080")
    .split(",").map((o) => o.trim()).filter(Boolean);
  // credentials: the session is an httpOnly cookie, which cross-origin fetches only send when allowed.
  // exposedHeaders: a cross-origin fetch (vite dev) can only read these if they're listed — the
  // export download reads its filename and the "rows left out for having no date" count from them.
  app.register(cors, {
    origin: origins, credentials: true, methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    exposedHeaders: ["Content-Disposition", "X-Rows-Without-Date", "X-Rows-Exported"],
  });

  // 20MB cap — the largest real workbook is ~395KB; this is headroom against a wrong/huge file,
  // not a tight fit. Row/column guards on top of this live in services/imports.ts.
  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  // Without this a Prisma unique-constraint violation surfaces as an opaque 500.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof UnauthorizedError) return reply.code(401).send({ error: err.message });
    if (err instanceof ForbiddenError) return reply.code(403).send({ error: err.message });
    if (err instanceof ValidationError) return reply.code(422).send({ error: err.message });
    if (err instanceof UnknownStageFieldError) return reply.code(400).send({ error: err.message });
    if (err instanceof ImportRejectedError) return reply.code(422).send({ error: err.message, detail: err.detail });
    if (err instanceof ImportTokenError) return reply.code(404).send({ error: err.message });
    const code = (err as { code?: string }).code;
    if (code === "P2002") return reply.code(409).send({ error: "That value is already taken.", meta: (err as any).meta });
    if (code === "P2003") return reply.code(422).send({ error: "Referenced record does not exist.", meta: (err as any).meta });
    if (code === "P2025") return reply.code(404).send({ error: "Record not found." });
    reply.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  });

  app.get("/api/health", async () => ({ ok: true }));

  // Must come before the route registrations below: its hook only covers routes added after it.
  registerAuth(app);
  app.register(authRoutes);
  app.register(userRoutes);
  app.register(submissionRoutes);
  app.register(supplierAccessRoutes);

  app.register(receiptRoutes);
  app.register(deliveryPlanRoutes);
  app.register(transferRoutes);
  app.register(ledgerRoutes);
  app.register(masterRoutes);
  app.register(dryingRoutes);
  app.register(dashboardRoutes);
  app.register(dataQualityRoutes);
  app.register(importRoutes);
  app.register(workbookRoutes);
  app.register(productionRoutes);
  app.register(warehouseDispatchRoutes);
  app.register(warehouseActivityLedgerRoutes);
  app.register(dryingBatchRoutes);
  app.register(dryingSortingReportRoutes);
  app.register(issuedToProductionRoutes);
  app.register(warehouseDischargeRoutes);

  return app;
}
