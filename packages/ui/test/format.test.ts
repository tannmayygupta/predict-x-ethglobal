import { describe, expect, it } from "vitest";
import { formatChange, formatImpact, formatUsdPrice, isMockQuote } from "../src/view";

describe("formatUsdPrice", () => {
  it("groups thousands and shows cents for normal prices", () => {
    expect(formatUsdPrice("2451.12")).toBe("$2,451.12");
    expect(formatUsdPrice("2232.093287109397")).toBe("$2,232.09");
    expect(formatUsdPrice("1")).toBe("$1.00");
  });
  it("keeps the small digits of sub-dollar prices", () => {
    expect(formatUsdPrice("0.000005062037339202")).toBe("$0.000005062");
    expect(formatUsdPrice("0.5")).toBe("$0.5");
  });
});

describe("formatChange", () => {
  it("signs positives and keeps the minus on negatives", () => {
    expect(formatChange(-6.692511802665453)).toBe("-6.7%");
    expect(formatChange(0.44)).toBe("+0.4%");
    expect(formatChange(0)).toBe("0.0%");
  });
});

describe("formatImpact", () => {
  it("turns a fraction into a percent", () => {
    expect(formatImpact("0.0004")).toBe("0.04%");
  });
});

describe("isMockQuote", () => {
  it("recognises the mock client's ids only", () => {
    expect(isMockQuote("q_mock_3")).toBe(true);
    expect(isMockQuote("7f3c1c4e-1b2a-4f6e-9d0a-2f1d3c4b5a69")).toBe(false);
  });
});
