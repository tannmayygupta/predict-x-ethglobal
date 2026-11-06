/** Display helpers shared by the bet box, the pool page and the home list. Pure; money stays in strings/bigint. */
import { formatUsdc } from "@predictx/shared";

const MIN_BAR_PERCENT = 4; // UI_REFERENCE OddsBar: each side stays visible when both exist
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

export interface Odds {
  hasBets: boolean;
  yesPct: number;
  noPct: number;
  /** Widths for the split bar, in percent. */
  yesBar: number;
  noBar: number;
}

export function oddsOf(yesTotal: string, noTotal: string): Odds {
  const yes = BigInt(yesTotal);
  const no = BigInt(noTotal);
  const total = yes + no;
  if (total === 0n) return { hasBets: false, yesPct: 0, noPct: 0, yesBar: 0, noBar: 0 };
  const yesPct = Number((yes * 100n + total / 2n) / total);
  const noPct = 100 - yesPct;
  if (yes === 0n) return { hasBets: true, yesPct: 0, noPct: 100, yesBar: 0, noBar: 100 };
  if (no === 0n) return { hasBets: true, yesPct: 100, noPct: 0, yesBar: 100, noBar: 0 };
  const yesBar = Math.min(100 - MIN_BAR_PERCENT, Math.max(MIN_BAR_PERCENT, yesPct));
  return { hasBets: true, yesPct, noPct, yesBar, noBar: 100 - yesBar };
}

const two = (n: number): string => String(n).padStart(2, "0");

/** MM:SS under an hour, "Hh Mm" above, "Closed" at zero (UI_REFERENCE Countdown). */
export function formatCountdown(resolveTime: number, now: number): string {
  const left = resolveTime - now;
  if (left <= 0) return "Closed";
  if (left < SECONDS_PER_HOUR) return `${two(Math.floor(left / SECONDS_PER_MINUTE))}:${two(left % SECONDS_PER_MINUTE)}`;
  return `${Math.floor(left / SECONDS_PER_HOUR)}h ${Math.floor((left % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)}m`;
}

/** Whole pool size, "100.00". */
export function poolSize(yesTotal: string, noTotal: string): string {
  return formatUsdc(BigInt(yesTotal) + BigInt(noTotal));
}
