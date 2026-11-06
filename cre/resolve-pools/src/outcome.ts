/** Pool direction as stored onchain: 0 = above, 1 = below (contracts/src/PredictionPool.sol). */
export const DIRECTION_ABOVE = 0
export const DIRECTION_BELOW = 1

/** YES wins when the price is at or past the strike in the pool's direction. */
export function decideOutcome(direction: number, strikeE18: bigint, priceE18: bigint): boolean {
  if (direction === DIRECTION_ABOVE) return priceE18 >= strikeE18
  if (direction === DIRECTION_BELOW) return priceE18 <= strikeE18
  throw new Error(`unknown pool direction: ${direction}`)
}
