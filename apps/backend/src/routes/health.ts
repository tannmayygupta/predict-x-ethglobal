import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { routeConfig } from "../plugins/validation";

/** Not in the shared schemas: the contract fixes it as the literal { ok: true }. */
export const HealthResponse = z.object({ ok: z.literal(true) });

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", { config: routeConfig({ response: HealthResponse }) }, async () => ({ ok: true }));
};

export default healthRoutes;
