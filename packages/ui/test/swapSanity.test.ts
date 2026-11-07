import { describe, expect, it } from "vitest";
import { COPY } from "../src/copy";
import { quoteFailureText } from "../src/components/swap/quoteErrors";
import { limitTooFarBelow } from "../src/components/swap/swapMath";

describe("limit price sanity", () => {
  it("blocks a limit far under the market (a $0.0001 limit once quoted 9,900 ETH)", () => {
    expect(limitTooFarBelow("0.0001", "2240")).toBe(true);
    expect(limitTooFarBelow("1000", "2240")).toBe(true);
    expect(limitTooFarBelow("1119", "2240")).toBe(true);
  });
  it("allows a limit within half of the market, at it, or above it", () => {
    expect(limitTooFarBelow("1120", "2240")).toBe(false);
    expect(limitTooFarBelow("2128", "2240")).toBe(false);
    expect(limitTooFarBelow("2240", "2240")).toBe(false);
    expect(limitTooFarBelow("3000", "2240")).toBe(false);
  });
  it("says nothing when either price is unusable", () => {
    expect(limitTooFarBelow("abc", "2240")).toBe(false);
    expect(limitTooFarBelow("100", "0")).toBe(false);
  });
});

describe("failed quotes read as plain words", () => {
  it("hides developer text from validation errors", () => {
    expect(quoteFailureText("BAD_REQUEST", "body.amount: invalid decimal")).toBe(COPY.check_inputs);
    expect(quoteFailureText("BAD_REQUEST", "body.slippage: invalid decimal")).toBe(COPY.check_inputs);
  });
  it("turns an upstream Flash failure into one calm sentence", () => {
    expect(quoteFailureText("FLASH_ERROR", "VALIDATION_ERROR: Request validation failed")).toBe(COPY.flash_unavailable);
  });
  it("keeps the existing wording for network faults and passes a clear message through", () => {
    expect(quoteFailureText("NETWORK", "x")).toBe("Couldn't load the quote. Try again.");
    expect(quoteFailureText("INTERNAL", "x")).toBe("Couldn't load the quote. Try again.");
    expect(quoteFailureText("BAD_REQUEST", "amount: exceeds the maximum of 5 USDC per order")).toBe("amount: exceeds the maximum of 5 USDC per order");
  });
});
