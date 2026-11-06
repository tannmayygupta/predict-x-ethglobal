import type { RawPool, RawPosition } from "@predictx/shared";

// Raw tuples are defined in @predictx/shared next to the mapping that consumes them.
export type { RawPool, RawPosition };

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
