import { describe, expect, it } from "vitest";
import { compareDecimal } from "../../src/util/decimal";

describe("compareDecimal", () => {
  it.each([
    ["1", "2", -1],
    ["2.50", "2.5", 0],
    ["10", "9.99", 1],
    ["0.000012", "0.0000119", 1],
    ["0", "0.0", 0],
  ] as const)("%s vs %s is %i", (a, b, expected) => {
    expect(compareDecimal(a, b)).toBe(expected);
  });

  it("rejects anything that is not a plain decimal", () => {
    expect(() => compareDecimal("1e-7", "1")).toThrow(RangeError);
    expect(() => compareDecimal("1", "-1")).toThrow(RangeError);
  });
});
