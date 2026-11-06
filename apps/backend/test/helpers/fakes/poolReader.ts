import { buildQuestion, fromE18, toStrikeE18, toUsdcUnits } from "@predictx/shared";
import { ChainReadError, type PoolReader, type RawPool, type RawPosition } from "../../../src/clients/poolReader";
import { FAKE_CLOCK_START } from "./clock";

const EMPTY_POSITION: RawPosition = { yesStake: 0n, noStake: 0n, claimed: false };

export type PoolReaderCall =
  | { method: "poolCount" }
  | { method: "getPool"; id: bigint }
  | { method: "getPosition"; id: bigint; address: string }
  | { method: "listLatest"; limit: number };

export class FakePoolReader implements PoolReader {
  /** Seeded pools; index must equal `pool.id` like the contract's array. */
  pools: RawPool[] = [];
  readonly positions = new Map<string, RawPosition>();
  /** When set, every call throws this error until cleared. */
  failWith: Error | null = null;
  readonly calls: PoolReaderCall[] = [];

  seed(pools: RawPool[]): void {
    this.pools = [...pools];
  }

  setPosition(id: bigint, address: string, position: RawPosition): void {
    this.positions.set(positionKey(id, address), position);
  }

  async poolCount(): Promise<bigint> {
    this.calls.push({ method: "poolCount" });
    if (this.failWith) throw this.failWith;
    return BigInt(this.pools.length);
  }

  async getPool(id: bigint): Promise<RawPool> {
    this.calls.push({ method: "getPool", id });
    if (this.failWith) throw this.failWith;
    const pool = this.pools[Number(id)];
    if (!pool) throw new ChainReadError(`pool ${id} does not exist`);
    return pool;
  }

  async getPosition(id: bigint, address: string): Promise<RawPosition> {
    this.calls.push({ method: "getPosition", id, address });
    if (this.failWith) throw this.failWith;
    return this.positions.get(positionKey(id, address)) ?? EMPTY_POSITION;
  }

  /** Newest first, like the contract-backed reader. */
  async listLatest(limit: number): Promise<RawPool[]> {
    this.calls.push({ method: "listLatest", limit });
    if (this.failWith) throw this.failWith;
    return [...this.pools].reverse().slice(0, limit);
  }
}

function positionKey(id: bigint, address: string): string {
  return `${id}:${address.toLowerCase()}`;
}

/* ---------- seed helpers ---------- */

export type SeedKind = "open" | "awaiting" | "resolved" | "void";

export interface SeedOverrides extends Partial<Omit<RawPool, "id" | "question">> {
  /** Symbol written into the question; defaults match tokens.json (pepe -> PEPE). */
  symbol?: string;
  /** Reference time the kind's timestamps are built around; defaults to the fake clock start. */
  now?: number;
}

export const SEED_CREATOR = "0x1111111111111111111111111111111111111111";
export const SEED_STRIKE_USD = "0.000012";
export const SEED_RESOLVED_PRICE_USD = "0.0000131";
const HOUR = 3600;
const AWAITING_AGE = 60;
const RESOLVED_AGE = 600;
const SEED_YES_TOTAL = toUsdcUnits("60");
const SEED_NO_TOTAL = toUsdcUnits("40");

const resolvedFields = (now: number): Partial<RawPool> => ({
  createdAt: BigInt(now - 2 * HOUR),
  resolveTime: BigInt(now - RESOLVED_AGE),
  resolved: true,
  outcomeYes: true,
  resolvedPriceE18: toStrikeE18(SEED_RESOLVED_PRICE_USD),
});

const KIND_FIELDS: Record<SeedKind, (now: number) => Partial<RawPool>> = {
  open: (now) => ({ createdAt: BigInt(now - HOUR), resolveTime: BigInt(now + HOUR) }),
  awaiting: (now) => ({ createdAt: BigInt(now - 2 * HOUR), resolveTime: BigInt(now - AWAITING_AGE) }),
  resolved: resolvedFields,
  // The contract still stores an outcome; the API must hide it for a void pool (B07-03).
  void: (now) => ({ ...resolvedFields(now), noTotal: 0n }),
};

/** A raw pool whose question is exactly what buildQuestion produces for its fields (FR-P-01 guard). */
export function makeRawPool(kind: SeedKind, id: number, overrides: SeedOverrides = {}): RawPool {
  const { symbol = "PEPE", now = FAKE_CLOCK_START, ...fields } = overrides;
  const base: Omit<RawPool, "question"> = {
    id: BigInt(id),
    coingeckoId: "pepe",
    direction: 0,
    strikeE18: toStrikeE18(SEED_STRIKE_USD),
    resolveTime: BigInt(now + HOUR),
    createdAt: BigInt(now - HOUR),
    yesTotal: SEED_YES_TOTAL,
    noTotal: SEED_NO_TOTAL,
    resolved: false,
    outcomeYes: false,
    resolvedPriceE18: 0n,
    feeBps: 200,
    creator: SEED_CREATOR,
    ...KIND_FIELDS[kind](now),
    ...fields,
  };
  const question = buildQuestion({
    symbol,
    direction: base.direction === 0 ? "above" : "below",
    strikeUsd: fromE18(base.strikeE18),
    resolveTime: Number(base.resolveTime),
  });
  return { ...base, question };
}

const KIND_CYCLE: SeedKind[] = ["open", "awaiting", "resolved", "void"];

/** ids 0..count-1 cycling through the four kinds, so any slice of the list carries every status. */
export function makeRawPools(count: number, now = FAKE_CLOCK_START): RawPool[] {
  return Array.from({ length: count }, (_, id) => makeRawPool(kindAt(id), id, { now }));
}

export function kindAt(id: number): SeedKind {
  return KIND_CYCLE[id % KIND_CYCLE.length] ?? "open";
}
