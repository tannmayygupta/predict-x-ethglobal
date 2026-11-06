/**
 * Fixed-point decimals on bigint for the clamp (RULES 3.2: prices are never JS numbers).
 * A value is `units / 10^scale`; "0.0000120" is { units: 120n, scale: 7 }.
 */
export interface Fixed {
  units: bigint;
  scale: number;
}

/** Same rule as the shared DecimalString schema: digits with an optional fraction, no sign or exponent. */
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;
const TEN = 10n;
const TWO = 2n;

export function parseFixed(text: string): Fixed | undefined {
  if (!DECIMAL_PATTERN.test(text)) return undefined;
  const [whole = "", fraction = ""] = text.split(".");
  return { units: BigInt(whole + fraction), scale: fraction.length };
}

function pow10(exponent: number): bigint {
  return TEN ** BigInt(exponent);
}

/** Changes the scale; reducing it rounds half up, since the clamp bound is a guard rail rather than a quote. */
export function rescale(value: Fixed, scale: number): Fixed {
  if (scale >= value.scale) return { units: value.units * pow10(scale - value.scale), scale };
  const divisor = pow10(value.scale - scale);
  const quotient = value.units / divisor;
  const remainder = value.units % divisor;
  return { units: remainder * TWO >= divisor ? quotient + 1n : quotient, scale };
}

export function compareFixed(a: Fixed, b: Fixed): number {
  const scale = Math.max(a.scale, b.scale);
  const left = rescale(a, scale).units;
  const right = rescale(b, scale).units;
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** Plain decimal text, never exponent notation, with exactly `scale` fraction digits. */
export function formatFixed({ units, scale }: Fixed): string {
  const digits = units.toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
