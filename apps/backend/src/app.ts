import Fastify from "fastify";
import type { DestinationStream } from "pino";
import type { App } from "./appTypes";
import type { FlashClient } from "./clients/flash.types";
import type { InsightModel } from "./clients/insightModel";
import type { PoolReader } from "./clients/poolReader";
import type { PriceSource } from "./clients/priceSource";
import type { Config } from "./config";
import type { Db } from "./db/sqlite";
import { registerErrorHandler } from "./errors";
import { registerCors } from "./plugins/cors";
import { createLogController, createLogger, registerRequestLogging } from "./plugins/logging";
import { registerRateLimit } from "./plugins/rateLimit";
import { registerValidation } from "./plugins/validation";
import routes from "./routes/index";
import type { Clock } from "./util/clock";

export type { Db } from "./db/sqlite";

/**
 * Fastify 5.12 fails closed on a bare number (it trusts no hop), so the count becomes a predicate:
 * the socket peer and the next hops-1 addresses are proxies, and request.ip is the address the
 * outermost trusted proxy appended. Anything further left is client-written and ignored.
 */
export function trustProxyOption(hops: false | number): false | ((address: string, hop: number) => boolean) {
  if (hops === false) return false;
  return (_address, hop) => hop < hops;
}

export interface AppDeps {
  config: Config;
  db: Db;
  clock: Clock;
  priceSource: PriceSource;
  flash: FlashClient;
  insightModel: InsightModel;
  poolReader: PoolReader;
  /** Tests capture logs here; production logs to stdout. */
  logStream?: DestinationStream;
}

export type { App } from "./appTypes";

declare module "fastify" {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

/** Builds the app without listening. Tests inject requests; server.ts listens. */
export async function buildApp(deps: AppDeps): Promise<App> {
  const { config } = deps;
  const app = Fastify({
    loggerInstance: createLogger({ level: config.logLevel, ...(deps.logStream ? { stream: deps.logStream } : {}) }),
    logController: createLogController(),
    trustProxy: trustProxyOption(config.trustProxy),
  });
  registerRequestLogging(app);
  // Handlers go first so routes registered by plugins (e.g. the CORS OPTIONS route) inherit them.
  registerErrorHandler(app);
  await registerCors(app, { allowedOrigins: config.allowedOrigins });
  registerRateLimit(app, { clock: deps.clock });
  registerValidation(app, { validateResponses: config.validateResponses });
  app.decorate("deps", deps);
  await app.register(routes, { prefix: config.apiPrefix });
  return app;
}
