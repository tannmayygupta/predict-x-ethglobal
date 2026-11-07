/** Display formatters for the market card. Strings stay strings; Number is used only inside Intl for display. */
import { roundTo, toScaled } from "./decimal";

export const EM_DASH = "—";

const SCALE_DIGITS = 18;
const CENT = 10n ** 16n;
const SIGNIFICANT_DIGITS = 2;

const COMPACT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "273740000000" -> "$273.74B"; null (a source that failed) renders an em dash. */
export function formatUsdCompact(value: string | null): string {
  if (value === null) return EM_DASH;
  const n = Number(value);
  return Number.isFinite(n) ? COMPACT.format(n) : EM_DASH;
}

/** "10.48" -> "+$10.48", "-44.93" -> "-$44.93". Sub-cent moves keep two significant digits instead of reading $0.00. */
export function formatUsdDelta(value: string | null): string {
  if (value === null) return EM_DASH;
  const scaled = toScaled(value);
  const abs = scaled < 0n ? -scaled : scaled;
  let places = 2;
  if (abs !== 0n && abs < CENT) {
    const leadingZeros = SCALE_DIGITS - abs.toString().length;
    places = Math.min(SCALE_DIGITS, leadingZeros + SIGNIFICANT_DIGITS);
  }
  const rounded = roundTo(scaled, places);
  return rounded.startsWith("-") ? `-$${rounded.slice(1)}` : `+$${rounded}`;
}

/** 0.47 -> "+0.47%", "-1.8" -> "-1.80%". A move that rounds to zero prints "0.00%", never "-0.00%". */
export function formatPctDetail(pct: number | string): string {
  const s = typeof pct === "number" ? pct.toFixed(2) : roundTo(toScaled(pct), 2);
  if (Number(s) === 0) return "0.00%";
  return `${s.startsWith("-") ? "" : "+"}${s}%`;
}

/** True when the move displays as a loss: a number that rounds to 0.00 is not one. */
export function isNegative(value: string | number): boolean {
  if (typeof value === "number") return value < 0 && value.toFixed(2) !== "-0.00";
  return value.startsWith("-") && toScaled(value) !== 0n;
}
