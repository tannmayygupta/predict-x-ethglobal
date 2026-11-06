import { z } from "zod";

/* ---------- primitives ---------- */
export const Address = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "invalid address");
export const Hex = z.string().regex(/^0x[0-9a-fA-F]*$/, "invalid hex");
/** Decimal string, e.g. "2451.12" or "0.0000120". */
export const DecimalString = z.string().regex(/^\d+(\.\d+)?$/, "invalid decimal");
/** Integer string in base units, e.g. USDC "60000000". */
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
export const Token = z.object({
  symbol: z.string().min(1).max(12),
  name: z.string(),
  coingeckoId: z.string(),
  flashChainId: z.number().int().nullable(),
  address: Address.nullable(),
  decimals: z.number().int().nullable(),
  flashSupported: z.boolean(),
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
});
export type Market = z.infer<typeof Market>;

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
  })
  .refine((v) => v.orderType !== "limit" || !!v.limitPriceUsd, {
    message: "limitPriceUsd is required for limit orders",
    path: ["limitPriceUsd"],
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
