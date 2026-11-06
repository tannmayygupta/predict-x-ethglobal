/** Real endpoints only (API_CONTRACT section 2). /flash/order* is disabled on this server, so it is not listed. */
export type HttpMethod = "GET" | "POST";

export interface Endpoint {
  id: string;
  method: HttpMethod;
  /** Path template relative to the API base URL; `:name` segments become inputs. */
  path: string;
  params: string[];
  query?: string;
  /** Prefilled JSON body for POST endpoints (shapes from packages/shared/src/schemas.ts). */
  body?: string;
  hint: string;
}

// Placeholder only (the zero address, built so no wallet literal ships); replace it with your own wallet to try a real quote.
export const SAMPLE_WALLET = `0x${"0".repeat(40)}`;

const FLASH_QUOTE_BODY = JSON.stringify(
  { walletAddress: SAMPLE_WALLET, symbol: "ETH", side: "buy", orderType: "market", amount: "5", slippage: "0.01" },
  null,
  2,
);

export const ENDPOINTS: Endpoint[] = [
  { id: "health", method: "GET", path: "/health", params: [], hint: "Liveness check." },
  { id: "tokens", method: "GET", path: "/tokens", params: [], hint: "Supported tokens." },
  { id: "market", method: "GET", path: "/market/:symbol", params: ["symbol"], hint: "Price and 24h change, for example ETH." },
  { id: "insight", method: "POST", path: "/insight", params: [], body: JSON.stringify({ symbol: "ETH", userIntent: "swing trade" }, null, 2), hint: "AI note for a token. Text only, never places anything." },
  { id: "flash-quote", method: "POST", path: "/flash/quote", params: [], body: FLASH_QUOTE_BODY, hint: "Swap quote only. Orders are off on this server." },
  { id: "pools", method: "GET", path: "/pools", params: [], hint: "Latest pools." },
  { id: "pool", method: "GET", path: "/pools/:id", params: ["id"], hint: "One pool by id." },
  { id: "position", method: "GET", path: "/pools/:id/position", params: ["id"], query: "address", hint: "A wallet's position in a pool." },
];

export const DEFAULT_PARAMS: Record<string, string> = { symbol: "ETH", id: "1", address: SAMPLE_WALLET };

/** Fills `:name` segments and the optional query string; values are URL-encoded. */
export function buildPath(endpoint: Endpoint, values: Record<string, string>): string {
  let path = endpoint.path;
  for (const name of endpoint.params) path = path.replace(`:${name}`, encodeURIComponent(values[name] ?? ""));
  if (endpoint.query) path += `?${endpoint.query}=${encodeURIComponent(values[endpoint.query] ?? "")}`;
  return path;
}
