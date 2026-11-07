import { ApiError, MAX_CHART_POINTS, MarketChart } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { PriceSourceError } from "../src/clients/priceSource";
import {
  CHART_FAILURE_BACKOFF_SECONDS,
  CHART_MAX_STALE_SECONDS,
  CHART_SAMPLE_POINTS,
  CHART_TTL_SECONDS,
  buildChart,
  downsample,
} from "../src/services/chart";
import { buildTestApp } from "./helpers/build";
import { FakePriceSource, series } from "./helpers/fakes/priceSource";

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

/** days=1 gives 289 five-minute points, days=7 gives 169 hourly points. */
function wave(count: number, base = 2450): number[] {
  return Array.from({ length: count }, (_, i) => base + ((i * 7) % 50) - 25 + i * 0.01);
}

function chartSource(): FakePriceSource {
  const source = new FakePriceSource();
  source.charts["ethereum:1"] = series(wave(289), 1_761_513_600, 300);
  source.charts["ethereum:7"] = series(wave(169), 1_760_996_400, 3600);
  return source;
}

async function getChart(app: Built["app"], symbol = "ETH", query = "") {
  return app.inject({ method: "GET", url: `/api/v1/market/${symbol}/chart${query}` });
}

const callsOf = (source: FakePriceSource) => source.calls.filter((c) => c.method === "marketChart");

describe("GET /market/:symbol/chart", () => {
  it("defaults to 24h: 289 source points become at most 96, first and newest kept, open/low/high from the full series", async () => {
    const priceSource = chartSource();
    built = await buildTestApp({ priceSource });
    const res = await getChart(built.app);
    expect(res.statusCode).toBe(200);
    const chart = MarketChart.parse(res.json());
    const full = priceSource.charts["ethereum:1"] ?? [];
    expect(chart).toMatchObject({ symbol: "ETH", range: "24h", updatedAt: built.clock.now() });
    expect(chart.points).toHaveLength(CHART_SAMPLE_POINTS["24h"]);
    expect(chart.points[0]?.[0]).toBe(full[0]?.[0]);
    expect(chart.points.at(-1)?.[0]).toBe(full.at(-1)?.[0]);
    const prices = full.map(([, p]) => p);
    expect(Number(chart.lowUsd)).toBeCloseTo(Math.min(...prices), 3);
    expect(Number(chart.highUsd)).toBeCloseTo(Math.max(...prices), 3);
    expect(Number(chart.openUsd)).toBeCloseTo(prices[0] ?? 0, 3);
    expect(callsOf(priceSource)).toEqual([{ method: "marketChart", id: "ethereum", days: 1 }]);
  });

  it("range=7d asks for 7 days and returns about 85 points", async () => {
    const priceSource = chartSource();
    built = await buildTestApp({ priceSource });
    const chart = MarketChart.parse((await getChart(built.app, "eth", "?range=7d")).json());
    expect(chart.range).toBe("7d");
    expect(chart.points).toHaveLength(CHART_SAMPLE_POINTS["7d"]);
    expect(chart.points.length).toBeLessThanOrEqual(MAX_CHART_POINTS);
    expect(callsOf(priceSource)).toEqual([{ method: "marketChart", id: "ethereum", days: 7 }]);
  });

  it("a bad range is a 400 BAD_REQUEST naming query.range, without calling the source", async () => {
    const priceSource = chartSource();
    built = await buildTestApp({ priceSource });
    const res = await getChart(built.app, "ETH", "?range=30d");
    expect(res.statusCode).toBe(400);
    const error = ApiError.parse(res.json()).error;
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toContain("query.range");
    expect(priceSource.calls).toEqual([]);
  });

  it("a symbol outside the allowlist is 400 UNSUPPORTED_TOKEN", async () => {
    built = await buildTestApp({ priceSource: chartSource() });
    const res = await getChart(built.app, "DOGE");
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("UNSUPPORTED_TOKEN");
  });

  it("an upstream failure with nothing cached is a 502 INTERNAL", async () => {
    const priceSource = new FakePriceSource();
    priceSource.failChartWith = new PriceSourceError("boom", 500);
    built = await buildTestApp({ priceSource });
    const res = await getChart(built.app);
    expect(res.statusCode).toBe(502);
    expect(ApiError.parse(res.json()).error.code).toBe("INTERNAL");
  });

  it("serves the stale chart when the source fails, but only up to the max stale age", async () => {
    const priceSource = chartSource();
    built = await buildTestApp({ priceSource });
    const first = MarketChart.parse((await getChart(built.app)).json());
    built.clock.advance(CHART_TTL_SECONDS["24h"] + 1);
    priceSource.failChartWith = new PriceSourceError("boom", 500);
    const stale = await getChart(built.app);
    expect(stale.statusCode).toBe(200);
    expect(MarketChart.parse(stale.json())).toEqual(first);
    // Past the 1 h limit the old line is no longer an honest picture.
    built.clock.advance(CHART_MAX_STALE_SECONDS);
    expect((await getChart(built.app)).statusCode).toBe(502);
  });

  it("caches per range: 300 s for 24h and 900 s for 7d, one source call within the window", async () => {
    const priceSource = chartSource();
    built = await buildTestApp({ priceSource });
    await getChart(built.app);
    await getChart(built.app, "ETH", "?range=7d");
    built.clock.advance(CHART_TTL_SECONDS["24h"] - 1);
    await getChart(built.app);
    expect(callsOf(priceSource)).toHaveLength(2);
    built.clock.advance(2);
    await getChart(built.app);
    await getChart(built.app, "ETH", "?range=7d");
    expect(callsOf(priceSource).map((c) => c.days)).toEqual([1, 7, 1]);
    built.clock.advance(CHART_TTL_SECONDS["7d"]);
    await getChart(built.app, "ETH", "?range=7d");
    expect(callsOf(priceSource)).toHaveLength(4);
  });

  it("concurrent requests share one source call (single-flight)", async () => {
    const priceSource = chartSource();
    built = await buildTestApp({ priceSource });
    const replies = await Promise.all([getChart(built.app), getChart(built.app), getChart(built.app)]);
    expect(replies.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(callsOf(priceSource)).toHaveLength(1);
  });

  it("after a failure the source is left alone for the backoff window", async () => {
    const priceSource = chartSource();
    built = await buildTestApp({ priceSource });
    await getChart(built.app);
    built.clock.advance(CHART_TTL_SECONDS["24h"] + 1);
    priceSource.failChartWith = new PriceSourceError("boom", 500);
    await getChart(built.app);
    await getChart(built.app);
    expect(callsOf(priceSource)).toHaveLength(2);
    priceSource.failChartWith = null;
    built.clock.advance(CHART_FAILURE_BACKOFF_SECONDS + 1);
    await getChart(built.app);
    expect(callsOf(priceSource)).toHaveLength(3);
  });

  it("a series with fewer than two usable points is an upstream failure, not an invalid response", async () => {
    const priceSource = new FakePriceSource();
    priceSource.charts["ethereum:1"] = series([2450]);
    built = await buildTestApp({ priceSource });
    expect((await getChart(built.app)).statusCode).toBe(502);
  });
});

describe("buildChart and downsample", () => {
  it("downsample keeps the first and the newest item and returns short lists unchanged", () => {
    const items = Array.from({ length: 289 }, (_, i) => i);
    const picked = downsample(items, 96);
    expect(picked).toHaveLength(96);
    expect(picked[0]).toBe(0);
    expect(picked.at(-1)).toBe(288);
    expect(new Set(picked).size).toBe(96);
    expect(downsample([1, 2, 3], 96)).toEqual([1, 2, 3]);
  });

  it("rounds to 7 significant digits in plain decimal form, even for PEPE-scale prices", () => {
    const chart = buildChart("PEPE", "24h", series([5.007934381530032e-6, 0.0000123456789, 1.5e-7]), 1);
    expect(chart.points.map(([, p]) => p)).toEqual(["0.000005007934", "0.00001234568", "0.00000015"]);
    expect(chart.openUsd).toBe("0.000005007934");
    expect(chart.lowUsd).toBe("0.00000015");
    expect(chart.highUsd).toBe("0.00001234568");
    expect(() => MarketChart.parse(chart)).not.toThrow();
  });

  it("computes low and high from the full series even when thinning drops them", () => {
    const prices = Array.from({ length: 289 }, () => 100);
    prices[1] = 50;
    prices[2] = 150;
    const chart = buildChart("ETH", "24h", series(prices), 1);
    expect(chart.lowUsd).toBe("50");
    expect(chart.highUsd).toBe("150");
    expect(chart.points.some(([, p]) => p === "50")).toBe(false);
  });

  it("skips points that cannot be prices (negative or not finite) instead of failing the chart", () => {
    const chart = buildChart("ETH", "24h", series([100, -5, Number.NaN, 110]), 1);
    expect(chart.points.map(([, p]) => p)).toEqual(["100", "110"]);
  });
});
