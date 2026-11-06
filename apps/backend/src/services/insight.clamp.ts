import { compareFixed, formatFixed, parseFixed, rescale, type Fixed } from "./insight.decimal";

/** TASKS.md T-B05: a suggested limit may sit at most this far from spot. */
export const MAX_LIMIT_DEVIATION_PCT = 15;
/** USD prices carry at least cents, even when spot is a whole number. */
const MIN_PRICE_DECIMALS = 2;
const PERCENT_SCALE = 2;
const PERCENT = 100;

/** spot * pct / 100 exactly: two more fraction digits absorb the division. */
function percentOf(spot: Fixed, pct: number): Fixed {
  return { units: spot.units * BigInt(pct), scale: spot.scale + PERCENT_SCALE };
}

/**
 * Keeps a model-suggested limit within 15% of spot. A bound is formatted with spot's decimals
 * (minimum two); a limit inside the band is returned as given.
 */
export function clampSuggestedLimit(spotUsd: string, limitUsd: string | null): string | null {
  if (limitUsd === null) return null;
  const spot = parseFixed(spotUsd);
  const limit = parseFixed(limitUsd);
  if (!spot || !limit) return null;
  const decimals = Math.max(MIN_PRICE_DECIMALS, spot.scale);
  const lower = percentOf(spot, PERCENT - MAX_LIMIT_DEVIATION_PCT);
  if (compareFixed(limit, lower) < 0) return formatFixed(rescale(lower, decimals));
  const upper = percentOf(spot, PERCENT + MAX_LIMIT_DEVIATION_PCT);
  if (compareFixed(limit, upper) > 0) return formatFixed(rescale(upper, decimals));
  return limitUsd;
}
