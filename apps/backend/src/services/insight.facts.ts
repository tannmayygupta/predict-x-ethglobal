import type { MarketChart } from "@predictx/shared";
import { formatFixed, parseFixed, rescale, type Fixed } from "./insight.decimal";

/**
 * Derived facts for the insight prompt. Everything here is computed from CoinGecko numbers the market
 * service already holds, on bigint decimals where the input is a price (RULES 3.2). Each function answers
 * undefined when its inputs are missing, and the prompt then says "unknown" instead of guessing.
 */

const TEN = 10n;

function pow10(exponent: number): bigint {
  return TEN ** BigInt(exponent);
}

/** Puts values on one scale so they can be added, subtracted and divided as integers. */
function align(...values: Fixed[]): bigint[] {
  const scale = Math.max(...values.map((v) => v.scale));
  return values.map((v) => rescale(v, scale).units);
}

/** numerator / denominator as a percentage with `decimals` places, half-up; undefined for a zero denominator. */
function percent(numerator: bigint, denominator: bigint, decimals: number): string | undefined {
  if (denominator <= 0n) return undefined;
  const scaled = (numerator * 100n * pow10(decimals) * 2n + denominator) / (denominator * 2n);
  return formatFixed({ units: scaled, scale: decimals });
}

const POSITION_DECIMALS = 1;
const RATIO_DECIMALS = 2;
const FULL_RANGE_PCT = 100n * pow10(POSITION_DECIMALS);

/** Where the spot sits between the low (0%) and the high (100%), clamped: spot can sit just outside a rounded range. */
export function rangePositionPct(spotUsd: string, lowUsd: string | null, highUsd: string | null): string | undefined {
  const spot = parseFixed(spotUsd);
  const low = lowUsd === null ? undefined : parseFixed(lowUsd);
  const high = highUsd === null ? undefined : parseFixed(highUsd);
  if (!spot || !low || !high) return undefined;
  const [s = 0n, l = 0n, h = 0n] = align(spot, low, high);
  if (h <= l) return undefined;
  const raw = percent(s - l, h - l, POSITION_DECIMALS);
  if (raw === undefined) return undefined;
  const tenths = BigInt(raw.replace(".", ""));
  if (tenths < 0n) return "0.0";
  return tenths > FULL_RANGE_PCT ? "100.0" : raw;
}

/** High minus low as a share of spot: how wide the day was. */
export function rangeWidthPct(spotUsd: string, lowUsd: string | null, highUsd: string | null): string | undefined {
  const spot = parseFixed(spotUsd);
  const low = lowUsd === null ? undefined : parseFixed(lowUsd);
  const high = highUsd === null ? undefined : parseFixed(highUsd);
  if (!spot || !low || !high) return undefined;
  const [s = 0n, l = 0n, h = 0n] = align(spot, low, high);
  return h < l ? undefined : percent(h - l, s, RATIO_DECIMALS);
}

/** 24h volume as a share of market cap, a turnover gauge. */
export function volumeToCapPct(volumeUsd: string | null, marketCapUsd: string | null): string | undefined {
  const volume = volumeUsd === null ? undefined : parseFixed(volumeUsd);
  const cap = marketCapUsd === null ? undefined : parseFixed(marketCapUsd);
  if (!volume || !cap) return undefined;
  const [v = 0n, c = 0n] = align(volume, cap);
  return percent(v, c, RATIO_DECIMALS);
}

const SECONDS_PER_MINUTE = 60;
const VOLATILITY_DECIMALS = 2;

/**
 * Standard deviation of the step-to-step returns of a chart, in percent, and the step length in minutes.
 * This is a statistic for display, so it runs on JS numbers; no price is stored or sent from the result.
 */
export function chartVolatility(chart: MarketChart | undefined): { stepMinutes: number; stdDevPct: string } | undefined {
  if (!chart || chart.points.length < 3) return undefined;
  const prices = chart.points.map(([, price]) => Number(price));
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i += 1) {
    const before = prices[i - 1];
    const after = prices[i];
    if (before === undefined || after === undefined || before <= 0) continue;
    returns.push((after - before) / before);
  }
  if (returns.length < 2) return undefined;
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  const first = chart.points[0];
  const last = chart.points[chart.points.length - 1];
  if (!first || !last) return undefined;
  const stepSeconds = (last[0] - first[0]) / (chart.points.length - 1);
  return {
    stepMinutes: Math.round(stepSeconds / SECONDS_PER_MINUTE),
    stdDevPct: (Math.sqrt(variance) * 100).toFixed(VOLATILITY_DECIMALS),
  };
}
