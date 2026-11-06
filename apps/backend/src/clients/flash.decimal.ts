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
