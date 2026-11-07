/**
 * Decimal-string arithmetic for the mock Flash client. Money never passes through a JS number (RULES 3.2);
 * bigint keeps PEPE-scale prices (0.0000120) exact. T-B02 owns src/util/decimal.ts, hence this local helper.
 */
const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;
const RADIX = 10n;

export const MOCK_AMOUNT_SCALE = 6;

interface ScaledInteger {
  digits: bigint;
  scale: number;
}

function parseDecimal(value: string): ScaledInteger {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) throw new RangeError(`not a decimal string: ${value}`);
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  return { digits: BigInt(whole + fraction), scale: fraction.length };
}

function pow10(exponent: number): bigint {
  return RADIX ** BigInt(exponent);
}

const HALF_UP_OFFSET = 5n;

/** numerator / denominator rounded half-up to `scale` decimals, always printed with `scale` decimals. */
export function divideDecimal(numerator: string, denominator: string, scale = MOCK_AMOUNT_SCALE): string {
  const num = parseDecimal(numerator);
  const den = parseDecimal(denominator);
  if (den.digits === 0n) throw new RangeError("division by zero");
  // num/den = (N * 10^b) / (D * 10^a); one extra digit of precision carries the rounding decision.
  const extended = (num.digits * pow10(den.scale) * pow10(scale + 1)) / (den.digits * pow10(num.scale));
  const quotient = (extended + HALF_UP_OFFSET) / RADIX;
  return formatScaled(quotient, scale);
}

function formatScaled(value: bigint, scale: number): string {
  if (scale === 0) return value.toString();
  const unit = pow10(scale);
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(scale, "0");
  return `${whole.toString()}.${fraction}`;
}

/** Cuts extra fraction digits (never rounds up): Flash prints 36+ decimals, a token has `decimals`. */
export function clampDecimals(value: string, decimals: number): string {
  const { digits, scale } = parseDecimal(value);
  if (scale <= decimals) return value;
  return formatScaled(digits / pow10(scale - decimals), decimals);
}

/** a * b floored to `scale` decimals, exactly (bigint), so a minimum-received figure never overstates. */
export function multiplyDecimal(a: string, b: string, scale: number): string {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  const product = left.digits * right.digits;
  const productScale = left.scale + right.scale;
  if (productScale <= scale) return formatScaled(product * pow10(scale - productScale), scale);
  return formatScaled(product / pow10(productScale - scale), scale);
}

const TRAILING_ZEROS = /\.?0+$/;

/**
 * amount * (1 - slippage), floored to the token's decimals. The worst fill a market order may accept, so it
 * must never round up. A slippage above 1 yields zero rather than a negative amount.
 */
export function minAfterSlippage(amount: string, slippage: string, decimals: number): string {
  const slip = parseDecimal(slippage);
  const one = pow10(slip.scale);
  const keep = slip.digits >= one ? 0n : one - slip.digits;
  const floored = multiplyDecimal(amount, formatScaled(keep, slip.scale), decimals);
  // The scale pads to every token decimal (18 digits for ETH); the trailing zeros carry no information.
  return floored.includes(".") ? floored.replace(TRAILING_ZEROS, "") : floored;
}

/** True for a non-zero decimal, the guard before any division by an amount. */
export function isPositiveDecimal(value: string): boolean {
  const match = DECIMAL_PATTERN.exec(value);
  return match !== null && BigInt(`${match[1] ?? "0"}${match[2] ?? ""}`) > 0n;
}
