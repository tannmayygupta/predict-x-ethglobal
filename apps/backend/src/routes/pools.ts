import { Address, Pool, PoolsResponse, Position } from "@predictx/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { routeConfig } from "../plugins/validation";
import { PoolsService } from "../services/pools";

/**
 * Not in the shared schemas: the contract fixes the path only. Digits-only (no sign, no point,
 * no hex) because the id is a uint256 index; it stays a string so the handler converts with
 * BigInt without any precision loss.
 */
export const PoolIdParams = z.object({ id: z.string().regex(/^\d+$/, "must be a non-negative integer") });
export const PositionQuery = z.object({ address: Address });

const poolsRoutes: FastifyPluginAsync = async (app) => {
  const { config, clock, poolReader } = app.deps;
  const service = new PoolsService(
    poolReader,
    clock,
    { chainId: config.poolChainId, contract: config.poolAddress, dashboardUrl: config.dashboardUrl },
    app.log,
  );

  app.get("/pools", { config: routeConfig({ response: PoolsResponse }) }, async () => ({ pools: await service.list() }));

  app.get("/pools/:id", { config: routeConfig({ params: PoolIdParams, response: Pool }) }, async (request) => {
    const { id } = PoolIdParams.parse(request.parsed.params);
    return service.get(BigInt(id));
  });

  app.get(
    "/pools/:id/position",
    { config: routeConfig({ params: PoolIdParams, query: PositionQuery, response: Position }) },
    async (request) => {
      const { id } = PoolIdParams.parse(request.parsed.params);
      const { address } = PositionQuery.parse(request.parsed.query);
      return service.getPosition(BigInt(id), address);
    },
  );
};

export default poolsRoutes;
