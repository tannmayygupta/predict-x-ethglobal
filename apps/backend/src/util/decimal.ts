/**
 * Formats a CoinGecko price (JSON number) as a DecimalString. String(n) is the shortest
 * round-trip form, but JS writes exponent notation below 1e-6 and from 1e21, which the
 * shared DecimalString regex rejects and which no wallet user should ever see.
 */
export function numberToDecimalString(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`no decimal string for ${value}`);
  const text = String(value);
  const [mantissa, exponentText] = text.split("e");
  if (mantissa === undefined || exponentText === undefined) return text;
  const exponent = Number(exponentText);
  const [whole = "", fraction = ""] = mantissa.split(".");
  // The mantissa always carries one leading digit, so the point sits after `whole` before shifting.
  const digits = whole + fraction;
  const pointIndex = whole.length + exponent;
  if (pointIndex <= 0) return `0.${"0".repeat(-pointIndex)}${digits}`;
  if (pointIndex >= digits.length) return digits + "0".repeat(pointIndex - digits.length);
  return `${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`;
}

const SIGNIFICANT_DIGITS = 7;

/** Chart prices keep 7 significant digits: enough for a PEPE-scale line, and it keeps the payload small. */
export function toSignificantDecimalString(value: number, digits = SIGNIFICANT_DIGITS): string {
  return numberToDecimalString(Number(value.toPrecision(digits)));
}

const PCT_SCALE = 1_000_000;
const PCT_BASE = 100n * BigInt(PCT_SCALE);
const CHANGE_DECIMALS = 2;
/** A sub-cent move keeps this many significant digits so a PEPE-scale price does not read as no move. */
const MIN_SIGNIFICANT_DIGITS = 2;
const MAX_CHANGE_DECIMALS = 18;
const TEN = 10n;

/**
 * The USD move over the window behind a percentage change: price * pct / (100 + pct), on bigint so the
 * price never passes through a float (RULES 3.2). Signed, rounded half away from zero to cents, or, below one
 * cent, to two significant digits; a move that rounds to nothing prints "0.00", never "-0.00". Null when the
 * inputs cannot produce a move.
 */
export function signedChangeUsd(priceUsd: string, changePct: number): string | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(priceUsd);
  if (!match || !Number.isFinite(changePct)) return null;
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  const pct = BigInt(Math.round(changePct * PCT_SCALE));
  const denominator = PCT_BASE + pct;
  if (denominator <= 0n) return null;
  const numerator = BigInt(whole + fraction) * pct;
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  // The move is magnitude / divisor exactly.
  const divisor = denominator * TEN ** BigInt(fraction.length);
  let decimals = CHANGE_DECIMALS;
  if (magnitude !== 0n && magnitude * TEN ** BigInt(CHANGE_DECIMALS) < divisor) {
    // Below one cent: find the first non-zero digit, then keep two significant digits from there.
    let leadingZeros = CHANGE_DECIMALS;
    while (leadingZeros < MAX_CHANGE_DECIMALS && magnitude * TEN ** BigInt(leadingZeros + 1) < divisor) leadingZeros += 1;
    decimals = Math.min(MAX_CHANGE_DECIMALS, leadingZeros + MIN_SIGNIFICANT_DIGITS);
  }
  const scaled = (magnitude * TEN ** BigInt(decimals) * 2n + divisor) / (divisor * 2n);
  const digits = scaled.toString().padStart(decimals + 1, "0");
  const text = `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
  return negative && scaled !== 0n ? `-${text}` : text;
}

const PLAIN = /^(\d+)(?:\.(\d+))?$/;

/** Orders two plain non-negative decimal strings exactly (-1, 0, 1); no float involved (RULES 3.2). */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const left = PLAIN.exec(a);
  const right = PLAIN.exec(b);
  if (!left || !right) throw new RangeError(`not a plain decimal: ${left ? b : a}`);
  const scale = Math.max((left[2] ?? "").length, (right[2] ?? "").length);
  const x = BigInt((left[1] ?? "0") + (left[2] ?? "").padEnd(scale, "0"));
  const y = BigInt((right[1] ?? "0") + (right[2] ?? "").padEnd(scale, "0"));
  return x === y ? 0 : x < y ? -1 : 1;
}
