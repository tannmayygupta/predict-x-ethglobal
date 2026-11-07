/**
 * Pure swap maths: every figure the quote screen derives, kept apart from React so it can be tested exactly.
 * Money is string or bigint throughout (RULES 3.2).
 */
import type { FlashQuoteResponse } from "@predictx/shared";
import { applySlippageFloor, belowBy, compare, fractionToPercent, isDecimal, percentOver, roundTo, tidyPrice, toScaled } from "../../decimal";

export const LIMIT_PRESETS_PCT = ["1", "2", "5"] as const;
export const SLIPPAGE_PRESETS = ["0.005", "0.01", "0.03", "0.15"] as const;
export const DEFAULT_SLIPPAGE = "0.01";

/** The Good-till-cancelled choice sends no expireAt at all; Flash then uses its own open-ended deadline. */
export const EXPIRY_PRESETS = [
  { id: "gtc", label: "Good till cancelled", seconds: null },
  { id: "1h", label: "1 hour", seconds: 3600 },
  { id: "24h", label: "24 hours", seconds: 86_400 },
  { id: "7d", label: "7 days", seconds: 604_800 },
] as const;
export type ExpiryId = (typeof EXPIRY_PRESETS)[number]["id"];

export function expireAtFor(id: ExpiryId, now: number): number | null {
  const preset = EXPIRY_PRESETS.find((p) => p.id === id);
  return preset?.seconds != null ? now + preset.seconds : null;
}

export function isPositiveDecimal(value: string): boolean {
  return isDecimal(value) && !/^-/.test(value.trim()) && toScaled(value) > 0n;
}

/** The price a preset sets: this many percent below the live market price. */
export function limitPresetPrice(marketPrice: string, pctBelow: string): string {
  return tidyPrice(belowBy(marketPrice, pctBelow));
}

export type LimitGap = { kind: "below"; pct: string } | { kind: "at_or_above" };

/** How a limit price compares to the live market. At or above market means a buy that fills immediately. */
export function limitGap(limitPrice: string, marketPrice: string): LimitGap | null {
  if (!isPositiveDecimal(limitPrice) || !isPositiveDecimal(marketPrice)) return null;
  if (compare(limitPrice, marketPrice) >= 0) return { kind: "at_or_above" };
  // Relative to market: (market - limit) / market, shown as a positive number of percent below.
  const below = percentOver(limitPrice, marketPrice, 2);
  return below === null ? null : { kind: "below", pct: below.replace(/^-/, "") };
}

/**
 * What the swap really cost beyond the token value: spend minus receive in USD. Flash reports a zero fee because
 * gas is embedded in the rate, so this is the honest number. Clamped at 0 (a favourable rounding is not a gain).
 */
export function networkCost(spendUsd: string | null, receiveUsd: string | null): string | null {
  if (spendUsd === null || receiveUsd === null) return null;
  const cost = toScaled(spendUsd) - toScaled(receiveUsd);
  return roundTo(cost < 0n ? 0n : cost, 2);
}

/** Signed percent gap of the effective price against the reference price, e.g. "2.03". */
export function effectiveGap(effectivePrice: string | null, reference: string | null): string | null {
  if (effectivePrice === null || reference === null) return null;
  return percentOver(effectivePrice, reference, 2);
}

/** Flash's own number when present; otherwise derived from the receive amount and the slippage we sent. */
export function minReceiveOf(quote: FlashQuoteResponse, decimals: number): string {
  if (quote.minReceive !== null) return quote.minReceive;
  if (quote.slippage === null) return quote.receive.amount;
  return applySlippageFloor(quote.receive.amount, quote.slippage, decimals);
}

export function secondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, expiresAt - now);
}

/** True when the chosen slippage is under Flash's suggestion (the order is more likely not to fill). */
export function slippageBelowSuggested(chosen: string, suggested: string | null): boolean {
  return suggested !== null && isPositiveDecimal(chosen) && compare(chosen, suggested) < 0;
}

/** "0.15" -> "15", "0.005" -> "0.5". */
export function slippagePercent(fraction: string): string {
  return fractionToPercent(fraction);
}

export type OrderExpiry = { kind: "at"; unix: number } | { kind: "open_ended" };

/** Market orders expire at the typed-data deadline (about 5 minutes); limit orders at the chosen time or never. */
export function orderExpiry(quote: FlashQuoteResponse, chosenExpireAt: number | null): OrderExpiry {
  if (quote.orderType === "market") return quote.orderDeadline !== null ? { kind: "at", unix: quote.orderDeadline } : { kind: "open_ended" };
  if (chosenExpireAt !== null) return { kind: "at", unix: chosenExpireAt };
  return quote.orderDeadline !== null ? { kind: "at", unix: quote.orderDeadline } : { kind: "open_ended" };
}

