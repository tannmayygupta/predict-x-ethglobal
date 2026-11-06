import { describe, expect, it } from "vitest";
import { ApiClientError, createApiClient } from "../../src/api";
import { isMockQuote } from "../../src/view";

/**
 * Merge checklist: "every real endpoint response passes the zod schema the frontend uses". The client parses every
 * response with the shared schema, so a call that resolves IS a schema pass, and drift throws CONTRACT_MISMATCH.
 * Needs the backend on E2E_API_BASE (default http://localhost:8787/api/v1).
 */
const base = process.env.E2E_API_BASE ?? "http://localhost:8787/api/v1";
const api = createApiClient(base);
const WALLET = "0x1111111111111111111111111111111111111111";

describe("every endpoint, through the typed client the apps use", () => {
  it("GET /tokens: the allowlist, with ETH the only Flash-tradable token", async () => {
    const tokens = await api.tokens();
    expect(tokens.map((t) => t.symbol)).toContain("ETH");
    expect(tokens.filter((t) => t.flashSupported).map((t) => t.symbol)).toEqual(["ETH"]);
  });

  it("GET /market/ETH: a live price", async () => {
    const market = await api.market("ETH");
    expect(Number(market.priceUsd)).toBeGreaterThan(0);
    expect(market.updatedAt).toBeGreaterThan(Date.now() / 1000 - 3600);
  });

  it("GET /market/<unknown>: UNSUPPORTED_TOKEN with a readable message", async () => {
    const err = await api.market("NOPE").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).code).toBe("UNSUPPORTED_TOKEN");
    expect((err as ApiClientError).message.length).toBeGreaterThan(5);
  });

  it("POST /insight: a tip, degraded or not, never an error", async () => {
    const insight = await api.insight({ symbol: "ETH", userIntent: "I want to buy on a dip" });
    expect(insight.tip.length).toBeGreaterThan(0);
    expect(typeof insight.degraded).toBe("boolean");
    expect(insight.disclaimer).toBeTruthy();
  });

  it("POST /flash/quote: a quote with its signing steps (a q_mock_ id means the backend is in mock mode)", async () => {
    const quote = await api.flashQuote({ walletAddress: WALLET, symbol: "ETH", side: "buy", orderType: "market", amount: "2.00" });
    expect(quote.chainId).toBe(8453);
    expect(Number(quote.spend.amount)).toBe(2);
    expect(quote.steps.orderTypedData.length).toBeGreaterThan(2);
    if (isMockQuote(quote.quoteId)) process.stderr.write("NOTE: backend is in FLASH_MOCK mode; these are not real Flash quotes\n");
  });

  it("POST /flash/quote above the cap is refused as BAD_REQUEST", async () => {
    const err = await api.flashQuote({ walletAddress: WALLET, symbol: "ETH", side: "buy", orderType: "market", amount: "5.01" }).catch((e: unknown) => e);
    expect((err as ApiClientError).code).toBe("BAD_REQUEST");
  });

  it("GET /pools, /pools/:id and /pools/:id/position agree with each other", async () => {
    const pools = await api.pools();
    expect(pools.length).toBeGreaterThan(0);
    const first = pools[0];
    if (!first) throw new Error("no pools");
    const one = await api.pool(first.id);
    expect(one.question).toBe(first.question);
    const position = await api.position(first.id, first.creator);
    expect(position.poolId).toBe(first.id);
  });

  it("GET /pools/999999: NOT_FOUND", async () => {
    const err = await api.pool(999_999).catch((e: unknown) => e);
    expect((err as ApiClientError).code).toBe("NOT_FOUND");
  });
});
