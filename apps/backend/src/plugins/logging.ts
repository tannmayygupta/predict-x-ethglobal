import { LogController } from "fastify";
import pino, { type DestinationStream, type Logger } from "pino";
import type { App } from "../appTypes";
import { PRESENCE_MARKERS } from "../config.summary";

export interface LoggerOptions {
  level: string;
  /** Tests pass a capture object; production falls back to stdout. */
  stream?: DestinationStream;
}

const SECRET_HEADERS = ["authorization", "x-definitive-api-key", "x-cg-demo-api-key", "x-cg-pro-api-key"];
const SECRET_FIELDS = [
  "apiKey",
  "flashApiKey",
  "openaiApiKey",
  "coingeckoApiKey",
  "FLASH_API_KEY",
  "OPENAI_API_KEY",
  "COINGECKO_API_KEY",
  "orderSignature",
  "permitSignature",
  "userSignature",
  "evmPermitSignature",
  "orderTypedData",
  "permitTypedData",
  "evmOrderTypedData",
  "evmPermitTypedData",
];
const CENSOR = "[redacted]";

/** The boot config line replaces secrets with presence markers before logging; only those survive redaction (B10-03). */
function censor(value: unknown): unknown {
  return typeof value === "string" && PRESENCE_MARKERS.has(value) ? value : CENSOR;
}

/** RULES 2.7: keys, signatures and typed data never reach a log line, wherever a caller nests them (one level deep). */
export function redactPaths(): string[] {
  const headerPaths = SECRET_HEADERS.flatMap((h) => [`headers["${h}"]`, `req.headers["${h}"]`, `*.headers["${h}"]`]);
  const fieldPaths = SECRET_FIELDS.flatMap((f) => [f, `*.${f}`]);
  return [...headerPaths, ...fieldPaths];
}

interface LoggedError {
  name: string;
  message: string;
}

/**
 * Replaces pino's default err serializer, which walks err.cause: an RPC or HTTP client's cause can carry
 * the provider URL with its key in it. Name and message are enough to find the failing call.
 */
export function serializeErr(value: unknown): LoggedError {
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === "object" && value !== null && "name" in value && "message" in value) {
    return { name: String(value.name), message: String(value.message) };
  }
  return { name: "NonError", message: String(value) };
}

export function createLogger(options: LoggerOptions): Logger {
  return pino(
    { level: options.level, base: null, redact: { paths: redactPaths(), censor }, serializers: { err: serializeErr } },
    options.stream ?? pino.destination(1),
  );
}

/** Fastify's own "incoming request" / "request completed" pair is replaced by the single line below. */
export function createLogController(): LogController {
  return new LogController({ disableRequestLogging: true });
}

const MS_PRECISION = 1;

/** One line per request: reqId comes from the request-scoped child logger. */
export function registerRequestLogging(app: App): void {
  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        status: reply.statusCode,
        responseTimeMs: Number(reply.elapsedTime.toFixed(MS_PRECISION)),
      },
      "request completed",
    );
  });
}
