/** CoinGecko simple/price request building and response parsing (docs/notes/coingecko-api.md). */
import { decimalToE18 } from "./price"

export const COINGECKO_PUBLIC_BASE_URL = "https://api.coingecko.com/api/v3"

export type PriceRequest = {
  url: string
  method: "GET"
  multiHeaders?: Record<string, { values: string[] }>
}

// CoinGecko coin ids are lowercase slugs such as "ethereum", "based-brett", "degen-base".
const COINGECKO_ID_RE = /^[a-z0-9][a-z0-9._-]*$/

function assertCoingeckoId(coingeckoId: string): void {
  if (!COINGECKO_ID_RE.test(coingeckoId) || coingeckoId.includes("..")) {
    throw new Error(`invalid coingecko id: "${coingeckoId}"`)
  }
}

export function buildPriceUrl(baseUrl: string, coingeckoId: string): string {
  assertCoingeckoId(coingeckoId)
  const base = baseUrl.replace(/\/+$/, "")
  return `${base}/simple/price?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=usd&precision=full`
}

/**
 * Keyless unless a key is configured. An invalid demo key fails instead of falling back to keyless,
 * so the header is only sent when a key is present. The header name follows the host.
 */
export function buildPriceRequest(baseUrl: string, coingeckoId: string, apiKey?: string): PriceRequest {
  const request: PriceRequest = { url: buildPriceUrl(baseUrl, coingeckoId), method: "GET" }
  const key = apiKey?.trim()
  if (key) {
    const header = baseUrl.includes("pro-api.coingecko.com") ? "x-cg-pro-api-key" : "x-cg-demo-api-key"
    request.multiHeaders = { [header]: { values: [key] } }
  }
  return request
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Returns the USD price scaled by 1e18, or throws if the response is not a usable price.
 * The price is read from the raw JSON number literal so no digit is lost to a double; the
 * parsed JSON is used to validate structure and cross-check the literal.
 */
export function parsePriceResponse(statusCode: number, body: string, coingeckoId: string): bigint {
  if (statusCode < 200 || statusCode > 299) {
    throw new Error(`coingecko HTTP ${statusCode} for ${coingeckoId}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error(`coingecko response for ${coingeckoId} is not JSON`)
  }
  const entry = (parsed as Record<string, unknown> | null)?.[coingeckoId] as Record<string, unknown> | undefined
  const usd = entry?.usd
  if (typeof usd !== "number") {
    throw new Error(`coingecko returned no usd price for ${coingeckoId}`)
  }
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new Error(`coingecko price for ${coingeckoId} is not a positive number: ${usd}`)
  }

  const objectRe = new RegExp(`"${escapeRegExp(coingeckoId)}"\\s*:\\s*\\{([^{}]*)\\}`)
  const inner = objectRe.exec(body)?.[1]
  const literal = inner === undefined ? undefined : /"usd"\s*:\s*([0-9][0-9.eE+-]*)/.exec(inner)?.[1]
  if (literal === undefined || Number(literal) !== usd) {
    throw new Error(`could not read the exact usd literal for ${coingeckoId}`)
  }

  const priceE18 = decimalToE18(literal)
  if (priceE18 <= 0n) {
    throw new Error(`coingecko price for ${coingeckoId} is below 1e-18 USD`)
  }
  return priceE18
}
