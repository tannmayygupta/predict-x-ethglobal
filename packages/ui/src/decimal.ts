/**
 * Exact decimal arithmetic on strings via bigint. Prices and amounts never touch JS number (RULES 3.2); these
 * helpers carry the few operations the swap and chart screens need.
 */
const SCALE = 18;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** "12.5" -> 12500000000000000000n (18 decimals, extra digits truncated). Throws on non-decimal input. */
export function toScaled(value: string): bigint {
  const m = DECIMAL.exec(value.trim());
  if (!m) throw new Error("Invalid decimal");
  const frac = (m[3] ?? "").slice(0, SCALE).padEnd(SCALE, "0");
  const n = BigInt(`${m[2] ?? "0"}${frac}`);
  return m[1] === "-" ? -n : n;
}

/** Inverse of toScaled, trailing zeros trimmed. */
export function fromScaled(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const s = abs.toString().padStart(SCALE + 1, "0");
  const whole = s.slice(0, -SCALE);
  const frac = s.slice(-SCALE).replace(/0+$/, "");
  return `${negative && abs !== 0n ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function isDecimal(value: string): boolean {
  return DECIMAL.test(value.trim());
}

/** Rounds half away from zero to `places` decimals and pads: 1.005 -> "1.01". */
export function roundTo(value: bigint, places: number): string {
  const unit = 10n ** BigInt(SCALE - places);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const rounded = (abs + unit / 2n) / unit;
  const s = rounded.toString().padStart(places + 1, "0");
  const whole = s.slice(0, s.length - places);
  const frac = places > 0 ? s.slice(-places) : "";
  return `${negative && rounded !== 0n ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Truncates (toward zero) to `places` decimals, trailing zeros trimmed. */
export function truncateTo(value: string, places: number): string {
  const m = DECIMAL.exec(value.trim());
  if (!m) return value;
  const frac = (m[3] ?? "").slice(0, places).replace(/0+$/, "");
  return `${m[1] ?? ""}${m[2] ?? "0"}${frac ? `.${frac}` : ""}`;
}

/** (a - b) as a signed decimal string. */
export function diff(a: string, b: string): string {
  return fromScaled(toScaled(a) - toScaled(b));
}

/** ((a - b) / b) * 100 rounded to `places` decimals, signed; null when b is zero. */
export function percentOver(a: string, b: string, places = 2): string | null {
  const base = toScaled(b);
  if (base === 0n) return null;
  const pct = ((toScaled(a) - base) * 100n * SCALE_FACTOR) / base;
  return roundTo(pct, places);
}

/** value * (100 - pct) / 100: the price a limit order sits `pct` percent below `value`. */
export function belowBy(value: string, pct: string): string {
  const v = toScaled(value);
  const p = toScaled(pct);
  return fromScaled((v * (100n * SCALE_FACTOR - p)) / (100n * SCALE_FACTOR));
}

/** A fraction string ("0.015") as a percent string ("1.5"). */
export function fractionToPercent(fraction: string): string {
  return fromScaled(toScaled(fraction) * 100n);
}

export function compare(a: string, b: string): number {
  const x = toScaled(a);
  const y = toScaled(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** amount * (1 - fraction), floored to the token's decimals (how a minimum received is derived). */
export function applySlippageFloor(amount: string, fraction: string, decimals: number): string {
  const kept = (toScaled(amount) * (SCALE_FACTOR - toScaled(fraction))) / SCALE_FACTOR;
  return truncateTo(fromScaled(kept < 0n ? 0n : kept), decimals);
}

/** Keeps a limit price readable: 2 decimals from $1 up, otherwise 4 significant digits below. */
export function tidyPrice(value: string): string {
  const m = DECIMAL.exec(value);
  if (!m) return value;
  if ((m[2] ?? "0") !== "0") return truncateTo(value, 2);
  const frac = m[3] ?? "";
  const lead = frac.length - frac.replace(/^0+/, "").length;
  return truncateTo(value, lead + 4);
}
