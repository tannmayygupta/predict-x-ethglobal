import type { FastifyPluginAsync } from "fastify";
import flashRoutes from "./flash";
import healthRoutes from "./health";
import insightRoutes from "./insight";
import marketRoutes from "./market";
import poolsRoutes from "./pools";
import tokensRoutes from "./tokens";

/** Mounted under config.apiPrefix by buildApp. */
const routes: FastifyPluginAsync = async (app) => {
  await app.register(healthRoutes);
  await app.register(tokensRoutes);
  await app.register(marketRoutes);
  await app.register(insightRoutes);
  await app.register(flashRoutes);
  await app.register(poolsRoutes);
};

export default routes;
