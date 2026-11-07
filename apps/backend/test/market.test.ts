import { ApiError, DecimalString, Market } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { PriceSourceError } from "../src/clients/priceSource";
import {
  LIQUIDITY_FAILURE_BACKOFF_SECONDS,
  LIQUIDITY_TTL_SECONDS,
  MARKET_TTL_SECONDS,
  MarketService,
  PRICE_MAX_STALE_SECONDS,
  sharedMarketService,
} from "../src/services/market";
import { numberToDecimalString, signedChangeUsd } from "../src/util/decimal";
import { buildTestApp } from "./helpers/build";
import { FakeClock } from "./helpers/fakes/clock";
import { FakePriceSource, series, type SimplePriceEntry } from "./helpers/fakes/priceSource";
import { LogCapture } from "./helpers/logCapture";

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

const ETH_PRICE: SimplePriceEntry = { usd: 2451.12, usd24hChange: -1.8 };
const BTC_PRICE: SimplePriceEntry = { usd: 81269, usd24hChange: 0.5 };
const ETH_ONCHAIN = "base:0x4200000000000000000000000000000000000006";

function priced(prices: Record<string, SimplePriceEntry>): FakePriceSource {
  const source = new FakePriceSource();
  Object.assign(source.prices, prices);
  return source;
}

async function getMarket(app: Built["app"], symbol: string) {
  return app.inject({ method: "GET", url: `/api/v1/market/${symbol}` });
}

const callsOf = (source: FakePriceSource, method: string) => source.calls.filter((c) => c.method === method);

describe("B02-05 GET /market/ETH happy path", () => {
  it("returns 200, parses with Market, and maps price, 24h change and updatedAt = clock.now()", async () => {
    const priceSource = priced({ ethereum: ETH_PRICE });
    built = await buildTestApp({ priceSource });
    const res = await getMarket(built.app, "ETH");
    expect(res.statusCode).toBe(200);
    const market = Market.parse(res.json());
    expect(market.priceUsd).toBe("2451.12");
    expect(market.change24hPct).toBe(-1.8);
    expect(market.updatedAt).toBe(built.clock.now());
    // One batched call for every allowlist id, never one call per symbol.
    const [batch] = callsOf(priceSource, "markets");
    expect(batch).toMatchObject({ method: "markets", ids: ["ethereum", "bitcoin", "pepe", "degen-base", "based-brett"] });
  });

  it("emits every new key (the response hook does not apply schema defaults) and fills them from CoinGecko", async () => {
    const priceSource = priced({
      ethereum: { ...ETH_PRICE, marketCapUsd: 295_820_000_000, volume24hUsd: 11_580_000_000, high24hUsd: 2503.4, low24hUsd: 2431.07 },
    });
    priceSource.liquidity[ETH_ONCHAIN] = "138690000.12";
    built = await buildTestApp({ priceSource });
    const body: Record<string, unknown> = (await getMarket(built.app, "ETH")).json();
    expect(body).toMatchObject({
      change24hUsd: "-44.93",
      marketCapUsd: "295820000000",
      volume24hUsd: "11580000000",
      high24hUsd: "2503.4",
      low24hUsd: "2431.07",
      liquidityUsd: "138690000.12",
      verified: true,
    });
    expect(Object.keys(body)).toEqual(expect.arrayContaining(["change24hUsd", "marketCapUsd", "volume24hUsd", "high24hUsd", "low24hUsd", "liquidityUsd", "verified"]));
  });
});

describe("B02-06 static fields come from tokens.json", () => {
  it("address and flashChainId are the allowlist values, not anything CoinGecko returned", async () => {
    built = await buildTestApp({ priceSource: priced({ ethereum: ETH_PRICE }) });
    const market = Market.parse((await getMarket(built.app, "ETH")).json());
    expect(market.name).toBe("Ethereum");
    expect(market.address).toBe("0x4200000000000000000000000000000000000006");
    expect(market.flashChainId).toBe(8453);
    expect(market.verified).toBe(true);
  });
  it("BTC maps to cbBTC on Base and is verified; PEPE has no Flash listing, no address and is not verified", async () => {
    built = await buildTestApp({ priceSource: priced({ bitcoin: BTC_PRICE, pepe: { usd: 0.000012, usd24hChange: 1 } }) });
    const btc = Market.parse((await getMarket(built.app, "BTC")).json());
    expect(btc.address).toBe("0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf");
    expect(btc.flashChainId).toBe(8453);
    expect(btc.verified).toBe(true);
    const pepe = Market.parse((await getMarket(built.app, "PEPE")).json());
    expect(pepe.address).toBeNull();
    expect(pepe.flashChainId).toBeNull();
    expect(pepe.verified).toBe(false);
  });
  it("BTC has no pool: liquidity is null without any onchain call", async () => {
    const priceSource = priced({ bitcoin: BTC_PRICE });
    built = await buildTestApp({ priceSource });
    expect(Market.parse((await getMarket(built.app, "BTC")).json()).liquidityUsd).toBeNull();
    expect(callsOf(priceSource, "onchainLiquidityUsd")).toEqual([]);
  });
});

describe("B02-07 case-insensitive symbol", () => {
  it("/market/eth returns symbol ETH", async () => {
    built = await buildTestApp({ priceSource: priced({ ethereum: ETH_PRICE }) });
    const res = await getMarket(built.app, "eth");
    expect(res.statusCode).toBe(200);
    expect(Market.parse(res.json()).symbol).toBe("ETH");
  });
});

describe("B02-08 symbol outside the allowlist", () => {
  it("GET /market/DOGE returns 400 UNSUPPORTED_TOKEN without calling the price source", async () => {
    const priceSource = priced({ ethereum: ETH_PRICE });
    built = await buildTestApp({ priceSource });
    const res = await getMarket(built.app, "DOGE");
    expect(res.statusCode).toBe(400);
    const parsed = ApiError.parse(res.json());
    expect(parsed.error.code).toBe("UNSUPPORTED_TOKEN");
    expect(parsed.error.message).toContain("DOGE");
    expect(priceSource.calls).toEqual([]);
  });
  it("a symbol longer than Token allows is rejected as BAD_REQUEST naming params.symbol", async () => {
    built = await buildTestApp({ priceSource: priced({ ethereum: ETH_PRICE }) });
    const res = await getMarket(built.app, "A".repeat(13));
    expect(res.statusCode).toBe(400);
    const parsed = ApiError.parse(res.json());
    expect(parsed.error.code).toBe("BAD_REQUEST");
    expect(parsed.error.message).toContain("params.symbol");
  });
});

describe("B02-09 price formatting never uses exponent notation", () => {
  const cases: Array<[number, string]> = [
    // small: JS switches to exponent notation below 1e-6
    [0.000012, "0.000012"],
    [5.007934381530032e-6, "0.000005007934381530032"],
    [1.5e-7, "0.00000015"],
    [1e-7, "0.0000001"],
    // ordinary and integer prices
    [1234.5, "1234.5"],
    [2451.12, "2451.12"],
    [81269, "81269"],
    [0, "0"],
    [0.5, "0.5"],
    // large: JS switches to exponent notation from 1e21
    [1e21, "1000000000000000000000"],
    [1.5e21, "1500000000000000000000"],
    [123456789.123, "123456789.123"],
  ];
  it.each(cases)("numberToDecimalString(%s) === %s", (input, expected) => {
    const out = numberToDecimalString(input);
    expect(out).toBe(expected);
    expect(() => DecimalString.parse(out)).not.toThrow();
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])("rejects %s, which has no DecimalString form", (input) => {
    expect(() => numberToDecimalString(input)).toThrow(RangeError);
  });
  it("GET /market/PEPE with a sub-1e-6 price returns a plain decimal priceUsd", async () => {
    built = await buildTestApp({ priceSource: priced({ pepe: { usd: 1.5e-7, usd24hChange: 9.5 } }) });
    const res = await getMarket(built.app, "PEPE");
    expect(res.statusCode).toBe(200);
    expect(Market.parse(res.json()).priceUsd).toBe("0.00000015");
  });
});

describe("B02-10 60 s market cache on the injected clock", () => {
  it("two requests within 60 s call the source once; a request after 60 s calls it again", async () => {
    const priceSource = priced({ ethereum: ETH_PRICE });
    built = await buildTestApp({ priceSource });
    expect((await getMarket(built.app, "ETH")).statusCode).toBe(200);
    built.clock.advance(MARKET_TTL_SECONDS - 1);
    expect((await getMarket(built.app, "ETH")).statusCode).toBe(200);
    expect(callsOf(priceSource, "markets")).toHaveLength(1);
    built.clock.advance(2);
    expect((await getMarket(built.app, "ETH")).statusCode).toBe(200);
    expect(callsOf(priceSource, "markets")).toHaveLength(2);
  });
  it("a cached response keeps the updatedAt of the fetch, not of the request", async () => {
    built = await buildTestApp({ priceSource: priced({ ethereum: ETH_PRICE }) });
    const fetchedAt = built.clock.now();
    await getMarket(built.app, "ETH");
    built.clock.advance(10);
    expect(Market.parse((await getMarket(built.app, "ETH")).json()).updatedAt).toBe(fetchedAt);
  });
});

describe("B02-11 one batched call serves every symbol", () => {
  it("/market/ETH then /market/BTC is a single markets call", async () => {
    const priceSource = priced({ ethereum: ETH_PRICE, bitcoin: BTC_PRICE });
    built = await buildTestApp({ priceSource });
    expect(Market.parse((await getMarket(built.app, "ETH")).json()).priceUsd).toBe("2451.12");
    expect(Market.parse((await getMarket(built.app, "BTC")).json()).priceUsd).toBe("81269");
    expect(callsOf(priceSource, "markets")).toHaveLength(1);
  });
  it("concurrent requests share one in-flight call (single-flight)", async () => {
    const priceSource = priced({ ethereum: ETH_PRICE, bitcoin: BTC_PRICE });
    built = await buildTestApp({ priceSource });
    const replies = await Promise.all([getMarket(built.app, "ETH"), getMarket(built.app, "BTC"), getMarket(built.app, "ETH")]);
    expect(replies.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(callsOf(priceSource, "markets")).toHaveLength(1);
  });
});

describe("B02-12 stale-while-error, bounded at 15 minutes", () => {
  it("serves a cache entry older than the TTL when the source fails, with updatedAt = the cached time", async () => {
    const priceSource = priced({ ethereum: ETH_PRICE });
    const logs = new LogCapture();
    built = await buildTestApp({ priceSource, logStream: logs });
    const fetchedAt = built.clock.now();
    await getMarket(built.app, "ETH");
    built.clock.advance(MARKET_TTL_SECONDS + 1);
    priceSource.failWith = new PriceSourceError("boom", 500);
    const res = await getMarket(built.app, "ETH");
    expect(res.statusCode).toBe(200);
    const market = Market.parse(res.json());
    expect(market.priceUsd).toBe("2451.12");
    expect(market.updatedAt).toBe(fetchedAt);
    // The source was tried first; stale data is a fallback, not a shortcut.
    expect(callsOf(priceSource, "markets")).toHaveLength(2);
    const warn = logs.entries().find((e) => e.msg === "price source failed; serving stale");
    expect(warn?.level).toBe(40);
    expect(JSON.stringify(warn)).toContain("boom");
  });
  it("answers 502 once the cached price is older than the max stale age", async () => {
    const priceSource = priced({ ethereum: ETH_PRICE });
    built = await buildTestApp({ priceSource });
    await getMarket(built.app, "ETH");
    built.clock.advance(PRICE_MAX_STALE_SECONDS - 1);
    priceSource.failWith = new PriceSourceError("boom", 500);
    expect((await getMarket(built.app, "ETH")).statusCode).toBe(200);
    built.clock.advance(2);
    await expectUpstreamFailure(await getMarket(built.app, "ETH"));
  });
});

async function expectUpstreamFailure(res: Awaited<ReturnType<typeof getMarket>>) {
  expect(res.statusCode).toBe(502);
  const parsed = ApiError.parse(res.json());
  expect(parsed.error.code).toBe("INTERNAL");
  expect(parsed.error.message).toBe("price source unavailable");
}

describe("B02-13 source failure with no cache", () => {
  it("returns 502 INTERNAL 'price source unavailable' in ApiError shape", async () => {
    const priceSource = priced({ ethereum: ETH_PRICE });
    priceSource.failWith = new PriceSourceError("boom", 500);
    built = await buildTestApp({ priceSource });
    await expectUpstreamFailure(await getMarket(built.app, "ETH"));
  });
});

describe("B02-14 source answers without the requested id", () => {
  it("an empty object yields the same 502 as B02-13", async () => {
    built = await buildTestApp({ priceSource: priced({}) });
    await expectUpstreamFailure(await getMarket(built.app, "ETH"));
  });
  it("a null 24h change (CoinGecko's stale marker) is not shown as 0: last good row when warm, else the same 502", async () => {
    const priceSource = priced({ ethereum: ETH_PRICE });
    built = await buildTestApp({ priceSource });
    const fetchedAt = built.clock.now();
    await getMarket(built.app, "ETH");
    built.clock.advance(MARKET_TTL_SECONDS + 1);
    priceSource.prices.ethereum = { usd: 2400, usd24hChange: null };
    const stale = Market.parse((await getMarket(built.app, "ETH")).json());
    expect(stale).toMatchObject({ priceUsd: "2451.12", change24hPct: -1.8, updatedAt: fetchedAt });

    built = await buildTestApp({ priceSource: priced({ ethereum: { usd: 2400, usd24hChange: null } }) });
    await expectUpstreamFailure(await getMarket(built.app, "ETH"));
  });
});

describe("B02-18 sharedMarketService: one cache per app for /market and /insight", () => {
  it("returns the same instance for the same deps object and a new one for another", () => {
    const a = { priceSource: priced({}), clock: new FakeClock() };
    const b = { priceSource: priced({}), clock: new FakeClock() };
    expect(sharedMarketService(a)).toBe(sharedMarketService(a));
    expect(sharedMarketService(a)).not.toBe(sharedMarketService(b));
  });

  it("the /market route uses the shared instance, so a service call after a request is a cache hit", async () => {
    const priceSource = priced({ ethereum: ETH_PRICE });
    built = await buildTestApp({ priceSource });
    await getMarket(built.app, "ETH");
    const market = await sharedMarketService(built.deps).get("ETH");
    expect(market.priceUsd).toBe("2451.12");
    expect(callsOf(priceSource, "markets")).toHaveLength(1);
  });
});
