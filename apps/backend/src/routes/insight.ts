import { InsightRequest, InsightResponse } from "@predictx/shared";
import type { FastifyPluginAsync } from "fastify";
import { InsightsRepo } from "../db/insights";
import { routeConfig } from "../plugins/validation";
import { InsightService } from "../services/insight";
import { sharedMarketService } from "../services/market";

/** POST /insight (API_CONTRACT section 2 row 4). The stricter rate bucket is the contract's 10 per minute. */
const insightRoutes: FastifyPluginAsync = async (app) => {
  const { db, clock, insightModel } = app.deps;
  const service = new InsightService(
    { market: sharedMarketService(app.deps, app.log), model: insightModel, insights: new InsightsRepo(db), clock },
    app.log,
  );
  app.post(
    "/insight",
    { config: routeConfig({ body: InsightRequest, response: InsightResponse, rateLimit: "insight" }) },
    async (request) => service.get(InsightRequest.parse(request.parsed.body)),
  );
};

export default insightRoutes;
