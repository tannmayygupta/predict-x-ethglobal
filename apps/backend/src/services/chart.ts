import type { ChartPoint, ChartRange, MarketChart } from "@predictx/shared";
import { PriceSourceError, type PriceSource, type RawChartPoint } from "../clients/priceSource";
import { upstreamError } from "../errors";
import { SingleFlight } from "../util/singleFlight";
import { TtlCache } from "../util/cache";
import type { Clock } from "../util/clock";
import { toSignificantDecimalString } from "../util/decimal";
import { requireToken } from "./tokens";

/** The five-minute 24h series moves little within five minutes; the hourly 7d series within fifteen. */
export const CHART_TTL_SECONDS: Record<ChartRange, number> = { "24h": 300, "7d": 900 };
/** A chart older than this is no longer a fair picture of the market, so the route answers 502 instead. */
export const CHART_MAX_STALE_SECONDS = 3600;
/** After a failure the source is left alone this long, so a CoinGecko outage costs one slow call, not one per hover. */
export const CHART_FAILURE_BACKOFF_SECONDS = 30;
const CHART_DAYS: Record<ChartRange, number> = { "24h": 1, "7d": 7 };
/** What the UI draws: a 480 px card gains nothing from 289 points, and the payload stays small. */
export const CHART_SAMPLE_POINTS: Record<ChartRange, number> = { "24h": 96, "7d": 85 };
const CHART_UNAVAILABLE = "chart data unavailable";
const MIN_POINTS = 2;

export interface ChartServiceDeps {
  priceSource: PriceSource;
  clock: Clock;
}

export interface ChartLog {
  warn(obj: object, msg: string): void;
}

/** Evenly spaced picks that always keep the first and the newest item. */
export function downsample<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const last = items.length - 1;
  const picked: T[] = [];
  for (let i = 0; i < max; i += 1) {
    const item = items[Math.round((i * last) / (max - 1))];
    if (item !== undefined) picked.push(item);
  }
  return picked;
}

/**
 * Open, low and high come from the FULL series so thinning the line never moves them; the points are then
 * cut to the range's sample size and rounded to 7 significant digits.
 */
export function buildChart(symbol: string, range: ChartRange, raw: readonly RawChartPoint[], updatedAt: number): MarketChart {
  const series = raw.filter(([time, price]) => Number.isFinite(price) && price >= 0 && time >= 0);
  const first = series[0];
  if (!first || series.length < MIN_POINTS) throw new PriceSourceError("coingecko: chart has too few points");
  let low = first[1];
  let high = first[1];
  for (const [, price] of series) {
    if (price < low) low = price;
    if (price > high) high = price;
  }
  const points = downsample(series, CHART_SAMPLE_POINTS[range]).map(
    ([time, price]): ChartPoint => [time, toSignificantDecimalString(price)],
  );
  return {
    symbol,
    range,
    points,
    openUsd: toSignificantDecimalString(first[1]),
    lowUsd: toSignificantDecimalString(low),
    highUsd: toSignificantDecimalString(high),
    updatedAt,
  };
}

export class ChartService {
  private readonly caches: Record<ChartRange, TtlCache<MarketChart>>;
  private readonly flight = new SingleFlight<MarketChart>();
  private readonly failures: TtlCache<true>;

  constructor(
    private readonly deps: ChartServiceDeps,
    private readonly log?: ChartLog,
  ) {
    this.caches = {
      "24h": new TtlCache(deps.clock, CHART_TTL_SECONDS["24h"]),
      "7d": new TtlCache(deps.clock, CHART_TTL_SECONDS["7d"]),
    };
    this.failures = new TtlCache(deps.clock, CHART_FAILURE_BACKOFF_SECONDS);
  }

  async get(symbol: string, range: ChartRange): Promise<MarketChart> {
    const token = requireToken(symbol);
    const cache = this.caches[range];
    const fresh = cache.getFresh(token.symbol);
    if (fresh) return fresh;
    const failureKey = `${token.symbol}:${range}`;
    if (this.failures.isFresh(failureKey)) return this.serveStale(token.symbol, range);
    return this.flight.run(failureKey, async () => {
      try {
        const raw = await this.deps.priceSource.marketChart(token.coingeckoId, CHART_DAYS[range]);
        const chart = buildChart(token.symbol, range, raw, this.deps.clock.now());
        cache.set(token.symbol, chart);
        return chart;
      } catch (err) {
        if (!(err instanceof PriceSourceError)) throw err;
        this.failures.set(failureKey, true);
        this.log?.warn({ symbol: token.symbol, range, err: err.message }, "chart source failed");
        return this.serveStale(token.symbol, range);
      }
    });
  }

  /** The cached chart if it is still within the stale limit; never fetches. For the insight prompt. */
  peek(symbol: string, range: ChartRange): MarketChart | undefined {
    const entry = this.caches[range].get(requireToken(symbol).symbol);
    if (!entry) return undefined;
    return this.deps.clock.now() - entry.storedAt <= CHART_MAX_STALE_SECONDS ? entry.value : undefined;
  }

  private serveStale(symbol: string, range: ChartRange): MarketChart {
    const stale = this.peek(symbol, range);
    if (!stale) throw upstreamError(CHART_UNAVAILABLE);
    return stale;
  }
}

const instances = new WeakMap<ChartServiceDeps, ChartService>();

/** One instance per deps object so /market (high and low) and /market/:symbol/chart share the cache. */
export function sharedChartService(deps: ChartServiceDeps, log?: ChartLog): ChartService {
  const existing = instances.get(deps);
  if (existing) return existing;
  const created = new ChartService(deps, log);
  instances.set(deps, created);
  return created;
}
