import {
  CHAINS,
  fixtures,
  type FlashOrderDetail,
  type FlashQuoteRequest,
  type FlashQuoteResponse,
  type OrderStatus,
} from "@predictx/shared";
import type { Clock } from "../util/clock";
import { MOCK_AMOUNT_SCALE, divideDecimal, multiplyDecimal } from "./flash.decimal";
import { USDC_DECIMALS, deriveQuoteFactors } from "./flash.factors";
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

  async quote({ request, token }: FlashQuoteInput): Promise<FlashQuoteResponse> {
    if (this.failNextQuote) {
      this.failNextQuote = false;
      throw new FlashError("mock failure");
    }
    this.quoteCounter += 1;
    const now = this.clock.now();
    const spot = mockSpotUsd(token.symbol);
    const receive = receiveAmount(request, spot);
    // A mock has no real market data: the USD legs come from the fixed mock spot, and there is no fee to find.
    const factors = deriveQuoteFactors({
      request,
      spendAmount: request.amount,
      receiveAmount: receive,
      tokenDecimals: token.decimals ?? MOCK_AMOUNT_SCALE,
      spendNotional: request.amount,
      receiveNotional: multiplyDecimal(receive, spot, USDC_DECIMALS),
      recommendedSlippage: fixtures.quoteEthMarket.recommendedSlippage,
      orderTypedData: mockOrderTypedData(request.orderType === "market" ? now + MOCK_MARKET_DEADLINE_SECONDS : request.expireAt),
    });
    // The shared fixture is the template so Part A's MSW mock and this mock stay aligned (B03-07).
    return {
      ...fixtures.quoteEthMarket,
      quoteId: `q_mock_${this.quoteCounter}`,
      expiresAt: now + QUOTE_TTL_SECONDS,
      orderType: request.orderType,
      spend: { symbol: fixtures.quoteEthMarket.spend.symbol, amount: request.amount },
      receive: { symbol: token.symbol, amount: receive },
      ...factors,
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

/** Mirrors Flash: a market order lives about five minutes. */
const MOCK_MARKET_DEADLINE_SECONDS = 300;

/** Only the deadline matters to the mapper; null stands for good till cancelled. */
function mockOrderTypedData(deadline: number | null | undefined): string {
  return JSON.stringify({ message: { deadline: deadline == null ? null : String(deadline) } });
}

/**
 * Fixed, clearly fake spot prices per symbol (USD) so a mock BTC quote does not show ETH's price. ETH is the shared
 * fixture's, so 2.00 USDC yields the fixture's 0.000816 ETH; the others are round illustrative values in the same
 * ballpark as the test feeds. Nothing here is market data and mock quotes carry the q_mock_ prefix.
 */
const MOCK_SPOT_USD: Readonly<Record<string, string>> = {
  ETH: fixtures.marketEth.priceUsd,
  BTC: "81269",
  PEPE: "0.000012",
  DEGEN: "0.0012",
  BRETT: "0.05",
};

function mockSpotUsd(symbol: string): string {
  return MOCK_SPOT_USD[symbol] ?? fixtures.marketEth.priceUsd;
}

function receiveAmount(request: FlashQuoteRequest, spot: string): string {
  const price = request.orderType === "limit" && request.limitPriceUsd ? request.limitPriceUsd : spot;
  return divideDecimal(request.amount, price);
}
