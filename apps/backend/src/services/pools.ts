import { toPool, toPosition, type Pool, type PoolContext, type Position, type RawPool, type RawPosition } from "@predictx/shared";
import { ChainReadError, type PoolReader } from "../clients/poolReader";
import { notFound, upstreamError } from "../errors";
import { TtlCache } from "../util/cache";
import type { Clock } from "../util/clock";

export { statusOf, toPool, toPosition, type PoolContext } from "@predictx/shared";

/** PoolsResponse caps the list at 20 (schemas.ts); the reader is asked for exactly that many. */
export const POOL_LIST_LIMIT = 20;
/** TASKS.md T-B07: a Base Sepolia block is ~2 s, so 10 s keeps the bet box fresh without hammering the RPC. */
export const POOL_TTL_SECONDS = 10;
const LIST_KEY = "latest";
const CHAIN_UNAVAILABLE = "chain unavailable";

export type PoolsContext = Omit<PoolContext, "now">;

/** The subset of a pino logger the service needs; keeps services free of Fastify types. */
export interface PoolsLog {
  warn(obj: object, msg: string): void;
}

/**
 * Read side of the pools API: chain reads through the injected reader, mapping with the shared helpers.
 * Raw tuples are cached, not mapped pools, so status always reflects the clock at response time.
 */
export class PoolsService {
  private readonly listCache: TtlCache<RawPool[]>;
  private readonly poolCache: TtlCache<RawPool>;
  private readonly positionCache: TtlCache<RawPosition>;

  constructor(
    private readonly reader: PoolReader,
    private readonly clock: Clock,
    private readonly ctx: PoolsContext,
    private readonly log?: PoolsLog,
  ) {
    this.listCache = new TtlCache<RawPool[]>(clock, POOL_TTL_SECONDS);
    this.poolCache = new TtlCache<RawPool>(clock, POOL_TTL_SECONDS);
    this.positionCache = new TtlCache<RawPosition>(clock, POOL_TTL_SECONDS);
  }

  async list(): Promise<Pool[]> {
    const raws = await this.cached(this.listCache, LIST_KEY, () => this.reader.listLatest(POOL_LIST_LIMIT));
    const now = this.clock.now();
    return raws.map((raw) => toPool(raw, { ...this.ctx, now }));
  }

  async get(id: bigint): Promise<Pool> {
    return toPool(await this.readPool(id), { ...this.ctx, now: this.clock.now() });
  }

  async getPosition(id: bigint, address: string): Promise<Position> {
    const pool = await this.readPool(id);
    // Addresses arrive in any case from query strings; the chain treats them as one account.
    const key = `${id}:${address.toLowerCase()}`;
    const raw = await this.cached(this.positionCache, key, () => this.reader.getPosition(id, address));
    return toPosition(pool, raw, address, this.clock.now());
  }

  private readPool(id: bigint): Promise<RawPool> {
    return this.cached(this.poolCache, id.toString(), async () => {
      // poolCount answers "does it exist" without provoking a revert from getPool on the chain.
      const count = await this.reader.poolCount();
      if (id >= count) throw notFound(`pool ${id} does not exist`);
      return this.reader.getPool(id);
    });
  }

  private async cached<T>(cache: TtlCache<T>, key: string, read: () => Promise<T>): Promise<T> {
    const fresh = cache.getFresh(key);
    if (fresh !== undefined) return fresh;
    try {
      const value = await read();
      cache.set(key, value);
      return value;
    } catch (err) {
      if (!(err instanceof ChainReadError)) throw err;
      // D-B5: a bet box showing slightly old totals beats an error while the RPC hiccups.
      const stale = cache.get(key);
      if (!stale) throw upstreamError(CHAIN_UNAVAILABLE);
      this.log?.warn({ key, err: err.message }, "chain read failed; serving stale");
      return stale.value;
    }
  }
}
