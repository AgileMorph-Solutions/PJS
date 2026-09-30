import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/plugin.js";
import { listUsers, createUser, updateUser, type NewUser, type UserPatch } from "../services/users.js";

/** Admin-only. Role/warehouse validation is in services/users.ts; ValidationError becomes a 422
 * through app.ts's global handler. */
export async function userRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: requireRole("admin") };

  app.get("/api/users", adminOnly, async () => listUsers());

  app.post("/api/users", adminOnly, async (req, reply) =>
    reply.code(201).send(await createUser((req.body ?? {}) as NewUser)));

  app.patch("/api/users/:id", adminOnly, async (req) => {
    const { id } = req.params as { id: string };
    return updateUser(id, (req.body ?? {}) as UserPatch);
  });
}
