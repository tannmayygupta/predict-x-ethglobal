/**
 * Raw contract tuples -> the API's Pool and Position shapes. The backend serves these to everyone; the UI
 * uses the same functions to refresh a pool straight from the chain right after a transaction, so the two
 * can never disagree about status, outcome or payout.
 */
import tokensJson from "../tokens.json";
import { fromE18, computePayout, derivePoolStatus } from "./helpers";
import { TokensResponse, type Pool, type PoolStatus, type Position } from "./schemas";

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
