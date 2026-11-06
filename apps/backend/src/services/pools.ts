import {
  TokensResponse,
  computePayout,
  derivePoolStatus,
  fromE18,
  type Pool,
  type PoolStatus,
  type Position,
} from "@predictx/shared";
import tokensJson from "@predictx/shared/tokens.json";
import { ChainReadError, type PoolReader, type RawPool, type RawPosition } from "../clients/poolReader";
import { notFound, upstreamError } from "../errors";
import { TtlCache } from "../util/cache";
import type { Clock } from "../util/clock";

export interface PoolContext {
  now: number;
  chainId: number;
  contract: string;
  /** Dashboard origin; the pool page path is appended here. */
  dashboardUrl: string;
}

/** Contract encoding of the direction enum (API_CONTRACT section 4). */
const DIRECTION_ABOVE = 0;
const QUESTION_SYMBOL = /^Will \$(\S+) be /;
const TRAILING_SLASHES = /\/+$/;

const SYMBOL_BY_COINGECKO_ID = new Map(TokensResponse.parse(tokensJson).tokens.map((t) => [t.coingeckoId, t.symbol]));

/** tokens.json is the allowlist, but a pool may outlive a listing; the question still carries the symbol. */
function symbolFor(raw: RawPool): string {
  const listed = SYMBOL_BY_COINGECKO_ID.get(raw.coingeckoId);
  if (listed) return listed;
  const fromQuestion = QUESTION_SYMBOL.exec(raw.question)?.[1];
  return fromQuestion ?? raw.coingeckoId.toUpperCase();
}

export function statusOf(raw: RawPool, now: number): PoolStatus {
  return derivePoolStatus({
    now,
    resolveTime: Number(raw.resolveTime),
    resolved: raw.resolved,
    yesTotal: raw.yesTotal.toString(),
    noTotal: raw.noTotal.toString(),
  });
}

export function toPool(raw: RawPool, ctx: PoolContext): Pool {
  const id = Number(raw.id);
  const status = statusOf(raw, ctx.now);
  return {
    id,
    chainId: ctx.chainId,
    contract: ctx.contract,
    question: raw.question,
    symbol: symbolFor(raw),
    coingeckoId: raw.coingeckoId,
    direction: raw.direction === DIRECTION_ABOVE ? "above" : "below",
    strikeUsd: fromE18(raw.strikeE18),
    resolveTime: Number(raw.resolveTime),
    createdAt: Number(raw.createdAt),
    yesTotal: raw.yesTotal.toString(),
    noTotal: raw.noTotal.toString(),
    status,
    // A void pool is "resolved" onchain too, but its stored outcome is meaningless (B07-03).
    outcome: status === "resolved" ? (raw.outcomeYes ? "yes" : "no") : null,
    resolvedPriceUsd: raw.resolved ? fromE18(raw.resolvedPriceE18) : null,
    feeBps: raw.feeBps,
    creator: raw.creator,
    dashboardUrl: `${ctx.dashboardUrl.replace(TRAILING_SLASHES, "")}/pool/${id}`,
  };
}

function winnerPayout(pool: RawPool, raw: RawPosition): bigint {
  const stake = pool.outcomeYes ? raw.yesStake : raw.noStake;
  const winningTotal = pool.outcomeYes ? pool.yesTotal : pool.noTotal;
  const losingTotal = pool.outcomeYes ? pool.noTotal : pool.yesTotal;
  return computePayout(stake, winningTotal, losingTotal, pool.feeBps);
}

/** `claimed` is set by the contract on both claim and refund, so it gates both payouts (B07-10). */
export function toPosition(pool: RawPool, raw: RawPosition, address: string, now: number): Position {
  const status = statusOf(pool, now);
  const payable = !raw.claimed;
  const claimable = payable && status === "resolved" ? winnerPayout(pool, raw) : 0n;
  const refundable = payable && status === "void" ? raw.yesStake + raw.noStake : 0n;
  return {
    poolId: Number(pool.id),
    address,
    yesStake: raw.yesStake.toString(),
    noStake: raw.noStake.toString(),
    claimable: claimable.toString(),
    claimed: raw.claimed,
    refundable: refundable.toString(),
  };
}

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
