import { ApiError, ErrorCode } from "@predictx/shared";
import type { FastifyError, FastifyReply } from "fastify";
import type { App } from "./appTypes";
import type { ZodError, z } from "zod";

/** The shared package exports ErrorCode as a zod enum only; this is its value type. */
export type ErrorCodeName = z.infer<typeof ErrorCode>;

/** HTTP status per code, API_CONTRACT.md section 1. */
export const STATUS_BY_CODE: Record<ErrorCodeName, number> = {
  BAD_REQUEST: 400,
  UNSUPPORTED_TOKEN: 400,
  NOT_FOUND: 404,
  QUOTE_EXPIRED: 409,
  RATE_LIMITED: 429,
  FLASH_ERROR: 502,
  LLM_UNAVAILABLE: 503,
  INTERNAL: 500,
};

const GENERIC_INTERNAL_MESSAGE = "Internal error";
const HTTP_BAD_GATEWAY = 502;

export interface AppErrorOptions {
  /** Overrides the table status; the contract has no upstream code besides FLASH_ERROR, so 502 reuses INTERNAL. */
  status?: number;
}

export class AppError extends Error {
  readonly code: ErrorCodeName;
  readonly status: number;

  constructor(code: ErrorCodeName, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? STATUS_BY_CODE[code];
  }
}

export const badRequest = (message: string): AppError => new AppError("BAD_REQUEST", message);
export const notFound = (message: string): AppError => new AppError("NOT_FOUND", message);
export const unsupportedToken = (message: string): AppError => new AppError("UNSUPPORTED_TOKEN", message);
export const quoteExpired = (message: string): AppError => new AppError("QUOTE_EXPIRED", message);
export const rateLimited = (message: string): AppError => new AppError("RATE_LIMITED", message);
export const flashError = (message: string): AppError => new AppError("FLASH_ERROR", message);
export const llmUnavailable = (message: string): AppError => new AppError("LLM_UNAVAILABLE", message);
export const internal = (message: string): AppError => new AppError("INTERNAL", message);
/** CoinGecko or chain RPC failure with no cache to fall back on (B02-13, B07-19). */
export const upstreamError = (message: string): AppError =>
  new AppError("INTERNAL", message, { status: HTTP_BAD_GATEWAY });

function sendApiError(reply: FastifyReply, status: number, code: ErrorCodeName, message: string): FastifyReply {
  // Parsing our own output guarantees the shared shape even if a future edit drifts (FR-B-07).
  const body = ApiError.parse({ error: { code, message } });
  return reply.status(status).send(body);
}

function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/** "symbol: Required" style text: the first issue is enough for a client to fix its request. */
export function describeZodError(error: ZodError, root = ""): string {
  const first = error.issues[0];
  if (!first) return "invalid input";
  const path = [root, ...first.path.map(String)].filter((p) => p.length > 0).join(".");
  return path.length > 0 ? `${path}: ${first.message}` : first.message;
}

const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_SERVER_ERROR_MIN = 500;

/** Fastify raises its own 4xx errors (bad JSON, empty JSON body, payload too large); they are the client's fault. */
function clientErrorStatus(err: FastifyError | Error): number | undefined {
  const status = "statusCode" in err ? err.statusCode : undefined;
  if (typeof status === "number" && status >= HTTP_CLIENT_ERROR_MIN && status < HTTP_SERVER_ERROR_MIN) return status;
  return undefined;
}

/**
 * pino's default err serializer walks err.cause, and an RPC client's cause can carry the provider URL
 * with its key, so the unhandled-error line keeps only name and message (B01-29b).
 */
export function registerErrorHandler(app: App): void {
  app.setErrorHandler((err: FastifyError | AppError | Error, request, reply) => {
    if (isAppError(err)) {
      sendApiError(reply, err.status, err.code, err.message);
      return;
    }
    // Request validation already throws badRequest; a ZodError that reaches here is a stored row or our own
    // output failing to parse, so it carries no client status and falls through to INTERNAL (B01-12b).
    const clientStatus = clientErrorStatus(err);
    if (clientStatus !== undefined) {
      sendApiError(reply, STATUS_BY_CODE.BAD_REQUEST, "BAD_REQUEST", err.message);
      return;
    }
    request.log.error({ err: { name: err.name, message: err.message } }, "unhandled error");
    sendApiError(reply, STATUS_BY_CODE.INTERNAL, "INTERNAL", GENERIC_INTERNAL_MESSAGE);
  });

  app.setNotFoundHandler((request, reply) => {
    sendApiError(reply, STATUS_BY_CODE.NOT_FOUND, "NOT_FOUND", `No route ${request.method} ${request.url}`);
  });
}
