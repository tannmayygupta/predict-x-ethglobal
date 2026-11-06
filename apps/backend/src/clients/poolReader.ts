/** Raw contract tuples. The pools service converts them with the shared helpers (T-B07). */
export interface RawPool {
  id: bigint;
  question: string;
  coingeckoId: string;
  direction: number;
  strikeE18: bigint;
  resolveTime: bigint;
  createdAt: bigint;
  yesTotal: bigint;
  noTotal: bigint;
  resolved: boolean;
  outcomeYes: boolean;
  resolvedPriceE18: bigint;
  feeBps: number;
  creator: string;
}

export interface RawPosition {
  yesStake: bigint;
  noStake: bigint;
  claimed: boolean;
}

export interface PoolReader {
  poolCount(): Promise<bigint>;
  getPool(id: bigint): Promise<RawPool>;
  getPosition(id: bigint, address: string): Promise<RawPosition>;
  /** The newest `limit` pools, highest id first, read in as few round trips as the backend allows (B07-23). */
  listLatest(limit: number): Promise<RawPool[]>;
}

/** The message names the failed call only; the RPC URL (which may embed a key) stays in `cause`. */
export class ChainReadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChainReadError";
  }
}
