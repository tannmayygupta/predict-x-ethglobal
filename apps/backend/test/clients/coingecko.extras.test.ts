import { describe, expect, it } from "vitest";
import { CoinGeckoPriceSource, truncateUsd } from "../../src/clients/coingecko";
import { PriceSourceError } from "../../src/clients/priceSource";
import { RATE_LIMIT_BODY, fetchReplying, onlyCall, rejection } from "../helpers/coingeckoFetch";

const DEMO_KEY = "CG-demo-key-123";

describe("429 opens a blockedUntil window honouring Retry-After", () => {
  function blockedClient(headers: Record<string, string>) {
    let now = 1_000_000;
    const first = fetchReplying(429, RATE_LIMIT_BODY, "application/json", headers);
    const client = new CoinGeckoPriceSource({ apiKey: "", fetchImpl: first.fetchImpl, nowMs: () => now });
    return { client, calls: first.calls, advance: (ms: number) => (now += ms) };
  }

  it("sends no request at all while the Retry-After window is open, then tries again once it ends", async () => {
    const { client, calls, advance } = blockedClient({ "retry-after": "30" });
    await rejection(client.markets(["ethereum"]));
    expect(calls).toHaveLength(1);
    advance(29_000);
    const blocked = await rejection(client.marketChart("ethereum", 1));
    expect(blocked).toBeInstanceOf(PriceSourceError);
    expect((blocked as PriceSourceError).status).toBe(429);
    expect(calls).toHaveLength(1);
    advance(1_001);
    await rejection(client.markets(["ethereum"]));
    expect(calls).toHaveLength(2);
  });

  it("falls back to 60 s when Retry-After is missing or not a number, and caps an absurd value", async () => {
    const missing = blockedClient({});
    await rejection(missing.client.markets(["ethereum"]));
    missing.advance(59_000);
    await rejection(missing.client.markets(["ethereum"]));
    expect(missing.calls).toHaveLength(1);
    missing.advance(2_000);
    await rejection(missing.client.markets(["ethereum"]));
    expect(missing.calls).toHaveLength(2);

    const absurd = blockedClient({ "retry-after": "999999" });
    await rejection(absurd.client.markets(["ethereum"]));
    absurd.advance(601_000);
    await rejection(absurd.client.markets(["ethereum"]));
    expect(absurd.calls).toHaveLength(2);
  });
});

// Real shape: [ms, price] pairs, 289 five-minute points for days=1.
const MARKET_CHART = { prices: [[1_761_513_600_123, 2496.05], [1_761_513_900_000, 2490.1]], market_caps: [], total_volumes: [] };

describe("marketChart(id, days)", () => {
  it("GETs /coins/{id}/market_chart with usd, days and full precision, and returns [unix seconds, price]", async () => {
    const { calls, fetchImpl } = fetchReplying(200, MARKET_CHART);
    const points = await new CoinGeckoPriceSource({ apiKey: DEMO_KEY, fetchImpl }).marketChart("based-brett", 7);
    const { url, headers } = onlyCall(calls);
    expect(url.pathname).toBe("/api/v3/coins/based-brett/market_chart");
    expect(url.searchParams.get("vs_currency")).toBe("usd");
    expect(url.searchParams.get("days")).toBe("7");
    expect(url.searchParams.get("precision")).toBe("full");
    expect(headers.get("x-cg-demo-api-key")).toBe(DEMO_KEY);
    expect(points).toEqual([[1_761_513_600, 2496.05], [1_761_513_900, 2490.1]]);
  });

  it("a body without prices is a PriceSourceError", async () => {
    const { fetchImpl } = fetchReplying(200, { market_caps: [] });
    expect(await rejection(new CoinGeckoPriceSource({ apiKey: "", fetchImpl }).marketChart("ethereum", 1))).toBeInstanceOf(PriceSourceError);
  });
});

// The reserve string really arrives with a ~200 digit tail after the cents.
const JUNK_TAIL = "7".repeat(200);
const onchainBody = (reserve: unknown) => ({ data: { id: "base_0x42", attributes: { total_reserve_in_usd: reserve } } });

describe("onchainLiquidityUsd(network, address)", () => {
  it("GETs /onchain/networks/{network}/tokens/{address} on the same host and key", async () => {
    const { calls, fetchImpl } = fetchReplying(200, onchainBody("138690000.5"));
    const liquidity = await new CoinGeckoPriceSource({ apiKey: DEMO_KEY, fetchImpl }).onchainLiquidityUsd(
      "base",
      "0x4200000000000000000000000000000000000006",
    );
    const { url, headers } = onlyCall(calls);
    expect(url.pathname).toBe("/api/v3/onchain/networks/base/tokens/0x4200000000000000000000000000000000000006");
    expect(headers.get("x-cg-demo-api-key")).toBe(DEMO_KEY);
    expect(liquidity).toBe("138690000.5");
  });

  it("truncates (never rounds) the junk tail to at most two decimals", async () => {
    const { fetchImpl } = fetchReplying(200, onchainBody(`138690000.999${JUNK_TAIL}`));
    const client = new CoinGeckoPriceSource({ apiKey: "", fetchImpl });
    expect(await client.onchainLiquidityUsd("base", "0xabc")).toBe("138690000.99");
  });

  it.each([
    ["138690000", "138690000"],
    ["0.5", "0.5"],
    ["12.3456789", "12.34"],
    [`1.2${JUNK_TAIL}`, "1.27"],
    [1234.567, "1234.56"],
    ["1.5e7", "15000000"],
    ["-5", null],
    ["not a number", null],
  ])("truncateUsd(%j) is %j", (input, expected) => {
    expect(truncateUsd(input)).toBe(expected);
  });

  it("is null when CoinGecko lists no pool: a 404, or a null reserve", async () => {
    const missing = fetchReplying(404, { error: "not found" });
    expect(await new CoinGeckoPriceSource({ apiKey: "", fetchImpl: missing.fetchImpl }).onchainLiquidityUsd("base", "0xabc")).toBeNull();
    const nulled = fetchReplying(200, onchainBody(null));
    expect(await new CoinGeckoPriceSource({ apiKey: "", fetchImpl: nulled.fetchImpl }).onchainLiquidityUsd("base", "0xabc")).toBeNull();
  });

  it("refuses a network id outside [a-z0-9_-] before any request is built", async () => {
    const { calls, fetchImpl } = fetchReplying(200, onchainBody("1"));
    const client = new CoinGeckoPriceSource({ apiKey: "", fetchImpl });
    for (const bad of ["", "base/../x", "Base", "ba se", "base?x=1"]) {
      expect(await rejection(client.onchainLiquidityUsd(bad, "0xabc"))).toBeInstanceOf(PriceSourceError);
    }
    expect(calls).toHaveLength(0);
  });

  it("other failures stay errors for the caller to turn into null: a 500 and an unreadable body", async () => {
    const down = fetchReplying(500, "oops", "text/plain");
    expect(await rejection(new CoinGeckoPriceSource({ apiKey: "", fetchImpl: down.fetchImpl }).onchainLiquidityUsd("base", "0xabc"))).toBeInstanceOf(
      PriceSourceError,
    );
    const odd = fetchReplying(200, { data: {} });
    expect(await rejection(new CoinGeckoPriceSource({ apiKey: "", fetchImpl: odd.fetchImpl }).onchainLiquidityUsd("base", "0xabc"))).toBeInstanceOf(
      PriceSourceError,
    );
  });
});
