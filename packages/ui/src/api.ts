/**
 * Typed client for the backend (API_CONTRACT section 2). Every response is parsed with the shared zod
 * schema, so contract drift fails loudly here instead of rendering garbage. The transport is injected:
 * pages use fetch directly, the extension routes the call through its service worker.
 */
import {
  ApiError,
  FlashQuoteResponse,
  InsightResponse,
  Market,
  MarketChart,
  type ChartRange,
  Pool,
  PoolsResponse,
  Position,
  TokensResponse,
  FlashQuoteRequest,
  type InsightRequest,
} from "@predictx/shared";
import type { z } from "zod";

export type ApiClientCode = z.infer<typeof ApiError>["error"]["code"] | "NETWORK" | "CONTRACT_MISMATCH";

export class ApiClientError extends Error {
  constructor(
    readonly code: ApiClientCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface HttpRequest {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

/** Resolves with whatever the server answered; rejects only when no answer arrived at all. */
export type Transport = (request: HttpRequest) => Promise<HttpResponse>;

export const fetchTransport: Transport = async ({ method, url, body }) => {
  const res = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
};

/** What a caller sends: `slippage` has a server-side default, so it is optional here. */
export type FlashQuoteInput = z.input<typeof FlashQuoteRequest>;

export interface ApiClient {
  tokens(): Promise<z.infer<typeof TokensResponse>["tokens"]>;
  market(symbol: string): Promise<Market>;
  chart(symbol: string, range: ChartRange): Promise<MarketChart>;
  insight(request: InsightRequest): Promise<InsightResponse>;
  flashQuote(request: FlashQuoteInput): Promise<FlashQuoteResponse>;
  pools(): Promise<Pool[]>;
  pool(id: number): Promise<Pool>;
  position(id: number, address: string): Promise<Position>;
}

export function createApiClient(baseUrl: string, transport: Transport = fetchTransport): ApiClient {
  const root = baseUrl.replace(/\/+$/, "");

  async function call<S extends z.ZodTypeAny>(schema: S, request: Omit<HttpRequest, "url"> & { path: string }): Promise<z.infer<S>> {
    let res: HttpResponse;
    try {
      res = await transport({ method: request.method, url: `${root}${request.path}`, body: request.body });
    } catch {
      throw new ApiClientError("NETWORK", "Couldn't reach the PredictX server.", 0);
    }
    if (res.status < 200 || res.status >= 300) {
      const apiError = ApiError.safeParse(res.body);
      if (apiError.success) throw new ApiClientError(apiError.data.error.code, apiError.data.error.message, res.status);
      throw new ApiClientError("INTERNAL", `The server answered ${res.status}.`, res.status);
    }
    const parsed = schema.safeParse(res.body);
    if (!parsed.success) throw new ApiClientError("CONTRACT_MISMATCH", "The server sent an unexpected response.", res.status);
    return parsed.data;
  }

  return {
    tokens: async () => (await call(TokensResponse, { method: "GET", path: "/tokens" })).tokens,
    market: (symbol) => call(Market, { method: "GET", path: `/market/${encodeURIComponent(symbol)}` }),
    chart: (symbol, range) => call(MarketChart, { method: "GET", path: `/market/${encodeURIComponent(symbol)}/chart?range=${range}` }),
    insight: (request) => call(InsightResponse, { method: "POST", path: "/insight", body: request }),
    flashQuote: (request) => call(FlashQuoteResponse, { method: "POST", path: "/flash/quote", body: request }),
    pools: async () => (await call(PoolsResponse, { method: "GET", path: "/pools" })).pools,
    pool: (id) => call(Pool, { method: "GET", path: `/pools/${id}` }),
    position: (id, address) => call(Position, { method: "GET", path: `/pools/${id}/position?address=${address}` }),
  };
}
