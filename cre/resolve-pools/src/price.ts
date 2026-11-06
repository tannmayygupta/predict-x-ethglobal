/** Exact decimal price handling. Never uses floating point for the value itself. */

export const E18 = 10n ** 18n
const DECIMALS = 18
const MAX_ABS_EXPONENT = 60

// Unsigned decimal with optional fraction and optional exponent: 3000, 0.5, .5, 5., 1.2e-5, 1E+3
const DECIMAL_RE = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/

/**
 * Parse a non-negative decimal (plain or exponent notation) into an integer scaled by 1e18.
 * Digits beyond 18 decimal places are truncated (rounded toward zero).
 */
export function decimalToE18(decimal: string): bigint {
  const match = DECIMAL_RE.exec(decimal)
  if (!match) throw new Error(`not a decimal number: "${decimal}"`)
  const intPart = match[1] ?? ""
  const fracPart = match[2] ?? ""
  if (intPart.length === 0 && fracPart.length === 0) throw new Error(`not a decimal number: "${decimal}"`)
  const exponent = match[3] === undefined ? 0 : Number.parseInt(match[3], 10)
  if (Math.abs(exponent) > MAX_ABS_EXPONENT) throw new Error(`exponent out of range: "${decimal}"`)

  // value = digits * 10^(exponent - fracPart.length); scaled = value * 10^18
  const digits = BigInt(`${intPart}${fracPart}` || "0")
  const shift = exponent - fracPart.length + DECIMALS
  if (shift >= 0) return digits * 10n ** BigInt(shift)
  return digits / 10n ** BigInt(-shift)
}

/** Render an integer scaled by 1e18 as a plain decimal string (for logs). */
export function formatE18(valueE18: bigint): string {
  const negative = valueE18 < 0n
  const abs = negative ? -valueE18 : valueE18
  const whole = abs / E18
  const frac = (abs % E18).toString().padStart(DECIMALS, "0").replace(/0+$/, "")
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`
}
