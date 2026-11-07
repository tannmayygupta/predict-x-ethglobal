import { FlashOrderDetail, FlashOrderResponse, FlashQuoteResponse, Token, fixtures, type FlashQuoteRequest } from "@predictx/shared";
import { describe, expect, it } from "vitest";
import tokensJson from "../../../../packages/shared/tokens.json";
import { MockFlashClient } from "../../src/clients/flash.mock";
import { FlashError, FlashNotFoundError, type FlashSubmitInput } from "../../src/clients/flash.types";
import { FakeClock } from "../helpers/fakes/clock";

const ETH = Token.parse(tokensJson.tokens.find((t) => t.symbol === "ETH"));
const WALLET = "0x1111111111111111111111111111111111111111";

function marketRequest(amount = "2.00"): FlashQuoteRequest {
  return { walletAddress: WALLET, symbol: "ETH", side: "buy", orderType: "market", amount, slippage: "0.01" };
}

describe("B03-01 MockFlashClient.quote", () => {
  it("returns a parseable quote echoing amount and orderType, expiring in 60 s, with a fresh id per call", async () => {
    const clock = new FakeClock();
    clock.set(1_761_600_000);
    const client = new MockFlashClient(clock);
    const first = await client.quote({ request: marketRequest(), token: ETH });
    const parsed = FlashQuoteResponse.parse(first);
    expect(parsed.spend.amount).toBe("2.00");
    expect(parsed.orderType).toBe("market");
    expect(parsed.expiresAt).toBe(1_761_600_060);
    const second = await client.quote({ request: marketRequest(), token: ETH });
    expect(second.quoteId).not.toBe(first.quoteId);
  });
});

function limitRequest(amount: string, limitPriceUsd: string): FlashQuoteRequest {
  return { walletAddress: WALLET, symbol: "ETH", side: "buy", orderType: "limit", amount, limitPriceUsd, slippage: "0.01" };
}

describe("B03-02 limit quotes divide amount by the limit price", () => {
  it.each([
    ["2.00", "2380.00", "0.000840"],
    ["5.00", "2500", "0.002000"],
    ["1", "3", "0.333333"],
    ["0.5", "0.0000120", "41666.666667"],
    ["1", "7", "0.142857"],
  ])("amount %s at limit %s receives %s (6 decimals, rounded half-up)", async (amount, limit, expected) => {
    const client = new MockFlashClient(new FakeClock());
    const quote = await client.quote({ request: limitRequest(amount, limit), token: ETH });
    expect(FlashQuoteResponse.parse(quote).receive.amount).toBe(expected);
    expect(quote.orderType).toBe("limit");
  });
});

function submitInput(quote: FlashQuoteResponse): FlashSubmitInput {
  return {
    quote,
    rawTypedData: { orderTypedData: quote.steps.orderTypedData, permitTypedData: quote.steps.permitTypedData },
    order: { quoteId: quote.quoteId, walletAddress: WALLET, orderSignature: "0xabcdef", permitSignature: null },
  };
}

describe("B03-03 MockFlashClient.submit", () => {
  it("returns { orderId, status: 'submitted' } with a fresh orderId per call", async () => {
    const client = new MockFlashClient(new FakeClock());
    const quote = await client.quote({ request: marketRequest(), token: ETH });
    const first = await client.submit(submitInput(quote));
    const second = await client.submit(submitInput(quote));
    expect(FlashOrderResponse.parse(first).status).toBe("submitted");
    expect(first.orderId.length).toBeGreaterThan(0);
    expect(second.orderId).not.toBe(first.orderId);
  });
});

describe("B03-04 MockFlashClient.status progression", () => {
  it("market: submitted, then filled with a txHash and the quoted receive amount", async () => {
    const clock = new FakeClock();
    const client = new MockFlashClient(clock);
    const quote = await client.quote({ request: marketRequest(), token: ETH });
    const { orderId } = await client.submit(submitInput(quote));
    const first = FlashOrderDetail.parse(await client.status({ orderId, orderType: "market", funderAddress: WALLET }));
    expect(first.status).toBe("submitted");
    expect(first.txHash).toBeNull();
    clock.advance(3);
    const second = FlashOrderDetail.parse(await client.status({ orderId, orderType: "market", funderAddress: WALLET }));
    expect(second.status).toBe("filled");
    expect(second.txHash).not.toBeNull();
    expect(second.filledAmount).toBe(quote.receive.amount);
    expect(second.orderType).toBe("market");
    expect(second.orderId).toBe(orderId);
    expect(second.updatedAt).toBe(clock.now());
    const third = await client.status({ orderId, orderType: "market", funderAddress: WALLET });
    expect(third.status).toBe("filled");
  });

  it("limit: submitted, then open with txHash null", async () => {
    const client = new MockFlashClient(new FakeClock());
    const quote = await client.quote({ request: limitRequest("2.00", "2380.00"), token: ETH });
    const { orderId } = await client.submit(submitInput(quote));
    expect((await client.status({ orderId, orderType: "limit", funderAddress: WALLET })).status).toBe("submitted");
    const second = FlashOrderDetail.parse(await client.status({ orderId, orderType: "limit", funderAddress: WALLET }));
    expect(second.status).toBe("open");
    expect(second.txHash).toBeNull();
    expect(second.filledAmount).toBeNull();
    expect(second.orderType).toBe("limit");
    expect(second.error).toBeNull();
  });
});

describe("B03-05 status for an unknown order", () => {
  it("throws FlashNotFoundError (a FlashError) naming the id", async () => {
    const client = new MockFlashClient(new FakeClock());
    const call = client.status({ orderId: "o_unknown", orderType: "market", funderAddress: WALLET });
    await expect(call).rejects.toBeInstanceOf(FlashNotFoundError);
    await expect(call).rejects.toBeInstanceOf(FlashError);
    await expect(call).rejects.toThrow("o_unknown");
  });
});

describe("B03-06 failNextQuote hook", () => {
  it("makes exactly the next quote throw FlashError('mock failure'), then recovers", async () => {
    const client = new MockFlashClient(new FakeClock());
    client.failNextQuote = true;
    const failing = client.quote({ request: marketRequest(), token: ETH });
    await expect(failing).rejects.toBeInstanceOf(FlashError);
    await expect(failing).rejects.toThrow("mock failure");
    expect(client.failNextQuote).toBe(false);
    await expect(client.quote({ request: marketRequest(), token: ETH })).resolves.toBeDefined();
  });
});

describe("B03-07 alignment with the shared fixture", () => {
  it("matches fixtures.quoteEthMarket for the fixture input apart from the id, expiry and the derived factors", async () => {
    const clock = new FakeClock();
    clock.set(1_761_600_000);
    const client = new MockFlashClient(clock);
    const quote = await client.quote({ request: marketRequest("2.00"), token: ETH });
    const { spendUsd, receiveUsd, minReceive, effectivePriceUsd, marketPriceUsd, ...rest } = quote;
    expect(rest).toEqual({
      ...fixtures.quoteEthMarket,
      quoteId: quote.quoteId,
      expiresAt: quote.expiresAt,
      spendUsd: undefined,
      receiveUsd: undefined,
      minReceive: undefined,
      effectivePriceUsd: undefined,
      marketPriceUsd: undefined,
    });
    // The factors are computed from the mock spot, not copied, and stay consistent with the amounts.
    expect(spendUsd).toBe("2.00");
    expect(receiveUsd).toBe("2.000113");
    expect(minReceive).toBe("0.00080784");
    expect(effectivePriceUsd).toBe("2450.98039216");
    expect(marketPriceUsd).toBe("2451.11887255");
    expect(quote.slippage).toBe("0.01");
    expect(quote.orderDeadline).toBe(1_761_600_300);
    expect(quote.steps.orderTypedData).not.toBe("");
  });

  it("limit quotes carry the limit price, no slippage factors and the chosen expiry (null = good till cancelled)", async () => {
    const client = new MockFlashClient(new FakeClock());
    const limit = await client.quote({ request: { ...limitRequest("2.00", "2380.00"), expireAt: 1_761_700_000 }, token: ETH });
    expect(limit).toMatchObject({
      recommendedSlippage: null,
      slippage: null,
      marketPriceUsd: null,
      limitPriceUsd: "2380.00",
      minReceive: limit.receive.amount,
      orderDeadline: 1_761_700_000,
    });
    const gtc = await client.quote({ request: limitRequest("2.00", "2380.00"), token: ETH });
    expect(gtc.orderDeadline).toBeNull();
  });

  it("prices market quotes off fixtures.marketEth.priceUsd so other amounts scale consistently", async () => {
    const client = new MockFlashClient(new FakeClock());
    const quote = await client.quote({ request: marketRequest("4.00"), token: ETH });
    // 4.00 / 2451.12 = 0.0016319... -> 6 decimals
    expect(quote.receive.amount).toBe("0.001632");
    expect(quote.receive.symbol).toBe("ETH");
  });
});

describe("mock quotes use the requested token, not ETH", () => {
  const tokenOf = (symbol: string) => Token.parse(tokensJson.tokens.find((t) => t.symbol === symbol));

  it.each([
    ["BTC", "0.000025", "81269"],
    ["DEGEN", "1666.666667", "0.0012"],
    ["BRETT", "40.000000", "0.05"],
    ["ETH", "0.000816", "2451.12"],
  ])("%s buys %s units at its own mock spot %s and keeps the q_mock_ prefix", async (symbol, receive, spot) => {
    const client = new MockFlashClient(new FakeClock());
    const quote = FlashQuoteResponse.parse(
      await client.quote({ request: { ...marketRequest(), symbol }, token: tokenOf(symbol) }),
    );
    expect(quote.receive).toEqual({ symbol, amount: receive });
    expect(quote.quoteId).toMatch(/^q_mock_/);
    expect(quote.marketPriceUsd).not.toBeNull();
    expect(Number(quote.marketPriceUsd)).toBeCloseTo(Number(spot), 0);
  });
});
