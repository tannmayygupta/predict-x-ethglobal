import { Market, Token } from "@predictx/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { routeConfig } from "../plugins/validation";
import { sharedMarketService } from "../services/market";

/** Not in the shared schemas: the contract only fixes the path /market/:symbol; the symbol rule is Token's. */
export const MarketParams = z.object({ symbol: Token.shape.symbol });

const marketRoutes: FastifyPluginAsync = async (app) => {
  const market = sharedMarketService(app.deps, app.log);
  app.get("/market/:symbol", { config: routeConfig({ params: MarketParams, response: Market }) }, async (request) => {
    const { symbol } = MarketParams.parse(request.parsed.params);
    return market.get(symbol);
  });
};

export default marketRoutes;
