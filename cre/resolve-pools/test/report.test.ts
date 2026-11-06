import { describe, expect, it } from "bun:test"
import { encodeResolveReport } from "../src/report"

// Expected bytes produced independently with `cast abi-encode "f(uint256,bool,uint256)" ...`
describe("encodeResolveReport", () => {
  it("matches abi.encode(uint256,bool,uint256) for a YES report", () => {
    expect(encodeResolveReport(0n, true, 3_412_570_000_000_000_000_000n)).toBe(
      "0x" +
        "0000000000000000000000000000000000000000000000000000000000000000" +
        "0000000000000000000000000000000000000000000000000000000000000001" +
        "0000000000000000000000000000000000000000000000b8feec1e6de2c90000",
    )
  })

  it("matches abi.encode(uint256,bool,uint256) for a NO report", () => {
    expect(encodeResolveReport(7n, false, 5_007_934_381_530n)).toBe(
      "0x" +
        "0000000000000000000000000000000000000000000000000000000000000007" +
        "0000000000000000000000000000000000000000000000000000000000000000" +
        "0000000000000000000000000000000000000000000000000000048e00265dda",
    )
  })

  it("rejects negative values", () => {
    expect(() => encodeResolveReport(-1n, true, 1n)).toThrow()
    expect(() => encodeResolveReport(1n, true, -1n)).toThrow()
  })
})
