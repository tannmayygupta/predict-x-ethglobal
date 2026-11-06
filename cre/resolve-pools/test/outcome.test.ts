import { describe, expect, it } from "bun:test"
import { decideOutcome, DIRECTION_ABOVE, DIRECTION_BELOW } from "../src/outcome"

const strike = 3000n * 10n ** 18n

describe("decideOutcome", () => {
  it("above: YES when price >= strike, including equality", () => {
    expect(decideOutcome(DIRECTION_ABOVE, strike, strike + 1n)).toBe(true)
    expect(decideOutcome(DIRECTION_ABOVE, strike, strike)).toBe(true)
    expect(decideOutcome(DIRECTION_ABOVE, strike, strike - 1n)).toBe(false)
  })

  it("below: YES when price <= strike, including equality", () => {
    expect(decideOutcome(DIRECTION_BELOW, strike, strike - 1n)).toBe(true)
    expect(decideOutcome(DIRECTION_BELOW, strike, strike)).toBe(true)
    expect(decideOutcome(DIRECTION_BELOW, strike, strike + 1n)).toBe(false)
  })

  it("compares at full 1e18 precision (PEPE-scale strike)", () => {
    const pepeStrike = 10_000_000_000_000n // $0.00001
    expect(decideOutcome(DIRECTION_ABOVE, pepeStrike, 5_007_934_381_530n)).toBe(false)
    expect(decideOutcome(DIRECTION_BELOW, pepeStrike, 5_007_934_381_530n)).toBe(true)
  })

  it("rejects an unknown direction instead of guessing", () => {
    expect(() => decideOutcome(2, strike, strike)).toThrow(/direction/)
  })
})
