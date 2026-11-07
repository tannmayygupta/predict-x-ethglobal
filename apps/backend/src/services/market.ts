import type { ChartRange, Market, MarketChart, Token } from "@predictx/shared";
import { PriceSourceError, type CoinMarket, type PriceSource } from "../clients/priceSource";
import { AppError, upstreamError } from "../errors";
import { TtlCache } from "../util/cache";
import type { Clock } from "../util/clock";
import { compareDecimal, numberToDecimalString, signedChangeUsd } from "../util/decimal";
import { SingleFlight } from "../util/singleFlight";
import { sharedChartService, type ChartService } from "./chart";
import { requireToken, tokens } from "./tokens";

/** One batched /coins/markets call serves every symbol; 60 s keeps a busy feed far below the demo rate limit. */
export const MARKET_TTL_SECONDS = 60;
/** Past this age a cached price is no longer "delayed", it is wrong, so the route answers 502 (D-B5). */
export const PRICE_MAX_STALE_SECONDS = 900;
/** Pool depth moves slowly and costs a request on a 30/min plan. */
export const LIQUIDITY_TTL_SECONDS = 600;
/** After a failed lookup the endpoint is left alone this long. */
export const LIQUIDITY_FAILURE_BACKOFF_SECONDS = 60;
/** After a non-429 failure of the batched call the source is left alone this long, so an outage costs one slow call, not one per hover. */
export const MARKET_FAILURE_BACKOFF_SECONDS = 30;
/** Chart and pool depth are extras: a cold one slower than this is left to finish in the background instead of delaying the card. */
export const EXTRAS_BUDGET_MS = 1_500;
const HTTP_TOO_MANY = 429;
const PRICE_SOURCE_UNAVAILABLE ="price source unavailable";
const BATCH_KEY = "all";

export interface MarketServiceDeps {
  priceSource: PriceSource;
  clock: Clock;
}

/** The subset of a pino logger the service needs; keeps services free of Fastify types. */
export interface MarketLog {
  warn(obj: object, msg: string): void;
}

interface Stored<T> {
  value: T;
  storedAt: number;
}

type CoinSnapshot = Stored<CoinMarket>;
type Batch = Stored<Record<string, CoinMarket>>;

/** CoinGecko numbers that are money; anything missing, negative or not finite is simply not shown. */
function usdOrNull(value: number | null): string | null {
  return value === null || !Number.isFinite(value) || value < 0 ? null : numberToDecimalString(value);
}

/** The bound, moved out to `price` when the price lies beyond it (direction 1 = high bound, -1 = low bound). */
function widen(bound: string | null, price: string, direction: 1 | -1): string | null {
  if (bound === null) return null;
  return compareDecimal(price, bound) * direction > 0 ? price : bound;
}

export class MarketService {
  private readonly batch: TtlCache<Record<string, CoinMarket>>;
  private readonly batchFlight = new SingleFlight<Batch>();
  private readonly batchFailures: TtlCache<true>;
  /** Last good row per symbol: survives a batch that omits or nulls one coin. */
  private readonly lastGood = new Map<string, CoinSnapshot>();
  private readonly liquidity: TtlCache<string | null>;
  private readonly liquidityFailures: TtlCache<true>;
  private readonly liquidityFlight = new SingleFlight<string | null>();
  private readonly chart: ChartService;

  constructor(
    private readonly deps: MarketServiceDeps,
    private readonly log?: MarketLog,
  ) {
    this.batch = new TtlCache(deps.clock, MARKET_TTL_SECONDS);
    this.batchFailures = new TtlCache(deps.clock, MARKET_FAILURE_BACKOFF_SECONDS);
    this.liquidity = new TtlCache(deps.clock, LIQUIDITY_TTL_SECONDS);
    this.liquidityFailures = new TtlCache(deps.clock, LIQUIDITY_FAILURE_BACKOFF_SECONDS);
    this.chart = sharedChartService(deps, log);
  }

  async get(symbol: string): Promise<Market> {
    const token = requireToken(symbol);
    const snapshot = await this.coin(token);
    // Optional extras never fail /market: a rejected or slow one becomes null (the batch's own high/low fill in).
    const [liquidity, chart] = await Promise.all([
      this.optional(token, "liquidity", this.liquidityUsd(token)),
      this.optional(token, "24h chart", this.chart.get(token.symbol, "24h")),
    ]);
    return this.toMarket(token, snapshot, liquidity, chart);
  }

  /** D-B7: 7d change for the insight prompt; a failure yields null so the insight route keeps its 200-with-fallback promise (B05-10). */
  async change7dPct(symbol: string): Promise<number | null> {
    const token = requireToken(symbol);
    try {
      return (await this.coin(token)).value.change7dPct;
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      this.log?.warn({ symbol: token.symbol, err: err.message }, "7d change unavailable");
      return null;
    }
  }

  /** Cached chart for the insight prompt; never triggers a CoinGecko call. */
  cachedChart(symbol: string, range: ChartRange): MarketChart | undefined {
    return this.chart.peek(symbol, range);
  }

  /**
   * Waits for an extra at most EXTRAS_BUDGET_MS. The work itself is never cancelled: the shared single-flight
   * and cache let it finish in the background, so the next hover finds it warm and hovering many tags does not
   * stack up 3 s waits.
   */
  private async optional<T>(token: Token, what: string, work: Promise<T>): Promise<T | null> {
    const settled = work.then(
      (value) => ({ ok: true as const, value }),
      (reason: unknown) => ({ ok: false as const, reason }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), EXTRAS_BUDGET_MS);
    });
    const first = await Promise.race([settled, budget]);
    clearTimeout(timer);
    if (first === null) {
      this.log?.warn({ symbol: token.symbol }, `${what} still loading; answering without it`);
      void settled.then((late) => {
        if (!late.ok) this.warnOptional(token, what, late.reason);
      });
      return null;
    }
    if (first.ok) return first.value;
    this.warnOptional(token, what, first.reason);
    return null;
  }

  private warnOptional(token: Token, what: string, reason: unknown): void {
    const err = reason instanceof Error ? reason.message : String(reason);
    this.log?.warn({ symbol: token.symbol, err }, `${what} unavailable`);
  }

  private async coin(token: Token): Promise<CoinSnapshot> {
    const batch = await this.loadBatch();
    const entry = batch.value[token.coingeckoId];
    // CoinGecko drops unknown ids silently and nulls the 24h change when its own data is stale;
    // neither is a price worth showing, so both fall back to the last good row or fail like an outage.
    if (entry && entry.change24hPct !== null) {
      const snapshot = { value: entry, storedAt: batch.storedAt };
      this.lastGood.set(token.symbol, snapshot);
      return snapshot;
    }
    const previous = this.lastGood.get(token.symbol);
    if (!previous || this.deps.clock.now() - previous.storedAt > PRICE_MAX_STALE_SECONDS) {
      throw upstreamError(PRICE_SOURCE_UNAVAILABLE);
    }
    this.log?.warn({ symbol: token.symbol }, "price row missing or stale; serving last good");
    return previous;
  }

  private async loadBatch(): Promise<Batch> {
    const fresh = this.batch.get(BATCH_KEY);
    if (fresh && this.batch.isFresh(BATCH_KEY)) return fresh;
    // Inside the failure window the source is not asked again; the stale row (if any) answers at once.
    if (this.batchFailures.isFresh(BATCH_KEY)) return this.staleBatch();
    return this.batchFlight.run(BATCH_KEY, async () => {
      try {
        const ids = [...new Set(tokens.map((t) => t.coingeckoId))];
        this.batch.set(BATCH_KEY, await this.deps.priceSource.markets(ids));
        const stored = this.batch.get(BATCH_KEY);
        if (!stored) throw upstreamError(PRICE_SOURCE_UNAVAILABLE);
        return stored;
      } catch (err) {
        if (!(err instanceof PriceSourceError)) throw err;
        // A 429 already blocks the client for its own Retry-After; only other failures start the window.
        if (err.status !== HTTP_TOO_MANY) this.batchFailures.set(BATCH_KEY, true);
        this.log?.warn({ err: err.message }, "price source failed; serving stale");
        return this.staleBatch();
      }
    });
  }

  /** D-B5: a delayed price beats no price for a hover card, up to PRICE_MAX_STALE_SECONDS. */
  private staleBatch(): Batch {
    const stale = this.batch.get(BATCH_KEY);
    if (!stale || this.deps.clock.now() - stale.storedAt > PRICE_MAX_STALE_SECONDS) {
      throw upstreamError(PRICE_SOURCE_UNAVAILABLE);
    }
    return stale;
  }

  private async liquidityUsd(token: Token): Promise<string | null> {
    if (!token.onchain) return null;
    const cached = this.liquidity.get(token.symbol);
    if (cached && this.liquidity.isFresh(token.symbol)) return cached.value;
    // Inside the backoff after a failure the last known depth (or null) is all that is served.
    if (this.liquidityFailures.isFresh(token.symbol)) return cached?.value ?? null;
    const { network, address } = token.onchain;
    return this.liquidityFlight.run(token.symbol, async () => {
      try {
        const value = await this.deps.priceSource.onchainLiquidityUsd(network, address);
        this.liquidity.set(token.symbol, value);
        return value;
      } catch (err) {
        if (!(err instanceof PriceSourceError)) throw err;
        this.log?.warn({ symbol: token.symbol, err: err.message }, "liquidity lookup failed");
        // Keep the last known depth when there is one; mark the failure so the next hovers do not retry at once.
        this.liquidityFailures.set(token.symbol, true);
        return this.liquidity.get(token.symbol)?.value ?? null;
      }
    });
  }

  private toMarket(token: Token, snapshot: CoinSnapshot, liquidityUsd: string | null, chart: MarketChart | null): Market {
    const coin = snapshot.value;
    const priceUsd = numberToDecimalString(coin.usd);
    // coin() guarantees a non-null 24h change; the fallback only satisfies the type.
    const change24hPct = coin.change24hPct ?? 0;
    return {
      symbol: token.symbol,
      name: token.name,
      address: token.address,
      flashChainId: token.flashChainId,
      priceUsd,
      change24hPct,
      updatedAt: snapshot.storedAt,
      change24hUsd: signedChangeUsd(priceUsd, change24hPct),
      marketCapUsd: usdOrNull(coin.marketCapUsd),
      volume24hUsd: usdOrNull(coin.volume24hUsd),
      // The chart series is exact for tiny prices; CoinGecko's own high/low is only the fallback.
      // The range can lag the live price, so the price itself always sits inside it.
      high24hUsd: widen(chart ? chart.highUsd : usdOrNull(coin.high24hUsd), priceUsd, 1),
      low24hUsd: widen(chart ? chart.lowUsd : usdOrNull(coin.low24hUsd), priceUsd, -1),
      liquidityUsd,
      verified: token.flashSupported && token.address !== null,
    };
  }
}

const instances = new WeakMap<MarketServiceDeps, MarketService>();

/** One instance per deps object (app.deps) so /market and /insight share the caches and their CoinGecko credits. */
export function sharedMarketService(deps: MarketServiceDeps, log?: MarketLog): MarketService {
  const existing = instances.get(deps);
  if (existing) return existing;
  const created = new MarketService(deps, log);
  instances.set(deps, created);
  return created;
}
