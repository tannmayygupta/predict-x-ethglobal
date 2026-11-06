/** Adapter boundary for CoinGecko. The real client lives in coingecko.ts (T-B02). */
export interface SimplePriceEntry {
  usd: number;
  usd24hChange: number | null;
}

export interface PriceSource {
  simplePrice(ids: string[]): Promise<Record<string, SimplePriceEntry>>;
  change7dPct(id: string): Promise<number | null>;
}

export class PriceSourceError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "PriceSourceError";
    if (status !== undefined) this.status = status;
  }
}
