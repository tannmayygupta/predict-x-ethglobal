/** Display helpers shared by the bet box, the pool page and the home list. Pure; money stays in strings/bigint. */
import { formatUsdc } from "@predictx/shared";

const MIN_BAR_PERCENT = 4; // UI_REFERENCE OddsBar: each side stays visible when both exist
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

export interface Odds {
  hasBets: boolean;
  yesPct: number;
  noPct: number;
  /** Widths for the split bar, in percent. */
  yesBar: number;
  noBar: number;
}

export function oddsOf(yesTotal: string, noTotal: string): Odds {
  const yes = BigInt(yesTotal);
  const no = BigInt(noTotal);
  const total = yes + no;
  if (total === 0n) return { hasBets: false, yesPct: 0, noPct: 0, yesBar: 0, noBar: 0 };
  const yesPct = Number((yes * 100n + total / 2n) / total);
  const noPct = 100 - yesPct;
  if (yes === 0n) return { hasBets: true, yesPct: 0, noPct: 100, yesBar: 0, noBar: 100 };
  if (no === 0n) return { hasBets: true, yesPct: 100, noPct: 0, yesBar: 100, noBar: 0 };
  const yesBar = Math.min(100 - MIN_BAR_PERCENT, Math.max(MIN_BAR_PERCENT, yesPct));
  return { hasBets: true, yesPct, noPct, yesBar, noBar: 100 - yesBar };
}

const two = (n: number): string => String(n).padStart(2, "0");

/** MM:SS under an hour, "Hh Mm" above, "Closed" at zero (UI_REFERENCE Countdown). */
export function formatCountdown(resolveTime: number, now: number): string {
  const left = resolveTime - now;
  if (left <= 0) return "Closed";
  if (left < SECONDS_PER_HOUR) return `${two(Math.floor(left / SECONDS_PER_MINUTE))}:${two(left % SECONDS_PER_MINUTE)}`;
  return `${Math.floor(left / SECONDS_PER_HOUR)}h ${Math.floor((left % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)}m`;
}

/** Whole pool size, "100.00". */
export function poolSize(yesTotal: string, noTotal: string): string {
  return formatUsdc(BigInt(yesTotal) + BigInt(noTotal));
}

const PRICE_GROUP = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TINY_PRICE_DIGITS = 8;

/** "2451.12" -> "$2,451.12"; sub-dollar prices keep their small digits ("$0.000005062"). Display only. */
export function formatUsdPrice(priceUsd: string): string {
  const value = Number(priceUsd);
  if (!Number.isFinite(value)) return `$${priceUsd}`;
  if (value >= 1) return `$${PRICE_GROUP.format(value)}`;
  const digits = Math.max(2, Math.min(TINY_PRICE_DIGITS + 4, -Math.floor(Math.log10(value)) + 3));
  return `$${value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "")}`;
}

/** 24h change as shown on the card: "-1.8%" / "+0.4%". */
export function formatChange(pct: number): string {
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/** A fraction like "0.0004" as "0.04%". Display only. */
export function formatImpact(fraction: string): string {
  return `${(Number(fraction) * 100).toFixed(2)}%`;
}

/** The mock Flash client prefixes its ids; the UI must never present those as real (RULES 2.9). */
export function isMockQuote(quoteId: string): boolean {
  return quoteId.startsWith("q_mock_");
}

/** Price age after which the card says "Price delayed" even if the refresh did not fail outright. */
export const STALE_PRICE_SECONDS = 120;
/** A local clock this far from the chain's is moved onto it; under this the gap is just block-time lag. */
export const CLOCK_SKEW_THRESHOLD_SECONDS = 3;

export const STATUS_LABEL = { open: "Open", awaiting: "Awaiting result", resolved: "Resolved", void: "Void" } as const;

/**
 * The backend derives status from its own clock; the local clock may already be past the close. Betting is shown
 * as closed the moment the countdown hits zero, whichever clock is ahead. The contract has the final say.
 */
export function effectiveStatus(pool: { status: "open" | "awaiting" | "resolved" | "void"; resolveTime: number }, now: number) {
  return pool.status === "open" && now >= pool.resolveTime ? ("awaiting" as const) : pool.status;
}
