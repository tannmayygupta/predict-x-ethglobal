import type { PriceSource, SimplePriceEntry } from "../../../src/clients/priceSource";

export type PriceSourceCall = { method: "simplePrice"; ids: string[] } | { method: "change7dPct"; id: string };

export class FakePriceSource implements PriceSource {
  /** Programmed answers keyed by coingecko id. Ids not present are omitted from the reply, like CoinGecko does. */
  prices: Record<string, SimplePriceEntry> = {};
  change7d: Record<string, number | null> = {};
  /** When set, every call throws this error until cleared. */
  failWith: Error | null = null;
  readonly calls: PriceSourceCall[] = [];

  async simplePrice(ids: string[]): Promise<Record<string, SimplePriceEntry>> {
    this.calls.push({ method: "simplePrice", ids: [...ids] });
    if (this.failWith) throw this.failWith;
    const out: Record<string, SimplePriceEntry> = {};
    for (const id of ids) {
      const entry = this.prices[id];
      if (entry) out[id] = entry;
    }
    return out;
  }

  async change7dPct(id: string): Promise<number | null> {
    this.calls.push({ method: "change7dPct", id });
    if (this.failWith) throw this.failWith;
    return this.change7d[id] ?? null;
  }
}
