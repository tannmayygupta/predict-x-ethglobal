import { GTC_DEADLINE_THRESHOLD, type FlashQuoteRequest, type FlashQuoteResponse } from "@predictx/shared";
import { z } from "zod";
import { clampDecimals, divideDecimal, isPositiveDecimal, minAfterSlippage } from "./flash.decimal";

/** USDC has 6 decimals; notional figures are USD and need no more. */
export const USDC_DECIMALS = 6;
const PRICE_DECIMALS = 8;
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;
const GTC_THRESHOLD = BigInt(GTC_DEADLINE_THRESHOLD);

export type QuoteFactors = Pick<
  FlashQuoteResponse,
  | "recommendedSlippage"
  | "slippage"
  | "spendUsd"
  | "receiveUsd"
  | "minReceive"
  | "effectivePriceUsd"
  | "marketPriceUsd"
  | "limitPriceUsd"
  | "orderDeadline"
>;

export interface FactorInput {
  request: FlashQuoteRequest;
  /** Already clamped to USDC / token decimals. */
  spendAmount: string;
  receiveAmount: string;
  tokenDecimals: number;
  spendNotional: string | null | undefined;
  receiveNotional: string | null | undefined;
  recommendedSlippage: string | null | undefined;
  orderTypedData: string;
}

const Deadline = z.object({ message: z.object({ deadline: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]) }) });

/** Flash's good-till-cancelled sentinel (2^48-1) and a missing field both mean "no deadline" (null). */
export function orderDeadlineOf(orderTypedData: string): number | null {
  let json: unknown;
  try {
    json = JSON.parse(orderTypedData);
  } catch {
    return null;
  }
  const parsed = Deadline.safeParse(json);
  if (!parsed.success) return null;
  const deadline = BigInt(parsed.data.message.deadline);
  return deadline >= GTC_THRESHOLD ? null : Number(deadline);
}

function usdOrNull(value: string | null | undefined): string | null {
  return value && PLAIN_DECIMAL.test(value) ? clampDecimals(value, USDC_DECIMALS) : null;
}

/** price = value / amount, or null when the amount is zero (a quote can legitimately be tiny, never divide blindly). */
function priceOf(value: string | null, amount: string): string | null {
  return value !== null && isPositiveDecimal(amount) ? divideDecimal(value, amount, PRICE_DECIMALS) : null;
}

/**
 * The quote factors the UI shows (API_CONTRACT section 6), all on bigint decimals. Shared by the real
 * mapper and the mock so both emit the same keys the same way. Real cost of a market order is
 * from.notional - to.notional: Flash reports a zero fee and embeds gas in the rate.
 */
export function deriveQuoteFactors(input: FactorInput): QuoteFactors {
  const { request } = input;
  const isMarket = request.orderType === "market";
  const spendUsd = usdOrNull(input.spendNotional);
  const receiveUsd = usdOrNull(input.receiveNotional);
  const recommended = input.recommendedSlippage;
  return {
    // Flash's recommendation ignores the maxSlippage we send and is meaningless for limit orders.
    recommendedSlippage: isMarket && recommended && PLAIN_DECIMAL.test(recommended) ? recommended : null,
    slippage: isMarket ? request.slippage : null,
    spendUsd,
    receiveUsd,
    minReceive: isMarket ? minAfterSlippage(input.receiveAmount, request.slippage, input.tokenDecimals) : input.receiveAmount,
    effectivePriceUsd: priceOf(input.spendAmount, input.receiveAmount),
    marketPriceUsd: isMarket ? priceOf(receiveUsd, input.receiveAmount) : null,
    limitPriceUsd: isMarket ? null : (request.limitPriceUsd ?? null),
    orderDeadline: orderDeadlineOf(input.orderTypedData),
  };
}
