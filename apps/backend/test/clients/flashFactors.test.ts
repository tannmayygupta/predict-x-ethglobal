import { readFileSync } from "node:fs";
import { FlashQuoteResponse, Token, type FlashQuoteRequest } from "@predictx/shared";
import { describe, expect, it } from "vitest";
import tokensJson from "../../../../packages/shared/tokens.json";
import { clampDecimals, isPositiveDecimal, minAfterSlippage, multiplyDecimal } from "../../src/clients/flash.decimal";
import { orderDeadlineOf } from "../../src/clients/flash.factors";
import { fromFlashQuote, toFlashQuoteBody } from "../../src/clients/flash.map";
import { FlashError, RawFlashQuote } from "../../src/clients/flash.types";

const ETH = Token.parse(tokensJson.tokens.find((t) => t.symbol === "ETH"));
const BTC = Token.parse(tokensJson.tokens.find((t) => t.symbol === "BTC"));
const WALLET = "0x1111111111111111111111111111111111111111";
const NOW = 1_761_600_000;

const marketReq: FlashQuoteRequest = {
  walletAddress: WALLET,
  symbol: "ETH",
  side: "buy",
  orderType: "market",
  amount: "2",
  slippage: "0.01",
};
const limitReq: FlashQuoteRequest = { ...marketReq, orderType: "limit", limitPriceUsd: "2300.00" };

/** The real-shaped fixture: notional, recommendedSlippage and an 18-decimal amount, as Flash sends them. */
function fixtureQuote(): RawFlashQuote {
  const path = new URL("../fixtures/flash/quote.ok.json", import.meta.url);
  return RawFlashQuote.parse(JSON.parse(readFileSync(path, "utf8")));
}

describe("RawFlashQuote parses the real-shaped fixture", () => {
  it("keeps notional and recommendedSlippage, and still tolerates a hand-built quote without them", () => {
    const raw = fixtureQuote();
    expect(raw.from.notional).toBe("2");
    expect(raw.to.notional).toBe("1.978124");
    expect(raw.recommendedSlippage).toBe("0.15");
    const bare = RawFlashQuote.parse({
      quoteId: "q",
      from: { amount: "2" },
      to: { amount: "1" },
      fees: { estimatedFeeNotional: "0" },
      estimatedPriceImpact: null,
      evm: null,
    });
    expect(bare.recommendedSlippage).toBeUndefined();
  });
});

describe("fromFlashQuote quote factors (market)", () => {
  const quote = FlashQuoteResponse.parse(fromFlashQuote(fixtureQuote(), { request: marketReq, token: ETH }, NOW));

  it("takes the recommendation from Flash and the slippage we sent", () => {
    expect(quote.recommendedSlippage).toBe("0.15");
    expect(quote.slippage).toBe("0.01");
  });
  it("derives the USD legs from notional; the real cost is spend minus receive, not the zero fee", () => {
    expect(quote.feesUsd).toBe("0");
    expect(quote.spendUsd).toBe("2");
    expect(quote.receiveUsd).toBe("1.978124");
  });
  it("floors minReceive to the token decimals and never rounds it up", () => {
    // 0.000839667739435631 * 0.99 = 0.00083127106204127469 -> 18 decimals, floored
    expect(quote.minReceive).toBe("0.000831271062041274");
  });
  it("prices the fill and the market from the amounts, with 8 decimals", () => {
    expect(quote.effectivePriceUsd).toBe("2381.89453526");
    expect(quote.marketPriceUsd).toBe("2355.84137284");
    expect(quote.limitPriceUsd).toBeNull();
  });
  it("reads the order deadline from the typed data message", () => {
    expect(quote.orderDeadline).toBe(1_761_600_300);
  });
  it("works for a token with other decimals (cbBTC, 8)", () => {
    const raw = { ...fixtureQuote(), to: { amount: "0.00002461999999999999", notional: "1.9" } };
    const btc = fromFlashQuote(raw, { request: { ...marketReq, symbol: "BTC" }, token: BTC }, NOW);
    expect(btc.receive.amount).toBe("0.00002461");
    expect(btc.minReceive).toBe("0.00002436");
  });
});

describe("fromFlashQuote quote factors (limit)", () => {
  it("has no slippage factors or market price, echoes the limit price and receives exactly what it says", () => {
    const quote = FlashQuoteResponse.parse(fromFlashQuote(fixtureQuote(), { request: limitReq, token: ETH }, NOW));
    expect(quote).toMatchObject({
      recommendedSlippage: null,
      slippage: null,
      marketPriceUsd: null,
      limitPriceUsd: "2300.00",
      minReceive: quote.receive.amount,
    });
  });
});

describe("fromFlashQuote defensive mapping", () => {
  it("clamps over-long amounts to USDC (6) and token decimals before they reach DecimalString", () => {
    const raw = {
      ...fixtureQuote(),
      from: { amount: "2.0000000000000000000000000000000000001", notional: "2" },
      to: { amount: `0.${"1".repeat(40)}`, notional: "1.9" },
    };
    const quote = FlashQuoteResponse.parse(fromFlashQuote(raw, { request: marketReq, token: ETH }, NOW));
    expect(quote.spend.amount).toBe("2.000000");
    expect(quote.receive.amount).toBe(`0.${"1".repeat(18)}`);
  });
  it("gives a null price instead of dividing by a zero receive amount", () => {
    const raw = { ...fixtureQuote(), to: { amount: "0", notional: "0" } };
    const quote = FlashQuoteResponse.parse(fromFlashQuote(raw, { request: marketReq, token: ETH }, NOW));
    expect(quote.effectivePriceUsd).toBeNull();
    expect(quote.marketPriceUsd).toBeNull();
    expect(quote.minReceive).toBe("0");
  });
  it("leaves USD legs null when Flash sends no notional, and drops a recommendation that is not a number", () => {
    const raw = { ...fixtureQuote(), from: { amount: "2" }, to: { amount: "0.0008" }, recommendedSlippage: "high" };
    const quote = FlashQuoteResponse.parse(fromFlashQuote(raw, { request: marketReq, token: ETH }, NOW));
    expect(quote).toMatchObject({ spendUsd: null, receiveUsd: null, marketPriceUsd: null, recommendedSlippage: null });
  });
  it("rejects an amount that is not a decimal as a FlashError, not a crash", () => {
    const raw = { ...fixtureQuote(), to: { amount: "not-a-number", notional: "1" } };
    expect(() => fromFlashQuote(raw, { request: marketReq, token: ETH }, NOW)).toThrow(FlashError);
  });
});

describe("orderDeadlineOf", () => {
  const typed = (deadline: unknown) => JSON.stringify({ message: { deadline } });
  it.each([
    ["a normal deadline string", typed("1761600300"), 1_761_600_300],
    ["a numeric deadline", typed(1_761_600_300), 1_761_600_300],
    ["the good-till-cancelled sentinel 2^48-1", typed("281474976710655"), null],
    ["just under 2^40", typed("1099511627775"), 1_099_511_627_775],
    ["exactly 2^40", typed("1099511627776"), null],
    ["a missing deadline", JSON.stringify({ message: {} }), null],
    ["a deadline that is not digits", typed("soon"), null],
    ["typed data that is not JSON", "not json", null],
  ])("%s", (_name, orderTypedData, expected) => {
    expect(orderDeadlineOf(orderTypedData)).toBe(expected);
  });
});

describe("toFlashQuoteBody expireTime", () => {
  it("sends the limit expiry as an ISO time", () => {
    const body = toFlashQuoteBody({ ...limitReq, expireAt: 1_761_686_400 }, ETH);
    expect(body.expireTime).toBe(new Date(1_761_686_400_000).toISOString());
    expect(body.expireTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
  });
  it("never sends it for a market order (Flash answers 400), nor for a limit without an expiry", () => {
    expect(Object.keys(toFlashQuoteBody({ ...marketReq, expireAt: 1_761_686_400 }, ETH))).not.toContain("expireTime");
    expect(Object.keys(toFlashQuoteBody(limitReq, ETH))).not.toContain("expireTime");
    expect(Object.keys(toFlashQuoteBody({ ...limitReq, expireAt: null }, ETH))).not.toContain("expireTime");
  });
});

describe("bigint decimal helpers", () => {
  it.each([
    ["1.23456789", 4, "1.2345"],
    ["1.2", 4, "1.2"],
    ["5", 0, "5"],
    ["0.99999999", 2, "0.99"],
    ["1.999", 0, "1"],
  ])("clampDecimals(%s, %s) truncates to %s", (value, decimals, expected) => {
    expect(clampDecimals(value, decimals)).toBe(expected);
  });
  it.each([
    ["2", "0.5", 6, "1.000000"],
    ["0.000816", "2451.12", 6, "2.000113"],
    ["3", "0.333", 2, "0.99"],
  ])("multiplyDecimal(%s, %s, %s) floors to %s", (a, b, scale, expected) => {
    expect(multiplyDecimal(a, b, scale)).toBe(expected);
  });
  it.each([
    ["100", "0.01", 6, "99"],
    ["0.000816", "0.01", 18, "0.00080784"],
    ["1", "0.15", 18, "0.85"],
    ["0.000001", "0.5", 6, "0"],
    ["1", "1", 6, "0"],
    ["1", "2", 6, "0"],
    ["10", "0.0003", 3, "9.997"],
  ])("minAfterSlippage(%s, %s, %s) = %s, floored and never above the exact figure", (amount, slippage, decimals, expected) => {
    expect(minAfterSlippage(amount, slippage, decimals)).toBe(expected);
  });
  it("isPositiveDecimal rejects zero and non-decimals", () => {
    expect([isPositiveDecimal("0.0001"), isPositiveDecimal("0"), isPositiveDecimal("0.000"), isPositiveDecimal("x")]).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});
