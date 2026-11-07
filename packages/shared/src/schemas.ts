import { z } from "zod";
import { MAX_CHART_POINTS } from "./constants";

/* ---------- primitives ---------- */
export const Address = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "invalid address");
export const Hex = z.string().regex(/^0x[0-9a-fA-F]*$/, "invalid hex");
/** (0, 1] decided on the digits, so "0.0000000000000000001" is positive and "1.0000000000000000001" is over. */
function isSlippageInRange(value: string): boolean {
  const [whole = "", frac = ""] = value.split(".");
  const wholeDigits = whole.replace(/^0+/, "");
  const fracDigits = frac.replace(/0+$/, "");
  if (wholeDigits === "") return fracDigits !== "";
  return wholeDigits === "1" && fracDigits === "";
}

/** Decimal string, e.g. "2451.12" or "0.0000120". */
export const DecimalString = z.string().regex(/^\d+(\.\d+)?$/, "invalid decimal");
/** Integer string in base units, e.g. USDC "60000000". */
/** Like DecimalString but allows a leading minus, for signed changes such as the 24h USD move. */
export const SignedDecimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "invalid signed decimal");
export const BaseUnits = z.string().regex(/^\d+$/, "invalid base units");
export const UnixSeconds = z.number().int().nonnegative();

/* ---------- errors ---------- */
export const ErrorCode = z.enum([
  "BAD_REQUEST",
  "UNSUPPORTED_TOKEN",
  "NOT_FOUND",
  "QUOTE_EXPIRED",
  "RATE_LIMITED",
  "FLASH_ERROR",
  "LLM_UNAVAILABLE",
  "INTERNAL",
]);
export const ApiError = z.object({
  error: z.object({ code: ErrorCode, message: z.string() }),
});
export type ApiError = z.infer<typeof ApiError>;

/* ---------- tokens & market ---------- */
export const TokenNetwork = z.enum(["ethereum", "base", "bitcoin"]);
export type TokenNetwork = z.infer<typeof TokenNetwork>;
/** Where CoinGecko's onchain endpoint finds the token's pools (liquidity lookup). */
export const TokenOnchain = z.object({ network: z.string().min(1), address: Address });
export type TokenOnchain = z.infer<typeof TokenOnchain>;

export const Token = z.object({
  symbol: z.string().min(1).max(12),
  name: z.string(),
  coingeckoId: z.string(),
  flashChainId: z.number().int().nullable(),
  address: Address.nullable(),
  decimals: z.number().int().nullable(),
  flashSupported: z.boolean(),
  network: TokenNetwork.optional(),
  onchain: TokenOnchain.nullable().optional(),
});
export type Token = z.infer<typeof Token>;
export const TokensResponse = z.object({ tokens: z.array(Token).max(10) });

export const Market = z.object({
  symbol: z.string(),
  name: z.string(),
  address: Address.nullable(),
  flashChainId: z.number().int().nullable(),
  priceUsd: DecimalString,
  change24hPct: z.number(),
  updatedAt: UnixSeconds,
  // New keys default to null/false so rows stored before the change still parse.
  // The backend must always emit them: the response hook does not apply defaults.
  change24hUsd: SignedDecimalString.nullable().default(null),
  marketCapUsd: DecimalString.nullable().default(null),
  volume24hUsd: DecimalString.nullable().default(null),
  high24hUsd: DecimalString.nullable().default(null),
  low24hUsd: DecimalString.nullable().default(null),
  liquidityUsd: DecimalString.nullable().default(null),
  /** True when the token is Flash-tradable on the allowlist with a pinned contract address. */
  verified: z.boolean().default(false),
});
export type Market = z.infer<typeof Market>;

/* ---------- chart ---------- */
export const ChartRange = z.enum(["24h", "7d"]);
export type ChartRange = z.infer<typeof ChartRange>;
/** [unix seconds, price as decimal string] */
export const ChartPoint = z.tuple([UnixSeconds, DecimalString]);
export type ChartPoint = z.infer<typeof ChartPoint>;
export const MarketChart = z.object({
  symbol: z.string(),
  range: ChartRange,
  points: z.array(ChartPoint).min(2).max(MAX_CHART_POINTS),
  openUsd: DecimalString,
  lowUsd: DecimalString,
  highUsd: DecimalString,
  updatedAt: UnixSeconds,
});
export type MarketChart = z.infer<typeof MarketChart>;
export const MarketChartQuery = z.object({ range: ChartRange.default("24h") });

/* ---------- insight ---------- */
export const InsightRequest = z.object({
  symbol: z.string().min(1).max(12),
  userIntent: z.string().max(200).optional(),
});
export type InsightRequest = z.infer<typeof InsightRequest>;

export const InsightResponse = z.object({
  symbol: z.string(),
  tip: z.string().max(400),
  bias: z.enum(["bullish", "bearish", "neutral"]),
  confidence: z.enum(["low", "medium", "high"]),
  suggestedLimit: z
    .object({ side: z.literal("buy"), priceUsd: DecimalString, reason: z.string().max(160) })
    .nullable(),
  degraded: z.boolean(),
  disclaimer: z.string(),
  // Filled by the service, never written by the model.
  spotUsd: DecimalString.nullable().default(null),
  asOf: UnixSeconds.nullable().default(null),
});
export type InsightResponse = z.infer<typeof InsightResponse>;

/* ---------- flash ---------- */
export const OrderType = z.enum(["market", "limit"]);
export const FlashQuoteRequest = z
  .object({
    walletAddress: Address,
    symbol: z.string(),
    side: z.literal("buy"), // MVP: buy only (spend USDC, receive token)
    orderType: OrderType,
    amount: DecimalString, // USDC to spend
    limitPriceUsd: DecimalString.nullable().optional(),
    slippage: DecimalString.default("0.01"),
    /** Limit orders only: unix seconds. Backend checks 60 s .. 30 d from now. */
    expireAt: UnixSeconds.nullable().optional(),
  })
  .refine((v) => v.orderType !== "limit" || !!v.limitPriceUsd, {
    message: "limitPriceUsd is required for limit orders",
    path: ["limitPriceUsd"],
  })
  .refine((v) => v.expireAt == null || v.orderType === "limit", {
    // Flash answers 400 if a market order carries expireTime.
    message: "expireAt is only valid for limit orders",
    path: ["expireAt"],
  })
  .refine((v) => isSlippageInRange(v.slippage), {
    message: "slippage must be greater than 0 and at most 1",
    path: ["slippage"],
  });
export type FlashQuoteRequest = z.infer<typeof FlashQuoteRequest>;

export const FlashQuoteResponse = z.object({
  quoteId: z.string(),
  expiresAt: UnixSeconds,
  orderType: OrderType,
  side: z.literal("buy"),
  chain: z.literal("base"),
  chainId: z.literal(8453),
  spend: z.object({ symbol: z.string(), amount: DecimalString }),
  receive: z.object({ symbol: z.string(), amount: DecimalString }),
  feesUsd: DecimalString,
  estimatedPriceImpact: DecimalString.nullable(),
  // Quote factors. All default to null so stored quotes from before the change still parse.
  recommendedSlippage: DecimalString.nullable().default(null),
  slippage: DecimalString.nullable().default(null),
  spendUsd: DecimalString.nullable().default(null),
  receiveUsd: DecimalString.nullable().default(null),
  minReceive: DecimalString.nullable().default(null),
  effectivePriceUsd: DecimalString.nullable().default(null),
  marketPriceUsd: DecimalString.nullable().default(null),
  limitPriceUsd: DecimalString.nullable().default(null),
  /** From the order typed data deadline; null when absent or good-till-cancelled. */
  orderDeadline: UnixSeconds.nullable().default(null),
  steps: z.object({
    approveTx: z.object({ to: Address, data: Hex }).nullable(),
    permitTypedData: z.string().nullable(), // JSON string, sign with eth_signTypedData_v4
    orderTypedData: z.string(), // JSON string, sign with eth_signTypedData_v4
  }),
});
export type FlashQuoteResponse = z.infer<typeof FlashQuoteResponse>;

export const FlashOrderRequest = z.object({
  quoteId: z.string(),
  walletAddress: Address,
  orderSignature: Hex,
  permitSignature: Hex.nullable().optional(),
});
export type FlashOrderRequest = z.infer<typeof FlashOrderRequest>;

export const OrderStatus = z.enum(["submitted", "open", "filled", "failed", "expired"]);
export type OrderStatus = z.infer<typeof OrderStatus>;
export const FlashOrderResponse = z.object({ orderId: z.string(), status: z.literal("submitted") });
export const FlashOrderDetail = z.object({
  orderId: z.string(),
  status: OrderStatus,
  orderType: OrderType,
  txHash: Hex.nullable(),
  chainId: z.number().int(),
  filledAmount: DecimalString.nullable(),
  error: z.string().nullable(),
  updatedAt: UnixSeconds,
});
export type FlashOrderDetail = z.infer<typeof FlashOrderDetail>;

/* ---------- pools ---------- */
export const PoolStatus = z.enum(["open", "awaiting", "resolved", "void"]);
export type PoolStatus = z.infer<typeof PoolStatus>;
export const Pool = z.object({
  id: z.number().int().nonnegative(),
  chainId: z.number().int(),
  contract: Address,
  question: z.string().max(140),
  symbol: z.string(),
  coingeckoId: z.string(),
  direction: z.enum(["above", "below"]),
  strikeUsd: DecimalString,
  resolveTime: UnixSeconds,
  createdAt: UnixSeconds,
  yesTotal: BaseUnits,
  noTotal: BaseUnits,
  status: PoolStatus,
  outcome: z.enum(["yes", "no"]).nullable(),
  resolvedPriceUsd: DecimalString.nullable(),
  feeBps: z.number().int(),
  creator: Address,
  dashboardUrl: z.string().url(),
});
export type Pool = z.infer<typeof Pool>;
export const PoolsResponse = z.object({ pools: z.array(Pool).max(20) });

export const Position = z.object({
  poolId: z.number().int().nonnegative(),
  address: Address,
  yesStake: BaseUnits,
  noStake: BaseUnits,
  claimable: BaseUnits,
  claimed: z.boolean(),
  refundable: BaseUnits,
});
export type Position = z.infer<typeof Position>;
