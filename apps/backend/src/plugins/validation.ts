import type { FastifyRequest } from "fastify";
import type { App } from "../appTypes";
import type { SafeParseReturnType } from "zod";
import { badRequest, describeZodError, internal } from "../errors";
import type { RateLimitBucket } from "./rateLimit";

/** Validated copies of the raw request parts; handlers read these, never request.body directly. */
export interface ParsedRequest {
  body: unknown;
  params: unknown;
  query: unknown;
}

/**
 * Structural stand-in for "any zod schema". Fastify intersects route config with the declared
 * type, and zod classes carry `this`-typed methods that make such intersections unassignable.
 */
export interface RequestSchema {
  safeParse(data: unknown): SafeParseReturnType<unknown, unknown>;
}

export interface RouteSchemas {
  body?: RequestSchema;
  params?: RequestSchema;
  query?: RequestSchema;
  response?: RequestSchema;
}

export interface RouteConfig extends RouteSchemas {
  rateLimit?: RateLimitBucket;
}

/**
 * Builds the `config` for a route. Pass schemas through here rather than inline: Fastify infers
 * the config type from the literal and intersects it with RouteConfig, which fails for zod classes.
 */
export function routeConfig(input: RouteConfig): RouteConfig {
  return input;
}

declare module "fastify" {
  interface FastifyContextConfig extends RouteConfig {}
  interface FastifyRequest {
    parsed: ParsedRequest;
  }
}

function parsePart(schema: RequestSchema | undefined, raw: unknown, name: string): unknown {
  if (!schema) return raw;
  const result = schema.safeParse(raw);
  if (!result.success) throw badRequest(describeZodError(result.error, name));
  return result.data;
}

function parseRequest(request: FastifyRequest): ParsedRequest {
  const config = request.routeOptions.config;
  return {
    body: parsePart(config.body, request.body, "body"),
    params: parsePart(config.params, request.params, "params"),
    query: parsePart(config.query, request.query, "query"),
  };
}

const HTTP_ERROR_MIN = 400;

export interface ValidationOptions {
  /** Response checking guards FR-B-01 at runtime; prod may switch it off (D-B8). */
  validateResponses: boolean;
}

const UNPARSED: ParsedRequest = Object.freeze({ body: undefined, params: undefined, query: undefined });

export function registerValidation(app: App, options: ValidationOptions): void {
  // Fastify forbids object defaults on decorateRequest; a getter/setter pair keeps the request shape stable.
  const parsedByRequest = new WeakMap<FastifyRequest, ParsedRequest>();
  app.decorateRequest("parsed", {
    getter() {
      return parsedByRequest.get(this) ?? UNPARSED;
    },
    setter(value: ParsedRequest) {
      parsedByRequest.set(this, value);
    },
  });
  app.addHook("preHandler", async (request) => {
    request.parsed = parseRequest(request);
  });
  if (!options.validateResponses) return;
  app.addHook("preSerialization", async (request, reply, payload: unknown) => {
    const schema = request.routeOptions.config.response;
    // Error bodies are produced by the error handler and already parsed with ApiError there.
    if (!schema || reply.statusCode >= HTTP_ERROR_MIN) return payload;
    const result = schema.safeParse(payload);
    if (!result.success) {
      request.log.error({ issues: result.error.issues }, "response validation failed");
      throw internal("response validation failed");
    }
    return payload;
  });
}
