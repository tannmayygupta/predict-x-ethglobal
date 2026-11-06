import { describe, expect, it } from "bun:test"
import { buildPriceRequest, buildPriceUrl, COINGECKO_PUBLIC_BASE_URL, parsePriceResponse } from "../src/coingecko"

describe("buildPriceUrl", () => {
  it("builds the simple/price URL with full precision", () => {
    expect(buildPriceUrl(COINGECKO_PUBLIC_BASE_URL, "ethereum")).toBe(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&precision=full",
    )
  })

  it("tolerates a trailing slash on the base URL", () => {
    expect(buildPriceUrl("https://api.coingecko.com/api/v3/", "based-brett")).toBe(
      "https://api.coingecko.com/api/v3/simple/price?ids=based-brett&vs_currencies=usd&precision=full",
    )
  })

  it("rejects ids that are not CoinGecko coin ids instead of sending them", () => {
    for (const bad of ["", "ETH", "ethereum,bitcoin", "eth&x=1", "a b", "../x"]) {
      expect(() => buildPriceUrl(COINGECKO_PUBLIC_BASE_URL, bad)).toThrow(/coingecko id/i)
    }
  })
})

describe("buildPriceRequest", () => {
  it("sends no auth header when no key is configured (keyless)", () => {
    const req = buildPriceRequest(COINGECKO_PUBLIC_BASE_URL, "bitcoin")
    expect(req.method).toBe("GET")
    expect(req.url).toBe(buildPriceUrl(COINGECKO_PUBLIC_BASE_URL, "bitcoin"))
    expect(req.multiHeaders).toBeUndefined()
    expect(buildPriceRequest(COINGECKO_PUBLIC_BASE_URL, "bitcoin", "").multiHeaders).toBeUndefined()
    expect(buildPriceRequest(COINGECKO_PUBLIC_BASE_URL, "bitcoin", "   ").multiHeaders).toBeUndefined()
  })

  it("sends the demo header on the public host when a key is configured", () => {
    const req = buildPriceRequest(COINGECKO_PUBLIC_BASE_URL, "bitcoin", "CG-demo")
    expect(req.multiHeaders).toEqual({ "x-cg-demo-api-key": { values: ["CG-demo"] } })
  })

  it("sends the pro header on the pro host", () => {
    const req = buildPriceRequest("https://pro-api.coingecko.com/api/v3", "bitcoin", "CG-pro")
    expect(req.multiHeaders).toEqual({ "x-cg-pro-api-key": { values: ["CG-pro"] } })
  })
})

describe("parsePriceResponse", () => {
  it("parses a whole-dollar style price", () => {
    expect(parsePriceResponse(200, '{"ethereum":{"usd":3412.57}}', "ethereum")).toBe(3_412_570_000_000_000_000_000n)
  })

  it("keeps the exact literal from the body, beyond double precision", () => {
    const body = '{"bitcoin":{"usd":109876.12345678901}}'
    expect(parsePriceResponse(200, body, "bitcoin")).toBe(109_876_123_456_789_010_000_000n)
  })

  it("handles exponent notation for PEPE-scale prices", () => {
    expect(parsePriceResponse(200, '{"pepe":{"usd":5.0079e-06}}', "pepe")).toBe(5_007_900_000_000n)
    expect(parsePriceResponse(200, '{"pepe":{"usd":1.2E-5}}', "pepe")).toBe(12_000_000_000_000n)
  })

  it("finds the right coin when several are present and whitespace varies", () => {
    const body = '{ "bitcoin" : { "usd" : 70000.5 },\n "ethereum": {"usd_24h_change": -1.5, "usd": 2500} }'
    expect(parsePriceResponse(200, body, "ethereum")).toBe(2500n * 10n ** 18n)
    expect(parsePriceResponse(200, body, "bitcoin")).toBe(70_000_500_000_000_000_000_000n)
  })

  it("throws on HTTP errors (429, 401, 500)", () => {
    expect(() => parsePriceResponse(429, '{"status":{"error_code":429}}', "ethereum")).toThrow(/429/)
    expect(() => parsePriceResponse(401, "{}", "ethereum")).toThrow(/401/)
    expect(() => parsePriceResponse(500, "Throttled", "ethereum")).toThrow(/500/)
  })

  it("throws when the coin is missing (unknown ids are silently dropped by CoinGecko)", () => {
    expect(() => parsePriceResponse(200, "{}", "not-a-coin")).toThrow(/no usd price/)
    expect(() => parsePriceResponse(200, '{"ethereum":{}}', "ethereum")).toThrow(/no usd price/)
  })

  it("throws on unparsable or non-positive prices rather than guessing", () => {
    expect(() => parsePriceResponse(200, "Throttled", "ethereum")).toThrow()
    expect(() => parsePriceResponse(200, '{"ethereum":{"usd":null}}', "ethereum")).toThrow()
    expect(() => parsePriceResponse(200, '{"ethereum":{"usd":"3000"}}', "ethereum")).toThrow()
    expect(() => parsePriceResponse(200, '{"ethereum":{"usd":0}}', "ethereum")).toThrow(/positive/)
    expect(() => parsePriceResponse(200, '{"ethereum":{"usd":-5}}', "ethereum")).toThrow()
  })
})
