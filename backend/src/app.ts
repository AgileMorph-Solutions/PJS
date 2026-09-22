import Fastify from "fastify";
import cors from "@fastify/cors";
import { receiptRoutes } from "./routes/receipts.js";
import { ledgerRoutes } from "./routes/ledgers.js";
import { masterRoutes } from "./routes/masters.js";
import { dryingRoutes } from "./routes/drying.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { dataQualityRoutes } from "./routes/dataQuality.js";
import { ValidationError } from "./domain/validation.js";
import { UnknownStageFieldError } from "./stageStore.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  // In compose the browser reaches /api same-origin through nginx, so CORS is never exercised.
  // It matters for `vite dev` against a bare `npm run dev` backend, and for direct API calls.
  const origins = (process.env.CORS_ORIGIN ?? "http://localhost:5173,http://localhost:8080")
    .split(",").map((o) => o.trim()).filter(Boolean);
  app.register(cors, { origin: origins, methods: ["GET", "POST", "PATCH", "PUT", "DELETE"] });

  // Without this a Prisma unique-constraint violation surfaces as an opaque 500.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError) return reply.code(422).send({ error: err.message });
    if (err instanceof UnknownStageFieldError) return reply.code(400).send({ error: err.message });
    const code = (err as { code?: string }).code;
    if (code === "P2002") return reply.code(409).send({ error: "That value is already taken.", meta: (err as any).meta });
    if (code === "P2003") return reply.code(422).send({ error: "Referenced record does not exist.", meta: (err as any).meta });
    if (code === "P2025") return reply.code(404).send({ error: "Record not found." });
    reply.log.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.register(receiptRoutes);
  app.register(ledgerRoutes);
  app.register(masterRoutes);
  app.register(dryingRoutes);
  app.register(dashboardRoutes);
  app.register(dataQualityRoutes);

  return app;
}
