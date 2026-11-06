import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COINGECKO_DEFAULT_BASE_URL,
  COINGECKO_TIMEOUT_MS,
  CoinGeckoPriceSource,
  createPriceSource,
} from "../../src/clients/coingecko";
import { PriceSourceError } from "../../src/clients/priceSource";
import { loadConfig } from "../../src/config";
import { envWith } from "../helpers/env";

afterEach(() => {
  vi.useRealTimers();
});

interface RecordedCall {
  url: URL;
  headers: Headers;
  signal: AbortSignal | null | undefined;
}

function urlOf(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

/** A fetch stand-in that records each call and answers every one with the same canned reply. */
function fetchReplying(status: number, body: unknown, contentType = "application/json") {
  const calls: RecordedCall[] = [];
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: urlOf(input), headers: new Headers(init?.headers), signal: init?.signal });
    return new Response(text, { status, headers: { "content-type": contentType } });
  };
  return { calls, fetchImpl };
}

function onlyCall(calls: RecordedCall[]): RecordedCall {
  const call = calls[0];
  if (!call || calls.length !== 1) throw new Error(`expected exactly one fetch call, got ${calls.length}`);
  return call;
}

// Observed keyless reply, docs/notes/coingecko-api.md section 2 (2026-10-28).
const SIMPLE_PRICE_ETH = {
  ethereum: { usd: 2357.43, usd_24h_change: 0.38204610173698295, last_updated_at: 1793231060 },
};
const DEMO_KEY = "CG-demo-key-123";
const PRO_BASE_URL = "https://pro-api.coingecko.com/api/v3";

describe("B02-15 simplePrice request shape and auth header", () => {
  it("GETs /api/v3/simple/price with ids, vs_currencies=usd, include_24hr_change=true, precision=full and no key header", async () => {
    const { calls, fetchImpl } = fetchReplying(200, SIMPLE_PRICE_ETH);
    const client = new CoinGeckoPriceSource({ apiKey: "", fetchImpl });
    const prices = await client.simplePrice(["ethereum"]);
    const { url, headers } = onlyCall(calls);
    expect(`${url.origin}${url.pathname}`).toBe(`${COINGECKO_DEFAULT_BASE_URL}/simple/price`);
    expect(url.searchParams.get("ids")).toBe("ethereum");
    expect(url.searchParams.get("vs_currencies")).toBe("usd");
    expect(url.searchParams.get("include_24hr_change")).toBe("true");
    // PEPE gotcha: without precision=full CoinGecko rounds 5.0079e-06 to 5.0e-06 (notes section 2).
    expect(url.searchParams.get("precision")).toBe("full");
    expect(headers.has("x-cg-demo-api-key")).toBe(false);
    expect(headers.has("x-cg-pro-api-key")).toBe(false);
    expect(prices).toEqual({ ethereum: { usd: 2357.43, usd24hChange: 0.38204610173698295 } });
  });

  it("sends x-cg-demo-api-key on the public host when a key is configured", async () => {
    const { calls, fetchImpl } = fetchReplying(200, SIMPLE_PRICE_ETH);
    const client = new CoinGeckoPriceSource({ apiKey: DEMO_KEY, fetchImpl });
    await client.simplePrice(["ethereum"]);
    const { headers } = onlyCall(calls);
    expect(headers.get("x-cg-demo-api-key")).toBe(DEMO_KEY);
    expect(headers.has("x-cg-pro-api-key")).toBe(false);
  });

  it("sends x-cg-pro-api-key instead when the base URL is the pro host (notes section 1 header rule)", async () => {
    const { calls, fetchImpl } = fetchReplying(200, SIMPLE_PRICE_ETH);
    const client = new CoinGeckoPriceSource({ apiKey: DEMO_KEY, baseUrl: PRO_BASE_URL, fetchImpl });
    await client.simplePrice(["ethereum"]);
    const { url, headers } = onlyCall(calls);
    expect(url.origin).toBe("https://pro-api.coingecko.com");
    expect(headers.get("x-cg-pro-api-key")).toBe(DEMO_KEY);
    expect(headers.has("x-cg-demo-api-key")).toBe(false);
  });

  it("joins ids with a comma, maps every returned coin, and turns a null or missing 24h change into null", async () => {
    const body = {
      ethereum: { usd: 2357.43, usd_24h_change: null },
      pepe: { usd: 5.007934381530032e-6 },
    };
    const { calls, fetchImpl } = fetchReplying(200, body);
    const client = new CoinGeckoPriceSource({ apiKey: "", fetchImpl });
    const prices = await client.simplePrice(["ethereum", "pepe", "not-a-real-coin-xyz"]);
    expect(onlyCall(calls).url.searchParams.get("ids")).toBe("ethereum,pepe,not-a-real-coin-xyz");
    // CoinGecko drops unknown ids silently; the client must not invent an entry for them.
    expect(prices).toEqual({
      ethereum: { usd: 2357.43, usd24hChange: null },
      pepe: { usd: 5.007934381530032e-6, usd24hChange: null },
    });
  });

  it("createPriceSource(config, fetchImpl) reads COINGECKO_API_KEY from the typed config", async () => {
    const { calls, fetchImpl } = fetchReplying(200, SIMPLE_PRICE_ETH);
    const config = loadConfig(envWith({ COINGECKO_API_KEY: DEMO_KEY }));
    const source = createPriceSource(config, fetchImpl);
    expect(source).toBeInstanceOf(CoinGeckoPriceSource);
    await source.simplePrice(["ethereum"]);
    expect(onlyCall(calls).headers.get("x-cg-demo-api-key")).toBe(DEMO_KEY);
  });
});

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the promise to reject");
}

// Observed error bodies, docs/notes/coingecko-api.md section 5.
const RATE_LIMIT_BODY = {
  status: { error_code: 429, error_message: "You've exceeded the Rate Limit. Please visit https://www.coingecko.com/en/api/pricing" },
};
const WRONG_KEY_TYPE_BODY = {
  timestamp: "2026-10-28T23:49:49.127+00:00",
  error_code: 10010,
  status: { error_message: "If you are using Pro API key, please change your root URL" },
};

describe("B02-16 non-200 upstream response", () => {
  it("throws PriceSourceError carrying the status and the upstream error_message", async () => {
    const { fetchImpl } = fetchReplying(429, RATE_LIMIT_BODY);
    const client = new CoinGeckoPriceSource({ apiKey: "", fetchImpl });
    const err = await rejection(client.simplePrice(["ethereum"]));
    expect(err).toBeInstanceOf(PriceSourceError);
    if (!(err instanceof PriceSourceError)) return;
    expect(err.status).toBe(429);
    expect(err.message).toContain("429");
    expect(err.message).toContain("exceeded the Rate Limit");
  });

  it("reads error_message from the top-level error_code shape too, and never includes the key", async () => {
    const { fetchImpl } = fetchReplying(400, WRONG_KEY_TYPE_BODY);
    const client = new CoinGeckoPriceSource({ apiKey: DEMO_KEY, fetchImpl });
    const err = await rejection(client.simplePrice(["ethereum"]));
    expect(err).toBeInstanceOf(PriceSourceError);
    if (!(err instanceof PriceSourceError)) return;
    expect(err.status).toBe(400);
    expect(err.message).toContain("change your root URL");
    expect(err.message).not.toContain(DEMO_KEY);
  });

  it("tolerates a non-JSON body (Cloudflare 'Throttled') and still reports the status", async () => {
    const { fetchImpl } = fetchReplying(429, "Throttled", "text/plain");
    const client = new CoinGeckoPriceSource({ apiKey: "", fetchImpl });
    const err = await rejection(client.simplePrice(["ethereum"]));
    expect(err).toBeInstanceOf(PriceSourceError);
    if (!(err instanceof PriceSourceError)) return;
    expect(err.status).toBe(429);
  });

  it("a 200 whose body is not the documented shape is a PriceSourceError, not a crash in the caller", async () => {
    const { fetchImpl } = fetchReplying(200, { ethereum: { usd: "2357.43" } });
    const client = new CoinGeckoPriceSource({ apiKey: "", fetchImpl });
    const err = await rejection(client.simplePrice(["ethereum"]));
    expect(err).toBeInstanceOf(PriceSourceError);
    if (!(err instanceof PriceSourceError)) return;
    expect(err.status).toBe(200);
  });

  it("a network failure (fetch rejects) becomes a PriceSourceError without a status", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const client = new CoinGeckoPriceSource({ apiKey: "", fetchImpl });
    const err = await rejection(client.simplePrice(["ethereum"]));
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
    const client = new CoinGeckoPriceSource({ apiKey: "", fetchImpl });
    const outcome = rejection(client.simplePrice(["ethereum"]));
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

// Observed /coins/markets item trimmed to the fields we read, docs/notes/coingecko-api.md section 3.
const COINS_MARKETS_ETH = [
  {
    id: "ethereum",
    symbol: "eth",
    name: "Ethereum",
    current_price: 2357.43,
    price_change_percentage_24h: 0.40332,
    price_change_percentage_7d_in_currency: -5.5444,
    last_updated: "2026-10-28T23:43:42.000Z",
  },
];

describe("B02-18 7d change comes from /coins/markets, only when asked (D-B7)", () => {
  it("simplePrice never asks for a 7d field (simple/price has none)", async () => {
    const { calls, fetchImpl } = fetchReplying(200, SIMPLE_PRICE_ETH);
    await new CoinGeckoPriceSource({ apiKey: "", fetchImpl }).simplePrice(["ethereum"]);
    const { url } = onlyCall(calls);
    expect(url.searchParams.has("price_change_percentage")).toBe(false);
    expect(url.searchParams.has("include_7d_change")).toBe(false);
  });

  it("change7dPct(id) GETs /coins/markets?vs_currency=usd&ids=<id>&price_change_percentage=7d with the key header", async () => {
    const { calls, fetchImpl } = fetchReplying(200, COINS_MARKETS_ETH);
    const client = new CoinGeckoPriceSource({ apiKey: DEMO_KEY, fetchImpl });
    const change = await client.change7dPct("ethereum");
    const { url, headers } = onlyCall(calls);
    expect(`${url.origin}${url.pathname}`).toBe(`${COINGECKO_DEFAULT_BASE_URL}/coins/markets`);
    expect(url.searchParams.get("vs_currency")).toBe("usd");
    expect(url.searchParams.get("ids")).toBe("ethereum");
    expect(url.searchParams.get("price_change_percentage")).toBe("7d");
    expect(headers.get("x-cg-demo-api-key")).toBe(DEMO_KEY);
    expect(change).toBe(-5.5444);
  });

  it("returns null when CoinGecko has no 7d figure (field null) or does not list the id at all", async () => {
    const nulled = fetchReplying(200, [{ ...COINS_MARKETS_ETH[0], price_change_percentage_7d_in_currency: null }]);
    expect(await new CoinGeckoPriceSource({ apiKey: "", fetchImpl: nulled.fetchImpl }).change7dPct("ethereum")).toBeNull();
    const missing = fetchReplying(200, []);
    expect(await new CoinGeckoPriceSource({ apiKey: "", fetchImpl: missing.fetchImpl }).change7dPct("ethereum")).toBeNull();
  });

  it("a non-200 reply is a PriceSourceError with the status, like simplePrice", async () => {
    const { fetchImpl } = fetchReplying(429, RATE_LIMIT_BODY);
    const err = await rejection(new CoinGeckoPriceSource({ apiKey: "", fetchImpl }).change7dPct("ethereum"));
    expect(err).toBeInstanceOf(PriceSourceError);
    if (!(err instanceof PriceSourceError)) return;
    expect(err.status).toBe(429);
  });
});
