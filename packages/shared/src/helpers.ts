import { MAX_QUESTION_LENGTH } from "./constants";
import type { PoolStatus } from "./schemas";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "0.0000120" -> 12000000000000n (18 decimals). Throws on bad input. */
export function toStrikeE18(usd: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(usd.trim());
  if (!m) throw new Error("Invalid price");
  return BigInt(m[1] + (m[2] ?? "").padEnd(18, "0"));
}

/** 12000000000000n -> "0.000012" (trailing zeros trimmed). */
export function fromE18(value: bigint): string {
  const s = value.toString().padStart(19, "0");
  const whole = s.slice(0, -18);
  const frac = s.slice(-18).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** "2.5" -> 2500000n (USDC, 6 decimals). */
export function toUsdcUnits(amount: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(amount.trim());
  if (!m) throw new Error("Invalid USDC amount");
  return BigInt(m[1] + (m[2] ?? "").padEnd(6, "0"));
}

/** 60000000 -> "60.00" (display only). */
export function formatUsdc(units: string | bigint): string {
  const v = BigInt(units);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${whole}.${frac}`;
}

export interface QuestionInput {
  symbol: string;
  direction: "above" | "below";
  strikeUsd: string;
  resolveTime: number; // unix seconds
}

/** The exact question string stored onchain and shown everywhere. */
export function buildQuestion(i: QuestionInput): string {
  const d = new Date(i.resolveTime * 1000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const q = `Will $${i.symbol} be ${i.direction} $${i.strikeUsd} at ${hh}:${mm} UTC on ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}?`;
  if (q.length > MAX_QUESTION_LENGTH) throw new Error("Question too long");
  return q;
}

/** Text for the X composer. The marker PX#<id> and the link are both included on purpose. */
export function buildTweetText(p: { id: number; question: string; dashboardUrl: string }): string {
  const text = `${p.question}\n\nBet YES or NO: ${p.dashboardUrl}\nPX#${p.id}`;
  const counted = text.replace(p.dashboardUrl, "x".repeat(23)); // X counts any URL as 23 chars
  if (counted.length > 280) throw new Error("Post text too long");
  return text;
}

/** Find a pool id in tweet text: marker first, then a /pool/<id> link. */
export function extractPoolId(text: string): number | null {
  const marker = /PX#(\d+)/.exec(text);
  if (marker?.[1]) return Number(marker[1]);
  const link = /\/pool\/(\d+)/.exec(text);
  return link?.[1] ? Number(link[1]) : null;
}

export function derivePoolStatus(i: {
  now: number;
  resolveTime: number;
  resolved: boolean;
  yesTotal: string;
  noTotal: string;
}): PoolStatus {
  if (i.resolved) return BigInt(i.yesTotal) === 0n || BigInt(i.noTotal) === 0n ? "void" : "resolved";
  return i.now < i.resolveTime ? "open" : "awaiting";
}

/** Winner payout: stake * (total - fee) / winningTotal. All values in base units. */
export function computePayout(stake: bigint, winningTotal: bigint, losingTotal: bigint, feeBps: number): bigint {
  if (winningTotal === 0n) return 0n;
  const total = winningTotal + losingTotal;
  const fee = (total * BigInt(feeBps)) / 10_000n;
  return (stake * (total - fee)) / winningTotal;
}
