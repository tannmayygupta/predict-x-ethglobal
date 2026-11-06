import type { Market, Token } from "@predictx/shared";
import { PriceSourceError, type PriceSource } from "../clients/priceSource";
import { upstreamError } from "../errors";
import { TtlCache } from "../util/cache";
import type { Clock } from "../util/clock";
import { numberToDecimalString } from "../util/decimal";
import { requireToken } from "./tokens";

/** TASKS.md T-B02 fixes the spot cache at 30 s (CoinGecko's own edge cache is 30 to 60 s). */
export const SPOT_TTL_SECONDS = 30;
/** A 7-day percentage moves slowly; 5x fewer CoinGecko credits than the spot cache (notes section 6). */
export const WEEK_CHANGE_TTL_SECONDS = 300;
const PRICE_SOURCE_UNAVAILABLE = "price source unavailable";

export interface MarketServiceDeps {
  priceSource: PriceSource;
  clock: Clock;
}

/** The subset of a pino logger the service needs; keeps services free of Fastify types. */
export interface MarketLog {
  warn(obj: object, msg: string): void;
}

export class MarketService {
  private readonly spot: TtlCache<Market>;
  private readonly weekChange: TtlCache<number | null>;

  constructor(
    private readonly deps: MarketServiceDeps,
    private readonly log?: MarketLog,
  ) {
    this.spot = new TtlCache<Market>(deps.clock, SPOT_TTL_SECONDS);
    this.weekChange = new TtlCache<number | null>(deps.clock, WEEK_CHANGE_TTL_SECONDS);
  }

  async get(symbol: string): Promise<Market> {
    const token = requireToken(symbol);
    const fresh = this.spot.getFresh(token.symbol);
    if (fresh) return fresh;
    try {
      const market = await this.fetchMarket(token);
      this.spot.set(token.symbol, market);
      return market;
    } catch (err) {
      if (!(err instanceof PriceSourceError)) throw err;
      // D-B5: a delayed price beats no price for a hover card (ARCHITECTURE.md "Price delayed").
      const stale = this.spot.get(token.symbol);
      if (!stale) throw upstreamError(PRICE_SOURCE_UNAVAILABLE);
      this.log?.warn({ symbol: token.symbol, err: err.message }, "price source failed; serving stale");
      return { ...stale.value, updatedAt: stale.storedAt };
    }
  }

  /**
   * D-B7: 7d change for the insight prompt only; /market never pays for it. A failure yields null
   * (the prompt says "unknown") so the insight route keeps its 200-with-fallback promise (B05-10).
   */
  async change7dPct(symbol: string): Promise<number | null> {
    const token = requireToken(symbol);
    const id = token.coingeckoId;
    if (this.weekChange.isFresh(id)) return this.weekChange.get(id)?.value ?? null;
    try {
      const change = await this.deps.priceSource.change7dPct(id);
      this.weekChange.set(id, change);
      return change;
    } catch (err) {
      if (!(err instanceof PriceSourceError)) throw err;
      const stale = this.weekChange.get(id);
      this.log?.warn({ symbol: token.symbol, err: err.message, stale: stale !== undefined }, "7d change unavailable");
      return stale?.value ?? null;
    }
  }

  private async fetchMarket(token: Token): Promise<Market> {
    const prices = await this.deps.priceSource.simplePrice([token.coingeckoId]);
    const entry = prices[token.coingeckoId];
    // CoinGecko drops unknown ids silently and nulls the 24h change when its own data is stale;
    // neither is a price worth showing, so both take the same path as an outage.
    if (!entry) throw new PriceSourceError(`no price for ${token.coingeckoId}`);
    if (entry.usd24hChange === null) throw new PriceSourceError(`stale price for ${token.coingeckoId}`);
    return {
      symbol: token.symbol,
      name: token.name,
      address: token.address,
      flashChainId: token.flashChainId,
      priceUsd: numberToDecimalString(entry.usd),
      change24hPct: entry.usd24hChange,
      updatedAt: this.deps.clock.now(),
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
