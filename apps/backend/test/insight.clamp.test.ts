import { DecimalString } from "@predictx/shared";
import { describe, expect, it } from "vitest";
import { clampSuggestedLimit } from "../src/services/insight.clamp";

const SPOT = "2451.12";

describe("B05-11 a limit within 15% of spot is unchanged", () => {
  it.each(["2380.00", "2451.12", "2500", "2100.5", "2818.78", "2083.46"])("%s stays as given", (limit) => {
    expect(clampSuggestedLimit(SPOT, limit)).toBe(limit);
  });
});

describe("B05-12 a limit below spot * 0.85 is raised to exactly that bound", () => {
  it.each([
    // spot 2451.12 * 0.85 = 2083.452 -> 2 decimals like spot
    [SPOT, "1000", "2083.45"],
    [SPOT, "2083.44", "2083.45"],
    // spot without decimals still gets the 2-decimal minimum
    ["100", "50", "85.00"],
    // 0.5 * 0.85 = 0.425 rounds half up at 2 decimals
    ["0.5", "0.1", "0.43"],
    ["81269", "0", "69078.65"],
  ])("spot %s, limit %s -> %s", (spot, limit, expected) => {
    const out = clampSuggestedLimit(spot, limit);
    expect(out).toBe(expected);
    expect(() => DecimalString.parse(out)).not.toThrow();
  });
});

describe("B05-13 a limit above spot * 1.15 is lowered to that bound", () => {
  it.each([
    // spot 2451.12 * 1.15 = 2818.788 -> 2818.79 at spot's 2 decimals
    [SPOT, "9999", "2818.79"],
    [SPOT, "2818.80", "2818.79"],
    ["100", "200", "115.00"],
    ["0.5", "1", "0.58"],
  ])("spot %s, limit %s -> %s", (spot, limit, expected) => {
    const out = clampSuggestedLimit(spot, limit);
    expect(out).toBe(expected);
    expect(() => DecimalString.parse(out)).not.toThrow();
  });
});

describe("B05-14 null and garbage", () => {
  it("null passes through as null", () => {
    expect(clampSuggestedLimit(SPOT, null)).toBeNull();
  });
  it.each(["abc", "", "1,000", "-5", "1e3", "$2380", "2380.", ".5", "NaN", "Infinity"])(
    "a non-numeric string %j from the model becomes null instead of throwing",
    (limit) => {
      expect(clampSuggestedLimit(SPOT, limit)).toBeNull();
    },
  );
  it("an unparsable spot also yields null rather than a 500", () => {
    expect(clampSuggestedLimit("n/a", "2380.00")).toBeNull();
  });
});

describe("B05-15 string decimal arithmetic keeps PEPE-scale precision", () => {
  it.each([
    // spot with 7 decimals: bounds 0.0000102 and 0.0000138 are exact at that scale
    ["0.0000120", "0.0000050", "0.0000102"],
    ["0.0000120", "0.0000200", "0.0000138"],
    ["0.0000120", "0.0000115", "0.0000115"],
    ["0.0000120", "0.0000102", "0.0000102"],
    // spot with 6 decimals (numberToDecimalString(1.2e-5)): bounds rounded half up to 6 decimals
    ["0.000012", "0.000005", "0.000010"],
    ["0.000012", "0.00002", "0.000014"],
    // sub-1e-6 spot: never an exponent form
    ["0.00000015", "0.0000001", "0.00000013"],
    ["0.00000015", "0.000001", "0.00000017"],
    // long fraction from CoinGecko precision=full survives untouched when inside the band
    ["0.000005007934381530032", "0.000005", "0.000005"],
    ["0.000005007934381530032", "0.000001", "0.000004256744224300527"],
  ])("spot %s, limit %s -> %s", (spot, limit, expected) => {
    const out = clampSuggestedLimit(spot, limit);
    expect(out).toBe(expected);
    expect(out).not.toMatch(/e/i);
    expect(() => DecimalString.parse(out)).not.toThrow();
  });
});
