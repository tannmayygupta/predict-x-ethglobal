/** Adapter boundary for CoinGecko. The real client lives in coingecko.ts (T-B02). */

/**
 * One row of the batched /coins/markets reply. Raw JSON numbers: the service turns them into
 * DecimalStrings, because only the service knows which fields are money.
 */
export interface CoinMarket {
  usd: number;
  change24hPct: number | null;
  change7dPct: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  high24hUsd: number | null;
  low24hUsd: number | null;
}

/** [unix seconds, USD price], oldest first. */
export type RawChartPoint = [number, number];

export interface PriceSource {
  /** One batched call for all ids; ids CoinGecko does not know are simply absent from the result. */
  markets(ids: string[]): Promise<Record<string, CoinMarket>>;
  /** days is 1 (five-minute points) or 7 (hourly points). */
  marketChart(id: string, days: number): Promise<RawChartPoint[]>;
  /** USD pool reserves for a token, or null when CoinGecko lists no pool for it. */
  onchainLiquidityUsd(network: string, address: string): Promise<string | null>;
}

export class PriceSourceError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "PriceSourceError";
    if (status !== undefined) this.status = status;
  }
}
