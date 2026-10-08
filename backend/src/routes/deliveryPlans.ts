import type { FastifyInstance } from "fastify";
import {
  listDeliveryPlans, getDeliveryPlan, createDeliveryPlan, updateDeliveryPlan, type DeliveryPlanInput,
} from "../services/deliveryPlans.js";
import { scopedSite, scopedWarehouse, assertWarehouseAccess } from "../auth/scope.js";
import { currentUser } from "../auth/plugin.js";

export async function deliveryPlanRoutes(app: FastifyInstance) {
  app.get("/api/delivery-plans", async (req) => {
    const { warehouse } = req.query as { warehouse?: string };
    return listDeliveryPlans(await scopedSite(req, warehouse));
  });

  app.get("/api/delivery-plans/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const plan = await getDeliveryPlan(id);
    if (!plan) return reply.code(404).send({ error: "Delivery plan not found" });
    await assertWarehouseAccess(req, plan.destinationWarehouse);
    return plan;
  });

  // A Warehouse Incharge plans deliveries into their own warehouse; an admin names one.
  app.post("/api/delivery-plans", async (req, reply) => {
    const body = (req.body ?? {}) as DeliveryPlanInput;
    const destinationWarehouse = scopedWarehouse(req, body.destinationWarehouse) ?? body.destinationWarehouse;
    return reply.code(201).send(await createDeliveryPlan({ ...body, destinationWarehouse }));
  });

  app.patch("/api/delivery-plans/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const plan = await getDeliveryPlan(id);
    if (!plan) return reply.code(404).send({ error: "Delivery plan not found" });
    await assertWarehouseAccess(req, plan.destinationWarehouse);
    return updateDeliveryPlan(id, (req.body ?? {}) as DeliveryPlanInput, currentUser(req).id);
  });
}
