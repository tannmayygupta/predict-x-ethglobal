import {
  FlashQuoteResponse,
  MAX_FLASH_TRADE_USD,
  MAX_LIMIT_EXPIRY_SECONDS,
  MIN_LIMIT_EXPIRY_SECONDS,
  toUsdcUnits,
  type FlashOrderDetail,
  type FlashOrderRequest,
  type FlashQuoteRequest,
  type OrderStatus,
  type Token,
} from "@predictx/shared";
import { isUnknownFlashStatus } from "../clients/flash.map";
import {
  FlashError,
  FlashNotFoundError,
  FlashUnknownQuoteError,
  type FlashClient,
  type FlashOrderResponse,
} from "../clients/flash.types";
import type { OrdersRepo } from "../db/orders";
import type { QuotesRepo, StoredQuote } from "../db/quotes";
import { badRequest, flashError, internal, notFound, quoteExpired, unsupportedToken } from "../errors";
import type { Clock } from "../util/clock";
import { requireToken } from "./tokens";

export interface FlashServiceDeps {
  flash: FlashClient;
  clock: Clock;
  quotes: QuotesRepo;
  orders: OrdersRepo;
  /** False means real orders are refused before any quote is read or spent; quotes still work. */
  ordersEnabled: boolean;
}

/** The subset of a pino logger the service needs; keeps services free of Fastify types. */
export interface FlashLog {
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export const ORDERS_DISABLED_MESSAGE = "Orders are disabled on this server. Quotes only (FLASH_ORDERS_ENABLED=false).";

/** D-B3: once an order can no longer change, polling it must not spend Flash's 5 req/s budget. */
const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>(["filled", "failed", "expired"]);

/** API_CONTRACT section 1: UNSUPPORTED_TOKEN also covers allowlist tokens Flash cannot trade (BTC, PEPE). */
function requireFlashToken(symbol: string): Token {
  const token = requireToken(symbol);
  if (!token.flashSupported || token.address === null) {
    throw unsupportedToken(`Unsupported token: ${symbol} is not tradable on Flash`);
  }
  return token;
}

/** RULES 2.8: the cap is compared in USDC base units so "5.00" and "5" are the same amount (no float). */
const MAX_TRADE_UNITS = toUsdcUnits(String(MAX_FLASH_TRADE_USD));

function requireSpendableAmount(amount: string): void {
  let units: bigint;
  try {
    units = toUsdcUnits(amount);
  } catch {
    throw badRequest(`amount: must have at most 6 decimals (USDC base units), got ${amount}`);
  }
  if (units === 0n) throw badRequest("amount: must be greater than 0");
  if (units > MAX_TRADE_UNITS) {
    throw badRequest(`amount: exceeds the maximum of ${MAX_FLASH_TRADE_USD} USDC per order (MAX_FLASH_TRADE_USD)`);
  }
}

/**
 * A zero limit price can never fill and would make a price division blow up downstream, so it is rejected
 * here. The schema already guarantees digits with an optional fraction; the check stays on digits (no float).
 */
function requirePositiveLimitPrice(request: FlashQuoteRequest): void {
  if (request.orderType !== "limit" || !request.limitPriceUsd) return;
  if (BigInt(request.limitPriceUsd.replace(".", "")) === 0n) {
    throw badRequest("limitPriceUsd: must be greater than 0");
  }
}

/** 0 < slippage <= 1, compared on digits so "1.0" and "1" are the same bound (no float). */
function requireSlippageInRange(slippage: string): void {
  const [whole = "0", fraction = ""] = slippage.split(".");
  const units = BigInt(whole + fraction);
  if (units === 0n || units > 10n ** BigInt(fraction.length)) {
    throw badRequest("slippage: must be greater than 0 and at most 1");
  }
}

/** Flash answers 400 to expireTime on a market order, and an expiry too near or too far is never what the user meant. */
function requireExpiryWindow(request: FlashQuoteRequest, now: number): void {
  if (request.expireAt == null) return;
  if (request.orderType !== "limit") throw badRequest("expireAt: only valid for limit orders");
  const secondsAhead = request.expireAt - now;
  if (secondsAhead < MIN_LIMIT_EXPIRY_SECONDS || secondsAhead > MAX_LIMIT_EXPIRY_SECONDS) {
    throw badRequest(`expireAt: must be between ${MIN_LIMIT_EXPIRY_SECONDS} seconds and 30 days from now`);
  }
}

/** Adapter errors are mapped here, explicitly; anything else stays a 500 (the subclass check comes first). */
function mapFlashError(err: unknown): never {
  if (err instanceof FlashNotFoundError) throw notFound(err.message);
  if (err instanceof FlashUnknownQuoteError) throw quoteExpired(err.message);
  if (err instanceof FlashError) throw flashError(err.message);
  throw err;
}

/** The quote, order and status flows of API_CONTRACT section 2 (#5 to #7) on top of the Flash adapter. */
export class FlashService {
  constructor(
    private readonly deps: FlashServiceDeps,
    private readonly log?: FlashLog,
  ) {}

  async quote(request: FlashQuoteRequest): Promise<FlashQuoteResponse> {
    const token = requireFlashToken(request.symbol);
    requireSpendableAmount(request.amount);
    requirePositiveLimitPrice(request);
    requireSlippageInRange(request.slippage);
    requireExpiryWindow(request, this.deps.clock.now());
    const quoted = await this.deps.flash.quote({ request, token }).catch(mapFlashError);
    const response = this.requireValidQuote(quoted);
    // The typed data is kept as Flash sent it; /flash/order echoes these strings byte-for-byte (RULES 4.4).
    this.deps.quotes.insert({
      quoteId: response.quoteId,
      walletAddress: request.walletAddress,
      symbol: token.symbol,
      orderType: response.orderType,
      expiresAt: response.expiresAt,
      response,
      rawTypedData: { orderTypedData: response.steps.orderTypedData, permitTypedData: response.steps.permitTypedData },
      createdAt: this.deps.clock.now(),
    });
    return response;
  }

  /** A quote the contract rejects is never stored: /flash/order would otherwise read a row it cannot parse. */
  private requireValidQuote(quoted: FlashQuoteResponse): FlashQuoteResponse {
    const result = FlashQuoteResponse.safeParse(quoted);
    if (result.success) return result.data;
    this.log?.error({ issues: result.error.issues }, "flash quote failed contract validation");
    throw internal("flash returned a quote outside the contract");
  }

  async order(request: FlashOrderRequest): Promise<FlashOrderResponse> {
    // Checked first so a refused order never reads, marks or spends a quote.
    if (!this.deps.ordersEnabled) throw flashError(ORDERS_DISABLED_MESSAGE);
    const stored = this.deps.quotes.get(request.quoteId);
    // API_CONTRACT section 1: a missing quote is QUOTE_EXPIRED, so the client simply requests a new one.
    if (!stored) throw quoteExpired(`quote ${request.quoteId} is unknown or expired; request a new quote`);
    const now = this.deps.clock.now();
    // Boundary pinned by B04-16: a quote is unusable from its expiresAt second onwards.
    if (now >= stored.expiresAt) throw quoteExpired(`quote ${request.quoteId} expired; request a new quote`);
    // The signature only verifies against the quote's funder, so another wallet can never succeed at Flash.
    if (!sameAddress(request.walletAddress, stored.walletAddress)) {
      throw badRequest("walletAddress: does not match the wallet the quote was issued to");
    }
    const order = { ...request, permitSignature: permitSignatureFor(request, stored) };
    // A quote issued before a restart is gone from the adapter; refuse it before markUsed so nothing is spent.
    if (this.deps.flash.hasQuote?.(stored.quoteId) === false) {
      throw quoteExpired(`quote ${request.quoteId} is no longer held by this backend; request a new quote`);
    }
    // D-B1: the claim happens before the submit so a retry can never place a second signed order (notes 4.3).
    if (!this.deps.quotes.markUsed(stored.quoteId, now)) {
      throw quoteExpired(`quote ${request.quoteId} was already submitted; request a new quote`);
    }
    const submitted = await this.deps.flash
      .submit({ quote: stored.response, rawTypedData: stored.rawTypedData, order })
      .catch(mapFlashError);
    this.deps.orders.insert({
      orderId: submitted.orderId,
      quoteId: stored.quoteId,
      walletAddress: stored.walletAddress,
      orderType: stored.orderType,
      status: submitted.status,
      detail: initialDetail(submitted.orderId, stored, now),
      createdAt: now,
      updatedAt: now,
    });
    return submitted;
  }

  async status(orderId: string): Promise<FlashOrderDetail> {
    const stored = this.deps.orders.get(orderId);
    if (!stored) throw notFound(`order ${orderId} not found`);
    // An unknown Flash status is stored as failed but may still move at Flash, so it is polled again.
    if (TERMINAL_STATUSES.has(stored.status) && !isUnknownFlashStatus(stored.detail)) return stored.detail;
    let fresh: FlashOrderDetail;
    try {
      fresh = await this.deps.flash.status({ orderId, orderType: stored.orderType, funderAddress: stored.walletAddress });
    } catch (err) {
      // D-B2: a poll that fails (outage, or Flash's list lagging a fresh order, notes 4.3) keeps the last
      // known state so the 3 s polling loop survives; a 404 here is never "the order vanished".
      if (!(err instanceof FlashError)) throw err;
      this.log?.warn({ orderId, err: err.message }, "flash status failed; serving stored detail");
      return stored.detail;
    }
    const now = this.deps.clock.now();
    // orderType is ours from the quote and updatedAt is our refresh time (B04-28); Flash's values yield to them.
    const detail: FlashOrderDetail = { ...fresh, orderId, orderType: stored.orderType, updatedAt: now };
    this.deps.orders.updateDetail(orderId, detail, now);
    return detail;
  }
}

/**
 * Flash accepts a permit signature only together with the permit typed data it issued, so a stray
 * signature is dropped and a missing one is rejected before the quote is spent (B04-19).
 */
function permitSignatureFor(request: FlashOrderRequest, stored: StoredQuote): string | null {
  if (stored.rawTypedData.permitTypedData === null) return null;
  if (!request.permitSignature) {
    throw badRequest("permitSignature: required because the quote returned permit typed data");
  }
  return request.permitSignature;
}

/** Hex case carries no meaning in an address (EIP-55 is a checksum, not a different wallet). */
function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** What /flash/order/:id serves until the first status refresh: Flash has only acknowledged the order. */
function initialDetail(orderId: string, stored: StoredQuote, now: number): FlashOrderDetail {
  return {
    orderId,
    status: "submitted",
    orderType: stored.orderType,
    txHash: null,
    chainId: stored.response.chainId,
    filledAmount: null,
    error: null,
    updatedAt: now,
  };
}
