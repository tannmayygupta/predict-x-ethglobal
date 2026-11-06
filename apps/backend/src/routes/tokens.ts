import { TokensResponse } from "@predictx/shared";
import type { FastifyPluginAsync } from "fastify";
import { routeConfig } from "../plugins/validation";
import { tokensResponse } from "../services/tokens";

/** The allowlist only changes with a deploy, so clients and the extension's service worker may hold it a while. */
const TOKENS_MAX_AGE_SECONDS = 300;

const tokensRoutes: FastifyPluginAsync = async (app) => {
  app.get("/tokens", { config: routeConfig({ response: TokensResponse }) }, async (_request, reply) => {
    reply.header("cache-control", `public, max-age=${TOKENS_MAX_AGE_SECONDS}`);
    return tokensResponse;
  });
};

export default tokensRoutes;
