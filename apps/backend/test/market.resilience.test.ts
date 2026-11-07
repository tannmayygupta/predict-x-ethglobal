import { afterEach, describe, expect, it, vi } from "vitest";
import { PriceSourceError, type RawChartPoint } from "../src/clients/priceSource";
import { EXTRAS_BUDGET_MS, MARKET_FAILURE_BACKOFF_SECONDS, MarketService } from "../src/services/market";
import { FakeClock } from "./helpers/fakes/clock";
import { FakePriceSource, series, type SimplePriceEntry } from "./helpers/fakes/priceSource";

afterEach(() => {
  vi.useRealTimers();
});

const ETH_ONCHAIN = "base:0x4200000000000000000000000000000000000006";
const ETH_PRICE: SimplePriceEntry = { usd: 2451.12, usd24hChange: -1.8, high24hUsd: 2503.4, low24hUsd: 2431.07 };

function setup(source: FakePriceSource) {
  const clock = new FakeClock();
  return { clock, service: new MarketService({ priceSource: source, clock }) };
}

function priced(entry: SimplePriceEntry): FakePriceSource {
  const source = new FakePriceSource();
  source.prices.ethereum = entry;
  return source;
}

const marketCalls = (s: FakePriceSource) => s.calls.filter((c) => c.method === "markets").length;

describe("batch failure window", () => {
  it("after a non-429 failure the stale row is served at once for 30 s without asking the source again", async () => {
    const source = priced(ETH_PRICE);
    const { clock, service } = setup(source);
    await service.get("ETH");
    clock.advance(61);
    source.failWith = new PriceSourceError("boom", 500);
    expect((await service.get("ETH")).priceUsd).toBe("2451.12");
    expect(marketCalls(source)).toBe(2);
    clock.advance(MARKET_FAILURE_BACKOFF_SECONDS - 1);
    expect((await service.get("ETH")).priceUsd).toBe("2451.12");
    expect(marketCalls(source)).toBe(2);
    clock.advance(2);
    source.failWith = null;
    expect((await service.get("ETH")).priceUsd).toBe("2451.12");
    expect(marketCalls(source)).toBe(3);
  });

  it("with nothing cached the failure also answers without a second call inside the window", async () => {
    const source = priced(ETH_PRICE);
    source.failWith = new PriceSourceError("boom", 500);
    const { clock, service } = setup(source);
    await expect(service.get("ETH")).rejects.toMatchObject({ code: "INTERNAL" });
    await expect(service.get("ETH")).rejects.toMatchObject({ code: "INTERNAL" });
    expect(marketCalls(source)).toBe(1);
    clock.advance(MARKET_FAILURE_BACKOFF_SECONDS + 1);
    source.failWith = null;
    expect((await service.get("ETH")).priceUsd).toBe("2451.12");
  });

  it("a 429 does not open the window (the client already holds its own Retry-After)", async () => {
    const source = priced(ETH_PRICE);
    const { clock, service } = setup(source);
    await service.get("ETH");
    clock.advance(61);
    source.failWith = new PriceSourceError("limited", 429);
    await service.get("ETH");
    await service.get("ETH");
    expect(marketCalls(source)).toBe(3);
  });

  it("the stale row is still dropped past the max stale age inside the window", async () => {
    const source = priced(ETH_PRICE);
    const { clock, service } = setup(source);
    await service.get("ETH");
    clock.advance(61);
    source.failWith = new PriceSourceError("boom", 500);
    await service.get("ETH");
    clock.advance(900);
    await expect(service.get("ETH")).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

describe("high and low always contain the price", () => {
  it("a price above the high lifts the high; one below the low drops the low", async () => {
    const above = setup(priced({ ...ETH_PRICE, usd: 2600, high24hUsd: 2503.4 }));
    expect(await above.service.get("ETH")).toMatchObject({ high24hUsd: "2600", low24hUsd: "2431.07" });
    const below = setup(priced({ ...ETH_PRICE, usd: 2400, low24hUsd: 2431.07 }));
    expect(await below.service.get("ETH")).toMatchObject({ high24hUsd: "2503.4", low24hUsd: "2400" });
  });

  it("also applies to the chart range, compared as decimals (9.5 is below 10)", async () => {
    const source = priced({ usd: 10.5, usd24hChange: 1 });
    source.charts["ethereum:1"] = series([9.5, 10, 9.8]);
    const { service } = setup(source);
    expect(await service.get("ETH")).toMatchObject({ high24hUsd: "10.5", low24hUsd: "9.5" });
  });

  it("a price inside the range changes nothing, and a missing bound stays null", async () => {
    const inside = setup(priced(ETH_PRICE));
    expect(await inside.service.get("ETH")).toMatchObject({ high24hUsd: "2503.4", low24hUsd: "2431.07" });
    const none = setup(priced({ usd: 5, usd24hChange: 1 }));
    expect(await none.service.get("ETH")).toMatchObject({ high24hUsd: null, low24hUsd: null });
  });
});

/** Chart and pool depth wait on gates the test opens, like a slow CoinGecko. */
class SlowExtrasSource extends FakePriceSource {
  releaseChart: (() => void) | undefined;
  releaseLiquidity: (() => void) | undefined;

  override async marketChart(id: string, days: number): Promise<RawChartPoint[]> {
    await new Promise<void>((resolve) => (this.releaseChart = resolve));
    return super.marketChart(id, days);
  }

  override async onchainLiquidityUsd(network: string, address: string): Promise<string | null> {
    await new Promise<void>((resolve) => (this.releaseLiquidity = resolve));
    return super.onchainLiquidityUsd(network, address);
  }
}

describe("cold slow extras do not block /market", () => {
  function slow() {
    const source = new SlowExtrasSource();
    source.prices.ethereum = ETH_PRICE;
    source.charts["ethereum:1"] = series([2450, 2500.5, 2430.25]);
    source.liquidity[ETH_ONCHAIN] = "138690000.12";
    return source;
  }

  it("answers after the budget with null liquidity and the batch high/low, then the next call has the finished extras", async () => {
    vi.useFakeTimers();
    const source = slow();
    const { service } = setup(source);
    let result: Awaited<ReturnType<typeof service.get>> | undefined;
    const pending = service.get("ETH").then((m) => (result = m));
    await vi.advanceTimersByTimeAsync(EXTRAS_BUDGET_MS - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(result).toMatchObject({ liquidityUsd: null, high24hUsd: "2503.4", low24hUsd: "2431.07" });

    source.releaseChart?.();
    source.releaseLiquidity?.();
    await vi.advanceTimersByTimeAsync(0);
    const next = await service.get("ETH");
    expect(next).toMatchObject({ liquidityUsd: "138690000.12", high24hUsd: "2500.5", low24hUsd: "2430.25" });
    expect(source.calls.filter((c) => c.method === "marketChart")).toHaveLength(1);
    expect(source.calls.filter((c) => c.method === "onchainLiquidityUsd")).toHaveLength(1);
  });

  it("a late failure in the background is swallowed and the next call still answers", async () => {
    vi.useFakeTimers();
    const source = slow();
    source.failChartWith = new PriceSourceError("late", 500);
    const { service } = setup(source);
    const pending = service.get("ETH");
    await vi.advanceTimersByTimeAsync(EXTRAS_BUDGET_MS);
    expect((await pending).high24hUsd).toBe("2503.4");
    source.releaseChart?.();
    source.releaseLiquidity?.();
    await vi.advanceTimersByTimeAsync(0);
    expect((await service.get("ETH")).priceUsd).toBe("2451.12");
  });

  it("fast extras are not delayed: no timer is left running", async () => {
    vi.useFakeTimers();
    const source = priced(ETH_PRICE);
    source.charts["ethereum:1"] = series([2450, 2500.5]);
    const { service } = setup(source);
    await service.get("ETH");
    expect(vi.getTimerCount()).toBe(0);
  });
});
