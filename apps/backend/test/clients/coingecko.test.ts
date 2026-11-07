import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COINGECKO_DEFAULT_BASE_URL,
  COINGECKO_TIMEOUT_MS,
  CoinGeckoPriceSource,
  createPriceSource,
} from "../../src/clients/coingecko";
import { PriceSourceError } from "../../src/clients/priceSource";
import { loadConfig } from "../../src/config";
import { RATE_LIMIT_BODY, fetchReplying, onlyCall, rejection } from "../helpers/coingeckoFetch";
import { envWith } from "../helpers/env";

afterEach(() => {
  vi.useRealTimers();
});

// Trimmed /coins/markets items, docs/notes/coingecko-api.md section 3 (keys we read).
const COINS_MARKETS = [
  {
    id: "ethereum",
    symbol: "eth",
    current_price: 2357.43,
    price_change_percentage_24h: 0.38204610173698295,
    price_change_percentage_7d_in_currency: -5.5444,
    market_cap: 284_000_000_000,
    total_volume: 11_580_000_000,
    high_24h: 2380.5,
    low_24h: 2310.25,
  },
  { id: "pepe", current_price: 5.007934381530032e-6, price_change_percentage_24h: null },
  { id: "no-price", current_price: null },
];
const DEMO_KEY = "CG-demo-key-123";
const PRO_BASE_URL = "https://pro-api.coingecko.com/api/v3";

describe("B02-15 markets request shape and auth header", () => {
  it("GETs ONE /coins/markets with every id, usd, per_page 250, 24h and 7d changes, full precision and no key header", async () => {
    const { calls, fetchImpl } = fetchReplying(200, COINS_MARKETS);
    const client = new CoinGeckoPriceSource({ apiKey: "", fetchImpl });
    await client.markets(["ethereum", "pepe"]);
    const { url, headers } = onlyCall(calls);
    expect(`${url.origin}${url.pathname}`).toBe(`${COINGECKO_DEFAULT_BASE_URL}/coins/markets`);
    expect(url.searchParams.get("ids")).toBe("ethereum,pepe");
    expect(url.searchParams.get("vs_currency")).toBe("usd");
    expect(url.searchParams.get("per_page")).toBe("250");
    expect(url.searchParams.get("price_change_percentage")).toBe("24h,7d");
    // PEPE gotcha: without precision=full CoinGecko rounds 5.0079e-06 to 5.0e-06 (notes section 2).
    expect(url.searchParams.get("precision")).toBe("full");
    expect(url.searchParams.get("sparkline")).toBe("false");
    expect(headers.has("x-cg-demo-api-key")).toBe(false);
    expect(headers.has("x-cg-pro-api-key")).toBe(false);
  });

  it("maps every field we read, nulls what is missing and drops a coin without a price", async () => {
    const { fetchImpl } = fetchReplying(200, COINS_MARKETS);
    const markets = await new CoinGeckoPriceSource({ apiKey: "", fetchImpl }).markets(["ethereum", "pepe", "no-price"]);
    expect(markets.ethereum).toEqual({
      usd: 2357.43,
      change24hPct: 0.38204610173698295,
      change7dPct: -5.5444,
      marketCapUsd: 284_000_000_000,
      volume24hUsd: 11_580_000_000,
      high24hUsd: 2380.5,
      low24hUsd: 2310.25,
    });
    expect(markets.pepe).toEqual({
      usd: 5.007934381530032e-6,
      change24hPct: null,
      change7dPct: null,
      marketCapUsd: null,
      volume24hUsd: null,
      high24hUsd: null,
      low24hUsd: null,
    });
    // CoinGecko drops unknown ids silently; the client must not invent an entry for them.
    expect(Object.keys(markets)).toEqual(["ethereum", "pepe"]);
  });

  it("sends x-cg-demo-api-key on the public host when a key is configured", async () => {
    const { calls, fetchImpl } = fetchReplying(200, COINS_MARKETS);
    await new CoinGeckoPriceSource({ apiKey: DEMO_KEY, fetchImpl }).markets(["ethereum"]);
    const { headers } = onlyCall(calls);
    expect(headers.get("x-cg-demo-api-key")).toBe(DEMO_KEY);
    expect(headers.has("x-cg-pro-api-key")).toBe(false);
  });

  it("sends x-cg-pro-api-key instead when the base URL is the pro host (notes section 1 header rule)", async () => {
    const { calls, fetchImpl } = fetchReplying(200, COINS_MARKETS);
    await new CoinGeckoPriceSource({ apiKey: DEMO_KEY, baseUrl: PRO_BASE_URL, fetchImpl }).markets(["ethereum"]);
    const { url, headers } = onlyCall(calls);
    expect(url.origin).toBe("https://pro-api.coingecko.com");
    expect(headers.get("x-cg-pro-api-key")).toBe(DEMO_KEY);
    expect(headers.has("x-cg-demo-api-key")).toBe(false);
  });

  it("createPriceSource(config, fetchImpl) reads COINGECKO_API_KEY from the typed config", async () => {
    const { calls, fetchImpl } = fetchReplying(200, COINS_MARKETS);
    const config = loadConfig(envWith({ COINGECKO_API_KEY: DEMO_KEY }));
    const source = createPriceSource(config, fetchImpl);
    expect(source).toBeInstanceOf(CoinGeckoPriceSource);
    await source.markets(["ethereum"]);
    expect(onlyCall(calls).headers.get("x-cg-demo-api-key")).toBe(DEMO_KEY);
  });
});

const WRONG_KEY_TYPE_BODY = {
  timestamp: "2026-10-28T23:49:49.127+00:00",
  error_code: 10010,
  status: { error_message: "If you are using Pro API key, please change your root URL" },
};

describe("B02-16 non-200 upstream response", () => {
  it("throws PriceSourceError carrying the status and the upstream error_message", async () => {
    const { fetchImpl } = fetchReplying(429, RATE_LIMIT_BODY);
    const err = await rejection(new CoinGeckoPriceSource({ apiKey: "", fetchImpl }).markets(["ethereum"]));
    expect(err).toBeInstanceOf(PriceSourceError);
    if (!(err instanceof PriceSourceError)) return;
    expect(err.status).toBe(429);
    expect(err.message).toContain("429");
    expect(err.message).toContain("exceeded the Rate Limit");
  });

  it("reads error_message from the top-level error_code shape too, and never includes the key", async () => {
    const { fetchImpl } = fetchReplying(400, WRONG_KEY_TYPE_BODY);
    const err = await rejection(new CoinGeckoPriceSource({ apiKey: DEMO_KEY, fetchImpl }).markets(["ethereum"]));
    expect(err).toBeInstanceOf(PriceSourceError);
    if (!(err instanceof PriceSourceError)) return;
    expect(err.status).toBe(400);
    expect(err.message).toContain("change your root URL");
    expect(err.message).not.toContain(DEMO_KEY);
  });

  it("tolerates a non-JSON body (Cloudflare 'Throttled') and still reports the status", async () => {
    const { fetchImpl } = fetchReplying(429, "Throttled", "text/plain");
    const err = await rejection(new CoinGeckoPriceSource({ apiKey: "", fetchImpl }).markets(["ethereum"]));
    expect(err).toBeInstanceOf(PriceSourceError);
    if (!(err instanceof PriceSourceError)) return;
    expect(err.status).toBe(429);
  });

  it("a 200 whose body is not the documented shape is a PriceSourceError, not a crash in the caller", async () => {
    const { fetchImpl } = fetchReplying(200, { ethereum: { usd: "2357.43" } });
    const err = await rejection(new CoinGeckoPriceSource({ apiKey: "", fetchImpl }).markets(["ethereum"]));
    expect(err).toBeInstanceOf(PriceSourceError);
    if (!(err instanceof PriceSourceError)) return;
    expect(err.status).toBe(200);
  });

  it("a network failure (fetch rejects) becomes a PriceSourceError without a status", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const err = await rejection(new CoinGeckoPriceSource({ apiKey: "", fetchImpl }).markets(["ethereum"]));
    expect(err).toBeInstanceOf(PriceSourceError);
    if (!(err instanceof PriceSourceError)) return;
    expect(err.status).toBeUndefined();
    expect(err.message).toContain("fetch failed");
  });
});

describe("B02-17 request timeout", () => {
  it("aborts the fetch signal at 3 s (fake timers, no real waiting) and rejects with PriceSourceError", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    // A fetch that never answers on its own: it only settles when the client aborts it.
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        signal = init?.signal;
        signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")));
      });
    const outcome = rejection(new CoinGeckoPriceSource({ apiKey: "", fetchImpl }).markets(["ethereum"]));
    await vi.advanceTimersByTimeAsync(COINGECKO_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    const err = await outcome;
    expect(err).toBeInstanceOf(PriceSourceError);
    if (!(err instanceof PriceSourceError)) return;
    expect(err.message).toContain("timed out");
    expect(err.status).toBeUndefined();
  });

  it("COINGECKO_TIMEOUT_MS is 3 s (TEST_PLAN B02-17)", () => {
    expect(COINGECKO_TIMEOUT_MS).toBe(3000);
  });
});

