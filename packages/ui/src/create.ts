import { DURATION_PRESETS_SECONDS, MIN_POOL_DURATION_SECONDS, buildQuestion, fromE18, toStrikeE18 } from "@predictx/shared";
import { UiError } from "./errors";

/** Time a wallet confirmation may take before the contract's minimum lead time (120 s) is broken. */
export const CONFIRMATION_BUFFER_SECONDS = 30;
const SECONDS_PER_MINUTE = 60;

export interface CreateInput {
  symbol: string;
  coingeckoId: string;
  direction: "above" | "below";
  /** As typed by the user; canonicalised here. */
  strikeUsd: string;
  durationSeconds: number;
}

export interface PreparedPool {
  question: string;
  coingeckoId: string;
  direction: 0 | 1;
  strikeUsd: string;
  strikeE18: bigint;
  resolveTime: number;
}

/**
 * Turns the form into exactly what is stored onchain. The question shows only HH:MM, so resolveTime is rounded
 * UP to a whole minute: the time in the question is then the real settle time, not a truncated one. Pure, so the
 * preview can call it every few seconds and the submit button sends the very value the user was looking at.
 */
export function prepareCreate(input: CreateInput, nowSeconds: number): PreparedPool {
  if (!(DURATION_PRESETS_SECONDS as readonly number[]).includes(input.durationSeconds)) {
    throw new UiError("BAD_INPUT", "Choose how long the prediction runs.");
  }
  let strikeE18: bigint;
  try {
    strikeE18 = toStrikeE18(input.strikeUsd);
  } catch {
    throw new UiError("BAD_INPUT", "Enter the strike price as a number, for example 2500 or 0.000012.");
  }
  if (strikeE18 === 0n) throw new UiError("BAD_INPUT", "The strike price must be above zero.");
  const earliest = nowSeconds + input.durationSeconds + CONFIRMATION_BUFFER_SECONDS;
  const resolveTime = Math.ceil(earliest / SECONDS_PER_MINUTE) * SECONDS_PER_MINUTE;
  if (resolveTime - nowSeconds < MIN_POOL_DURATION_SECONDS) throw new UiError("BAD_INPUT", "That prediction would close too soon.");
  const strikeUsd = fromE18(strikeE18); // canonical, so the stored question equals what the API later returns
  let question: string;
  try {
    question = buildQuestion({ symbol: input.symbol, direction: input.direction, strikeUsd, resolveTime });
  } catch {
    throw new UiError("BAD_INPUT", "The question is too long. Use a shorter strike price.");
  }
  return {
    question,
    coingeckoId: input.coingeckoId,
    direction: input.direction === "above" ? 0 : 1,
    strikeUsd,
    strikeE18,
    resolveTime,
  };
}
