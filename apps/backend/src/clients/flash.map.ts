import {
  CHAINS,
  FLASH_BASE_ASSETS,
  type FlashOrderDetail,
  type FlashOrderRequest,
  type FlashQuoteRequest,
  type FlashQuoteResponse,
  type OrderStatus,
  type Token,
} from "@predictx/shared";
import {
  FlashError,
  QUOTE_TTL_SECONDS,
  type FlashOrderBody,
  type FlashQuoteBody,
  type FlashQuoteInput,
  type FlashStatusInput,
  type RawFlashOrder,
  type RawFlashQuote,
  type StoredFlashQuote,
} from "./flash.types";
import { numberToDecimalString } from "../util/decimal";
import { clampDecimals } from "./flash.decimal";
import { USDC_DECIMALS, deriveQuoteFactors } from "./flash.factors";

/** The MVP spends USDC only (D-002); Flash reports the spent leg as `from` without a symbol. */
const SPEND_SYMBOL = "USDC";
const MS_PER_SECOND = 1000;
/** Allowlist tokens that Flash trades all carry decimals; this only satisfies the nullable type. */
const DEFAULT_TOKEN_DECIMALS = 18;

/** Our /flash/quote request to Flash's POST /quote body (API_CONTRACT section 6, corrected by docs/notes). */
export function toFlashQuoteBody(request: FlashQuoteRequest, token: Token): FlashQuoteBody {
  if (token.address === null) {
    // Routes reject non-Flash tokens with UNSUPPORTED_TOKEN before reaching here; this guards the type only.
    throw new FlashError(`${token.symbol} has no Flash asset address`);
  }
  const body: FlashQuoteBody = {
    targetChain: CHAINS.BASE_MAINNET.flashName,
    contraChain: CHAINS.BASE_MAINNET.flashName,
    targetAsset: token.address,
    contraAsset: FLASH_BASE_ASSETS.USDC,
    side: request.side,
    qty: request.amount,
    orderType: request.orderType,
    funderAddress: request.walletAddress,
  };
  // GATE0: confirm. Docs: maxSlippage is a market-order parameter (limit orders use maxPriceImpact), and
  // "only market rejects a limit price outright", so each key is sent for exactly one order type.
  if (request.orderType === "market") body.maxSlippage = request.slippage;
  if (request.orderType === "limit" && request.limitPriceUsd) body.limitNotionalPrice = request.limitPriceUsd;
  // expireTime is limit-only for the same reason; the service has already checked the window.
  if (request.orderType === "limit" && request.expireAt != null) {
    body.expireTime = new Date(request.expireAt * MS_PER_SECOND).toISOString();
  }
  return body;
}

/** Flash sends `""` (and may send null) when Permit2 is unused; the contract says null (notes section 3.2). */
function presentOrNull(value: string | null | undefined): string | null {
  return value ? value : null;
}

/**
 * The contract allows only a plain, non-negative decimal here. Flash can print a tiny impact in exponent form
 * ("3.4e-7") or a favourable fill as a negative number; either would fail response validation and turn a good quote
 * into an error. Exponent form is expanded, a favourable (negative) impact is shown as zero, and a value that is
 * not a number at all becomes null, which the contract allows.
 */
export function plainPriceImpact(value: string | null): string | null {
  if (value === null || /^\d+(\.\d+)?$/.test(value)) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n <= 0 ? "0" : numberToDecimalString(n);
}

const EXPONENT_FORM = /^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/;

/**
 * Flash may print a tiny amount as "1e-7". The digits are shifted as text, so the value stays exact and never
 * passes through a float; anything that is neither plain nor exponent form is left for the caller to reject.
 */
function expandExponent(value: string): string {
  const match = EXPONENT_FORM.exec(value);
  if (!match) return value;
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  const exponent = Number(match[3]);
  const digits = whole + fraction;
  const pointIndex = whole.length + exponent;
  if (pointIndex <= 0) return `0.${"0".repeat(-pointIndex)}${digits}`;
  if (pointIndex >= digits.length) return digits + "0".repeat(pointIndex - digits.length);
  return `${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`;
}

/** Flash prints amounts with 36+ decimals; a token has its own, and the contract stores what a wallet can use. */
function clampAmount(value: string, decimals: number): string {
  try {
    return clampDecimals(expandExponent(value), decimals);
  } catch {
    throw new FlashError("flash quote has an unreadable amount");
  }
}

/** Flash's quote response into our FlashQuoteResponse; typed-data strings pass through untouched (RULES 4.4). */
export function fromFlashQuote(raw: RawFlashQuote, input: FlashQuoteInput, now: number): FlashQuoteResponse {
  const orderTypedData = presentOrNull(raw.evm?.orderTypedData);
  if (orderTypedData === null) {
    // Flash returns an empty payload when funderAddress was omitted; without it nothing can be signed.
    throw new FlashError("flash quote has no orderTypedData");
  }
  const tokenDecimals = input.token.decimals ?? DEFAULT_TOKEN_DECIMALS;
  const spendAmount = clampAmount(raw.from.amount, USDC_DECIMALS);
  const receiveAmount = clampAmount(raw.to.amount, tokenDecimals);
  return {
    quoteId: raw.quoteId,
    // Flash has no expiry field; API_CONTRACT section 6 fixes ours at quote time + 60 s.
    expiresAt: now + QUOTE_TTL_SECONDS,
    orderType: input.request.orderType,
    side: input.request.side,
    chain: CHAINS.BASE_MAINNET.flashName,
    chainId: CHAINS.BASE_MAINNET.id,
    spend: { symbol: SPEND_SYMBOL, amount: spendAmount },
    receive: { symbol: input.token.symbol, amount: receiveAmount },
    feesUsd: raw.fees.estimatedFeeNotional,
    estimatedPriceImpact: plainPriceImpact(raw.estimatedPriceImpact),
    ...deriveQuoteFactors({
      request: input.request,
      spendAmount,
      receiveAmount,
      tokenDecimals,
      spendNotional: raw.from.notional,
      receiveNotional: raw.to.notional,
      recommendedSlippage: raw.recommendedSlippage,
      orderTypedData,
    }),
    steps: {
      approveTx: raw.evm?.approveTx ?? null,
      permitTypedData: presentOrNull(raw.evm?.permitTypedData),
      orderTypedData,
    },
  };
}

/**
 * Our /flash/order request into Flash's POST /order body: Flash wants the original trade fields back
 * alongside the signature, and the typed data echoed byte-for-byte (notes section 4.1, RULES 4.4).
 */
export function toFlashOrderBody(stored: StoredFlashQuote, order: FlashOrderRequest): FlashOrderBody {
  const body: FlashOrderBody = {
    ...stored.body,
    quoteId: stored.quoteId,
    userSignature: order.orderSignature,
    evmOrderTypedData: stored.rawTypedData.orderTypedData,
  };
  const permitTypedData = stored.rawTypedData.permitTypedData;
  if (permitTypedData !== null) {
    if (!order.permitSignature) {
      throw new FlashError("permitSignature is required: the quote returned permit typed data");
    }
    body.evmPermitTypedData = permitTypedData;
    body.evmPermitSignature = order.permitSignature;
  }
  return body;
}

export interface MappedStatus {
  status: OrderStatus;
  error: string | null;
}

/** Flash's eight ORDER_STATUS_* values onto ours (notes section 5.2). GATE0: confirm against real orders. */
const STATUS_BY_FLASH: Record<string, OrderStatus> = {
  ORDER_STATUS_UNSPECIFIED: "submitted",
  ORDER_STATUS_PENDING: "submitted",
  ORDER_STATUS_ACCEPTED: "open",
  ORDER_STATUS_PARTIALLY_FILLED: "open",
  ORDER_STATUS_FILLED: "filled",
  ORDER_STATUS_CANCELLED: "failed",
  ORDER_STATUS_REJECTED: "failed",
  ORDER_STATUS_TERMINATED: "failed",
};

/**
 * GATE0: confirm. The docs do not say which terminal status an unfilled order lands in once its deadline
 * passes, so expiry is detected by closeReason on every failed status rather than by one status value.
 */
const EXPIRED_CLOSE_REASON = "REASON_ORDER_EXPIRED";

const UNKNOWN_STATUS_PREFIX = "unknown flash status: ";

/** Never throws: a status this code has not seen becomes `failed` with the raw value in `error`. */
export function mapFlashStatus(raw: string, closeReason: string | null): MappedStatus {
  const mapped = STATUS_BY_FLASH[raw];
  if (mapped === undefined) return { status: "failed", error: `${UNKNOWN_STATUS_PREFIX}${raw}` };
  if (mapped !== "failed") return { status: mapped, error: null };
  if (closeReason === EXPIRED_CLOSE_REASON) return { status: "expired", error: closeReason };
  return { status: "failed", error: closeReason ?? raw };
}

/**
 * True for the `failed` that mapFlashStatus reports for a status it has not seen: the order may still be live
 * at Flash, so the caller must keep polling it rather than treat it as terminal (D-B3).
 */
export function isUnknownFlashStatus(mapped: MappedStatus): boolean {
  return mapped.status === "failed" && mapped.error !== null && mapped.error.startsWith(UNKNOWN_STATUS_PREFIX);
}

function isoToUnixSeconds(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / MS_PER_SECOND);
}

/** Flash's get-order body into our FlashOrderDetail. GATE0: confirm fill ordering (latest fill assumed last). */
export function fromFlashOrder(raw: RawFlashOrder, input: FlashStatusInput, now: number): FlashOrderDetail {
  const { status, error } = mapFlashStatus(raw.order.status, raw.order.closeReason ?? null);
  const txHashes = raw.fills.map((fill) => fill.transactionId).filter((id): id is string => !!id);
  return {
    orderId: input.orderId,
    status,
    orderType: input.orderType,
    txHash: txHashes.at(-1) ?? null,
    chainId: CHAINS.BASE_MAINNET.id,
    filledAmount: raw.order.filled?.targetAmount ?? null,
    error,
    // The newest of Flash's ISO timestamps; `now` only when it sent none, so polling still shows movement.
    updatedAt:
      isoToUnixSeconds(raw.order.closedAt) ??
      isoToUnixSeconds(raw.order.acceptedAt) ??
      isoToUnixSeconds(raw.order.placedAt) ??
      now,
  };
}
