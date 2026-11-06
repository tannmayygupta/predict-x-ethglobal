import { ApiError, Market, TokensResponse } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { PriceSourceError } from "../../src/clients/priceSource";
import { buildTestApp } from "../helpers/build";
import { FakePriceSource } from "../helpers/fakes/priceSource";

/**
 * T-B02's rows of the FR-B-01 contract table (B04-29): the canonical request for each endpoint
 * must parse with the exact schema the frontend imports. Shapes come only from @predictx/shared (X-05).
 */

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

function pricedSource(): FakePriceSource {
  const source = new FakePriceSource();
  source.prices.ethereum = { usd: 2451.12, usd24hChange: -1.8 };
  return source;
}

interface ContractRow {
  name: string;
  url: string;
  parse: (body: unknown) => void;
}

const rows: ContractRow[] = [
  // Health has no shared schema; the contract fixes the literal body.
  { name: "GET /health", url: "/api/v1/health", parse: (body) => expect(body).toEqual({ ok: true }) },
  { name: "GET /tokens", url: "/api/v1/tokens", parse: (body) => TokensResponse.parse(body) },
  { name: "GET /market/:symbol", url: "/api/v1/market/ETH", parse: (body) => Market.parse(body) },
];

describe("B04-29 contract rows owned by T-B02 (FR-B-01)", () => {
  it.each(rows)("$name returns 200 and parses with its shared schema", async ({ url, parse }) => {
    built = await buildTestApp({ priceSource: pricedSource() });
    const res = await built.app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
    expect(() => parse(res.json())).not.toThrow();
  });
});

interface ErrorRow {
  code: string;
  status: number;
  url: string;
  priceSource?: FakePriceSource;
}

function failingSource(): FakePriceSource {
  const source = new FakePriceSource();
  source.failWith = new PriceSourceError("boom", 500);
  return source;
}

const errorRows: ErrorRow[] = [
  { code: "BAD_REQUEST", status: 400, url: `/api/v1/market/${"A".repeat(13)}` },
  { code: "UNSUPPORTED_TOKEN", status: 400, url: "/api/v1/market/DOGE" },
  { code: "NOT_FOUND", status: 404, url: "/api/v1/market" },
  { code: "INTERNAL", status: 502, url: "/api/v1/market/ETH", priceSource: failingSource() },
];

describe("B04-30 error codes reachable through T-B02 endpoints parse with ApiError (FR-B-07)", () => {
  it.each(errorRows)("$code via $url", async ({ code, status, url, priceSource }) => {
    built = await buildTestApp({ priceSource: priceSource ?? pricedSource() });
    const res = await built.app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(status);
    expect(ApiError.parse(res.json()).error.code).toBe(code);
  });
});
