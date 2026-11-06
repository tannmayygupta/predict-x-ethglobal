import {
  CHAINS,
  fixtures,
  type FlashOrderDetail,
  type FlashQuoteRequest,
  type FlashQuoteResponse,
  type OrderStatus,
} from "@predictx/shared";
import type { Clock } from "../util/clock";
import { divideDecimal } from "./flash.decimal";
import {
  FlashError,
  FlashNotFoundError,
  QUOTE_TTL_SECONDS,
  type FlashClient,
  type FlashOrderResponse,
  type FlashQuoteInput,
  type FlashStatusInput,
  type FlashSubmitInput,
  type OrderTypeName,
} from "./flash.types";

interface MockOrder {
  orderType: OrderTypeName;
  receiveAmount: string;
  polls: number;
}

/** In-process stand-in for Flash. Deterministic ids and clock-driven expiry keep route tests reproducible. */
export class MockFlashClient implements FlashClient {
  private quoteCounter = 0;
  private orderCounter = 0;
  private readonly orders = new Map<string, MockOrder>();
  /** One-shot switch so route tests can exercise the FLASH_ERROR path without a real failure (B03-06). */
  failNextQuote = false;

  constructor(private readonly clock: Clock) {}

  async quote({ request }: FlashQuoteInput): Promise<FlashQuoteResponse> {
    if (this.failNextQuote) {
      this.failNextQuote = false;
      throw new FlashError("mock failure");
    }
    this.quoteCounter += 1;
    // The shared fixture is the template so Part A's MSW mock and this mock stay aligned (B03-07).
    return {
      ...fixtures.quoteEthMarket,
      quoteId: `q_mock_${this.quoteCounter}`,
      expiresAt: this.clock.now() + QUOTE_TTL_SECONDS,
      orderType: request.orderType,
      spend: { symbol: fixtures.quoteEthMarket.spend.symbol, amount: request.amount },
      receive: { symbol: fixtures.quoteEthMarket.receive.symbol, amount: receiveAmount(request) },
    };
  }

  async submit({ quote }: FlashSubmitInput): Promise<FlashOrderResponse> {
    this.orderCounter += 1;
    const orderId = `o_mock_${this.orderCounter}`;
    this.orders.set(orderId, { orderType: quote.orderType, receiveAmount: quote.receive.amount, polls: 0 });
    return { orderId, status: "submitted" };
  }

  /** First poll is always `submitted`; the next settles: market fills, limit rests open (FR-S-06 relies on txHash). */
  async status({ orderId }: FlashStatusInput): Promise<FlashOrderDetail> {
    const order = this.orders.get(orderId);
    if (!order) throw new FlashNotFoundError(`unknown order ${orderId}`);
    order.polls += 1;
    const status: OrderStatus = order.polls === 1 ? "submitted" : order.orderType === "market" ? "filled" : "open";
    const filled = status === "filled";
    return {
      orderId,
      status,
      orderType: order.orderType,
      txHash: filled ? fixtures.orderFilled.txHash : null,
      chainId: CHAINS.BASE_MAINNET.id,
      filledAmount: filled ? order.receiveAmount : null,
      error: null,
      updatedAt: this.clock.now(),
    };
  }
}

/** Market quotes price at the fixture spot so 2.00 USDC yields the fixture's 0.000816 ETH and other amounts scale. */
const MOCK_SPOT_PRICE_USD = fixtures.marketEth.priceUsd;

function receiveAmount(request: FlashQuoteRequest): string {
  const price = request.orderType === "limit" && request.limitPriceUsd ? request.limitPriceUsd : MOCK_SPOT_PRICE_USD;
  return divideDecimal(request.amount, price);
}
