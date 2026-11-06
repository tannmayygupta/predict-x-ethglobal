import type { FastifyInstance } from "fastify";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Logger } from "pino";

/**
 * The instance type once a pino instance is injected via loggerInstance.
 * The bare FastifyInstance does not type-check against it (FastifyBaseLogger lacks msgPrefix).
 */
export type App = FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>;
