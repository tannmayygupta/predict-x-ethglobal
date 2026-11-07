import { Market } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { PriceSourceError } from "../src/clients/priceSource";
import {
  LIQUIDITY_FAILURE_BACKOFF_SECONDS,
  LIQUIDITY_TTL_SECONDS,
  MarketService,
} from "../src/services/market";
import { signedChangeUsd } from "../src/util/decimal";
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

describe("change24hUsd is price * pct / (100 + pct) on bigint, signed, two decimals (two significant digits below a cent)", () => {
  it.each([
    ["2240.21", 0.47, "10.48"], // the screenshot check
    ["2451.12", -1.8, "-44.93"],
    ["81269", 0.5, "404.32"],
    ["100", 0, "0.00"],
    ["0.00000015", 9.5, "0.000000013"], // PEPE-scale price from exponent form: two significant digits, signed
    ["0.00000015", -9.5, "-0.000000016"],
    ["0.004983", 1, "0.000049"],
    ["0.0083", 0.0001, "0.0000000083"],
    ["0.000004983", 0, "0.00"],
    ["1000000", -0.0001, "-1.00"],
  ])("signedChangeUsd(%s, %s) === %s", (price, pct, expected) => {
    expect(signedChangeUsd(price, pct)).toBe(expected);
  });
  it("returns null when no move can be derived (-100%, NaN, a price that is not a decimal)", () => {
    expect(signedChangeUsd("10", -100)).toBeNull();
    expect(signedChangeUsd("10", Number.NaN)).toBeNull();
    expect(signedChangeUsd("1e-7", 1)).toBeNull();
  });
  it("GET /market/PEPE with a PEPE-scale price in exponent form returns a two-significant-digit change24hUsd", async () => {
    built = await buildTestApp({ priceSource: priced({ pepe: { usd: 1.5e-7, usd24hChange: -3 } }) });
    expect(Market.parse((await getMarket(built.app, "PEPE")).json()).change24hUsd).toBe("-0.0000000046");
  });
  it("GET /market/ETH with a negative 24h change returns a negative change24hUsd", async () => {
    built = await buildTestApp({ priceSource: priced({ ethereum: ETH_PRICE }) });
    expect(Market.parse((await getMarket(built.app, "ETH")).json()).change24hUsd).toBe("-44.93");
  });
});

describe("liquidity, high and low never fail /market (allSettled)", () => {
  it("a failing liquidity lookup and a failing chart still return 200 with null liquidity and CoinGecko's own high/low", async () => {
    const priceSource = priced({ ethereum: { ...ETH_PRICE, high24hUsd: 2503.4, low24hUsd: 2431.07 } });
    priceSource.failLiquidityWith = new PriceSourceError("onchain 500", 500);
    priceSource.failChartWith = new PriceSourceError("chart 500", 500);
    const logs = new LogCapture();
    built = await buildTestApp({ priceSource, logStream: logs });
    const market = Market.parse((await getMarket(built.app, "ETH")).json());
    expect(market).toMatchObject({ liquidityUsd: null, high24hUsd: "2503.4", low24hUsd: "2431.07" });
    expect(logs.entries().some((e) => e.msg === "liquidity lookup failed")).toBe(true);
  });
  it("high and low come from the full 24h chart series when it is available", async () => {
    const priceSource = priced({ ethereum: { ...ETH_PRICE, high24hUsd: 9999, low24hUsd: 1 } });
    priceSource.charts["ethereum:1"] = series([2450, 2500.5, 2430.25, 2451.12]);
    built = await buildTestApp({ priceSource });
    expect(Market.parse((await getMarket(built.app, "ETH")).json())).toMatchObject({ high24hUsd: "2500.5", low24hUsd: "2430.25" });
  });
  it("liquidity is cached for its TTL; after a failure the endpoint is left alone for the backoff and the last value kept", async () => {
    const priceSource = priced({ ethereum: ETH_PRICE });
    priceSource.liquidity[ETH_ONCHAIN] = "100.5";
    built = await buildTestApp({ priceSource });
    await getMarket(built.app, "ETH");
    built.clock.advance(LIQUIDITY_TTL_SECONDS - 1);
    await getMarket(built.app, "ETH");
    expect(callsOf(priceSource, "onchainLiquidityUsd")).toHaveLength(1);
    built.clock.advance(2);
    priceSource.failLiquidityWith = new PriceSourceError("onchain 500", 500);
    expect(Market.parse((await getMarket(built.app, "ETH")).json()).liquidityUsd).toBe("100.5");
    expect(Market.parse((await getMarket(built.app, "ETH")).json()).liquidityUsd).toBe("100.5");
    expect(callsOf(priceSource, "onchainLiquidityUsd")).toHaveLength(2);
    built.clock.advance(LIQUIDITY_FAILURE_BACKOFF_SECONDS + 1);
    await getMarket(built.app, "ETH");
    expect(callsOf(priceSource, "onchainLiquidityUsd")).toHaveLength(3);
  });
  it("missing or negative CoinGecko figures become null, never a guess", async () => {
    built = await buildTestApp({ priceSource: priced({ ethereum: { ...ETH_PRICE, marketCapUsd: -1, volume24hUsd: undefined } }) });
    expect(Market.parse((await getMarket(built.app, "ETH")).json())).toMatchObject({ marketCapUsd: null, volume24hUsd: null });
  });
});

describe("B02-18 MarketService.change7dPct(symbol) for the insight prompt (D-B7)", () => {
  function service(priceSource: FakePriceSource, log?: LogCapture) {
    const clock = new FakeClock();
    const logger = log ? { warn: (obj: object, msg: string) => log.write(`${JSON.stringify({ ...obj, msg })}\n`) } : undefined;
    return { clock, service: new MarketService({ priceSource, clock }, logger) };
  }

  it("reads the 7d figure from the same batched call as the price, case-insensitively, with no extra request", async () => {
    const priceSource = priced({ ethereum: ETH_PRICE });
    priceSource.change7d.ethereum = -5.5444;
    const { service: market } = service(priceSource);
    expect(await market.change7dPct("eth")).toBe(-5.5444);
    await market.get("ETH");
    expect(callsOf(priceSource, "markets")).toHaveLength(1);
  });

  it("a null 7d figure stays null", async () => {
    const { service: market } = service(priced({ pepe: { usd: 0.000012, usd24hChange: 1 } }));
    expect(await market.change7dPct("PEPE")).toBeNull();
  });

  it("unknown symbol throws UNSUPPORTED_TOKEN before any source call", async () => {
    const priceSource = priced({});
    const { service: market } = service(priceSource);
    await expect(market.change7dPct("DOGE")).rejects.toMatchObject({ code: "UNSUPPORTED_TOKEN" });
    expect(priceSource.calls).toEqual([]);
  });

  it("source failure with nothing cached yields null and a warning (the prompt says 'unknown')", async () => {
    const priceSource = priced({});
    priceSource.failWith = new PriceSourceError("boom", 500);
    const logs = new LogCapture();
    const { service: market } = service(priceSource, logs);
    expect(await market.change7dPct("ETH")).toBeNull();
    expect(logs.entries().filter((e) => e.msg === "7d change unavailable")).toHaveLength(1);
  });
});

