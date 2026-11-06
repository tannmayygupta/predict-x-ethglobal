import { describe, expect, it } from "bun:test"
import { decimalToE18, E18, formatE18 } from "../src/price"

describe("decimalToE18", () => {
  it("scales whole numbers", () => {
    expect(decimalToE18("3000")).toBe(3000n * E18)
    expect(decimalToE18("0")).toBe(0n)
  })

  it("keeps every fractional digit up to 18 places", () => {
    expect(decimalToE18("3412.57")).toBe(3_412_570_000_000_000_000_000n)
    expect(decimalToE18("0.000005007934381530032")).toBe(5_007_934_381_530n)
    expect(decimalToE18("1.000000000000000001")).toBe(E18 + 1n)
  })

  it("truncates digits beyond 18 decimals instead of rounding", () => {
    expect(decimalToE18("0.0000000000000000019")).toBe(1n)
  })

  it("expands exponent notation exactly", () => {
    expect(decimalToE18("1.2e-5")).toBe(12_000_000_000_000n)
    expect(decimalToE18("5.0079e-06")).toBe(5_007_900_000_000n)
    expect(decimalToE18("1E+3")).toBe(1000n * E18)
    expect(decimalToE18("2.5e2")).toBe(250n * E18)
    expect(decimalToE18("7e-19")).toBe(0n)
  })

  it("handles prices that do not fit a double exactly", () => {
    expect(decimalToE18("109876.123456789012345678")).toBe(109_876_123_456_789_012_345_678n)
  })

  it("rejects anything that is not a non-negative decimal", () => {
    for (const bad of ["", " ", "-1", "abc", "1.2.3", "NaN", "Infinity", "1e", "e5", "0x10", "1,5", ".", "1e-"]) {
      expect(() => decimalToE18(bad)).toThrow()
    }
  })
})

describe("decimalToE18 bounds", () => {
  it("rejects exponents outside a sane range rather than building huge numbers", () => {
    expect(() => decimalToE18("1e400")).toThrow(/exponent/)
    expect(() => decimalToE18("1e-400")).toThrow(/exponent/)
  })
})

describe("formatE18", () => {
  it("renders an E18 integer as a plain decimal without trailing zeros", () => {
    expect(formatE18(3_412_570_000_000_000_000_000n)).toBe("3412.57")
    expect(formatE18(3000n * E18)).toBe("3000")
    expect(formatE18(5_007_934_381_530n)).toBe("0.00000500793438153")
    expect(formatE18(1n)).toBe("0.000000000000000001")
    expect(formatE18(0n)).toBe("0")
  })

  it("round-trips through decimalToE18", () => {
    for (const v of [1n, 12_000_000_000_000n, 109_876_123_456_789_012_345_678n]) {
      expect(decimalToE18(formatE18(v))).toBe(v)
    }
  })
})
