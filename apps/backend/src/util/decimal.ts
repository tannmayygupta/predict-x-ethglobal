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
