import { PriceSourceError, type CoinMarket, type PriceSource, type RawChartPoint } from "../../../src/clients/priceSource";

/** Programmable row: only usd and the 24h change are required, the rest default to null like a sparse CoinGecko reply. */
export interface SimplePriceEntry extends Partial<Omit<CoinMarket, "usd" | "change24hPct">> {
  usd: number;
  usd24hChange: number | null;
}

export type PriceSourceCall =
  | { method: "markets"; ids: string[] }
  | { method: "marketChart"; id: string; days: number }
  | { method: "onchainLiquidityUsd"; network: string; address: string };

/** Oldest first, one point per `stepSeconds`; the default start is 2025-10-26 21:20 UTC. */
export function series(prices: number[], start = 1_761_513_600, stepSeconds = 300): RawChartPoint[] {
  return prices.map((price, index): RawChartPoint => [start + index * stepSeconds, price]);
}

export class FakePriceSource implements PriceSource {
  /** Programmed answers keyed by coingecko id. Ids not present are omitted from the reply, like CoinGecko does. */
  prices: Record<string, SimplePriceEntry> = {};
  change7d: Record<string, number | null> = {};
  /** Keyed `${id}:${days}`. A missing key fails like an upstream outage. */
  charts: Record<string, RawChartPoint[]> = {};
  /** Keyed `${network}:${address}`; a missing key is "no pool listed". */
  liquidity: Record<string, string | null> = {};
  /** When set, every markets call throws this error until cleared. */
  failWith: Error | null = null;
  failChartWith: Error | null = null;
  failLiquidityWith: Error | null = null;
  readonly calls: PriceSourceCall[] = [];

  async markets(ids: string[]): Promise<Record<string, CoinMarket>> {
    this.calls.push({ method: "markets", ids: [...ids] });
    if (this.failWith) throw this.failWith;
    const out: Record<string, CoinMarket> = {};
    for (const id of ids) {
      const entry = this.prices[id];
      if (!entry) continue;
      out[id] = {
        usd: entry.usd,
        change24hPct: entry.usd24hChange,
        change7dPct: entry.change7dPct ?? this.change7d[id] ?? null,
        marketCapUsd: entry.marketCapUsd ?? null,
        volume24hUsd: entry.volume24hUsd ?? null,
        high24hUsd: entry.high24hUsd ?? null,
        low24hUsd: entry.low24hUsd ?? null,
      };
    }
    return out;
  }

  async marketChart(id: string, days: number): Promise<RawChartPoint[]> {
    this.calls.push({ method: "marketChart", id, days });
    if (this.failChartWith) throw this.failChartWith;
    const chart = this.charts[`${id}:${days}`];
    if (!chart) throw new PriceSourceError(`fake: no chart for ${id} ${days}d`, 500);
    return chart;
  }

  async onchainLiquidityUsd(network: string, address: string): Promise<string | null> {
    this.calls.push({ method: "onchainLiquidityUsd", network, address });
    if (this.failLiquidityWith) throw this.failLiquidityWith;
    return this.liquidity[`${network}:${address}`] ?? null;
  }
}
