import { describe, expect, it } from "vitest";
import tokensJson from "../tokens.json";
import {
  FlashOrderDetail, FlashQuoteRequest, FlashQuoteResponse, InsightResponse, Market, MarketChart, Pool, Position, SignedDecimalString, Token, TokensResponse,
  MAX_CHART_POINTS,
  buildQuestion, buildResultTweetText, buildTweetText, computePayout, derivePoolStatus, extractPoolId, formatUsdc, fromE18, toStrikeE18,
  toUsdcUnits, fixtures,
} from "../src";

describe("fixtures match schemas", () => {
  it("parses every fixture", () => {
    Market.parse(fixtures.marketEth);
    InsightResponse.parse(fixtures.insightEth);
    FlashQuoteResponse.parse(fixtures.quoteEthMarket);
    FlashOrderDetail.parse(fixtures.orderFilled);
    Pool.parse(fixtures.poolOpen);
    Pool.parse(fixtures.poolResolved);
    FlashQuoteResponse.parse(fixtures.quoteEthLimit);
    MarketChart.parse(fixtures.marketChartEth);
    Position.parse(fixtures.positionWinner);
    TokensResponse.parse(tokensJson);
  });
  it("pool fixtures carry the exact question the helpers would build (B-005)", () => {
    for (const p of [fixtures.poolOpen, fixtures.poolResolved]) {
      expect(fromE18(toStrikeE18(p.strikeUsd))).toBe(p.strikeUsd);
      expect(buildQuestion({ symbol: p.symbol, direction: p.direction, strikeUsd: p.strikeUsd, resolveTime: p.resolveTime })).toBe(p.question);
    }
  });
  it("limit quote needs a limit price", () => {
    const base = { walletAddress: "0x1111111111111111111111111111111111111111", symbol: "ETH", side: "buy", amount: "2" };
    expect(FlashQuoteRequest.safeParse({ ...base, orderType: "limit" }).success).toBe(false);
    expect(FlashQuoteRequest.safeParse({ ...base, orderType: "limit", limitPriceUsd: "2380" }).success).toBe(true);
    expect(FlashQuoteRequest.safeParse({ ...base, orderType: "market" }).success).toBe(true);
  });
});

describe("contract change: market stats, chart, quote factors, insight spot", () => {
  const WALLET = "0x1111111111111111111111111111111111111111";
  it("old-shape market, quote and insight parse with nulls", () => {
    const { change24hUsd, marketCapUsd, volume24hUsd, high24hUsd, low24hUsd, liquidityUsd, verified, ...oldMarket } = fixtures.marketEth;
    void [change24hUsd, marketCapUsd, volume24hUsd, high24hUsd, low24hUsd, liquidityUsd, verified];
    const m = Market.parse(oldMarket);
    expect(m.change24hUsd).toBeNull();
    expect(m.liquidityUsd).toBeNull();
    expect(m.verified).toBe(false);

    const { steps, quoteId, expiresAt, orderType, side, chain, chainId, spend, receive, feesUsd, estimatedPriceImpact } = fixtures.quoteEthMarket;
    const q = FlashQuoteResponse.parse({ steps, quoteId, expiresAt, orderType, side, chain, chainId, spend, receive, feesUsd, estimatedPriceImpact });
    expect(q.recommendedSlippage).toBeNull();
    expect(q.minReceive).toBeNull();
    expect(q.orderDeadline).toBeNull();

    const { symbol, tip, bias, confidence, suggestedLimit, degraded, disclaimer } = fixtures.insightEth;
    const i = InsightResponse.parse({ symbol, tip, bias, confidence, suggestedLimit, degraded, disclaimer });
    expect(i.spotUsd).toBeNull();
    expect(i.asOf).toBeNull();
  });
  it("negative change24hUsd parses; plain DecimalString-style junk does not", () => {
    expect(Market.safeParse({ ...fixtures.marketEth, change24hUsd: "-10.48" }).success).toBe(true);
    expect(Market.safeParse({ ...fixtures.marketEth, change24hUsd: "+10.48" }).success).toBe(false);
    expect(SignedDecimalString.safeParse("10.48").success).toBe(true);
  });
  it("expireAt is valid for limit orders only", () => {
    const base = { walletAddress: WALLET, symbol: "ETH", side: "buy", amount: "2" };
    expect(FlashQuoteRequest.safeParse({ ...base, orderType: "market", expireAt: 1761603600 }).success).toBe(false);
    expect(FlashQuoteRequest.safeParse({ ...base, orderType: "limit", limitPriceUsd: "2380", expireAt: 1761603600 }).success).toBe(true);
    expect(FlashQuoteRequest.safeParse({ ...base, orderType: "market", expireAt: null }).success).toBe(true);
  });
  it("slippage must be in (0, 1]", () => {
    const base = { walletAddress: WALLET, symbol: "ETH", side: "buy", amount: "2", orderType: "market" };
    expect(FlashQuoteRequest.safeParse({ ...base, slippage: "0" }).success).toBe(false);
    expect(FlashQuoteRequest.safeParse({ ...base, slippage: "1.5" }).success).toBe(false);
    expect(FlashQuoteRequest.safeParse({ ...base, slippage: "1" }).success).toBe(true);
    expect(FlashQuoteRequest.safeParse({ ...base, slippage: "0.15" }).success).toBe(true);
    expect(FlashQuoteRequest.safeParse({ ...base, slippage: "0.0000000000000000001" }).success).toBe(true);
    expect(FlashQuoteRequest.safeParse({ ...base, slippage: "0.000" }).success).toBe(false);
    expect(FlashQuoteRequest.safeParse({ ...base, slippage: "1.0000000000000000001" }).success).toBe(false);
    expect(FlashQuoteRequest.safeParse({ ...base, slippage: "1.000" }).success).toBe(true);
  });
  it("chart bounds: min 2 and max MAX_CHART_POINTS points", () => {
    const pts = (n: number) => Array.from({ length: n }, (_, i) => [1761513600 + i * 300, "2450.5"]);
    const chart = (n: number) => ({ ...fixtures.marketChartEth, points: pts(n) });
    expect(MarketChart.safeParse(chart(MAX_CHART_POINTS)).success).toBe(true);
    expect(MarketChart.safeParse(chart(MAX_CHART_POINTS + 1)).success).toBe(false);
    expect(MarketChart.safeParse(chart(301)).success).toBe(false);
    expect(MarketChart.safeParse(chart(1)).success).toBe(false);
    expect(MarketChart.safeParse({ ...fixtures.marketChartEth, range: "30d" }).success).toBe(false);
  });
  it("tokens.json passes Token and the TokensResponse max", () => {
    const tokens = TokensResponse.parse(tokensJson).tokens;
    expect(tokens.length).toBeLessThanOrEqual(10);
    for (const t of tokens) Token.parse(t);
    const by = (s: string) => tokens.find((t) => t.symbol === s);
    for (const s of ["ETH", "BTC", "DEGEN", "BRETT"]) {
      expect(by(s)?.flashSupported).toBe(true);
      expect(by(s)?.flashChainId).toBe(8453);
      expect(by(s)?.address).not.toBeNull();
    }
    expect(by("BTC")?.decimals).toBe(8);
    expect(by("BTC")?.onchain).toBeNull();
    expect(by("PEPE")?.flashSupported).toBe(false);
    expect(TokensResponse.safeParse({ tokens: Array.from({ length: 11 }, () => tokens[0]) }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("converts prices to and from 1e18", () => {
    expect(toStrikeE18("0.0000120")).toBe(12000000000000n);
    expect(fromE18(12000000000000n)).toBe("0.000012");
    expect(fromE18(toStrikeE18("2451.12"))).toBe("2451.12");
    expect(fromE18(0n)).toBe("0");
    expect(() => toStrikeE18("abc")).toThrow();
  });
  it("converts USDC units", () => {
    expect(toUsdcUnits("2.5")).toBe(2500000n);
    expect(formatUsdc("60000000")).toBe("60.00");
  });
  it("builds the question and the post text", () => {
    const q = buildQuestion({ symbol: "PEPE", direction: "above", strikeUsd: "0.0000120", resolveTime: 1761662400 });
    expect(q).toBe("Will $PEPE be above $0.0000120 at 14:40 UTC on 28 Oct?");
    const t = buildTweetText({ id: 12, question: q, dashboardUrl: "https://predictx.app/pool/12" });
    expect(t).toContain("PX#12");
    expect(t.endsWith("\n\n#predictx $predictx")).toBe(true);
    expect(extractPoolId(t)).toBe(12);
    expect(extractPoolId("see https://predictx.app/pool/7")).toBe(7);
    expect(extractPoolId("nothing here")).toBeNull();
  });
  it("derives pool status", () => {
    const b = { resolveTime: 100, yesTotal: "60", noTotal: "40" };
    expect(derivePoolStatus({ ...b, now: 50, resolved: false })).toBe("open");
    expect(derivePoolStatus({ ...b, now: 150, resolved: false })).toBe("awaiting");
    expect(derivePoolStatus({ ...b, now: 150, resolved: true })).toBe("resolved");
    expect(derivePoolStatus({ ...b, noTotal: "0", now: 150, resolved: true })).toBe("void");
  });
  it("matches the pitch payout example", () => {
    // YES $60, NO $40, fee 2%, YES wins: a $30 YES stake receives $49
    expect(computePayout(30_000_000n, 60_000_000n, 40_000_000n, 200)).toBe(49_000_000n);
  });
});

describe("draft post text", () => {
  const url = "https://predictx.app/pool/12";
  const question = "Will $ETH be above $2236 at 23:06 UTC on 6 Nov?";

  it("every pool draft carries the project tags and still fits in a post", () => {
    const t = buildTweetText({ id: 12, question, dashboardUrl: url });
    expect(t).toBe(`${question}\n\nBet YES or NO: ${url}\nPX#12\n\n#predictx $predictx`);
    const longest = "Will $PEPE be above $0.00001234567890 at 23:06 UTC on 6 Nov? ".padEnd(140, "x");
    expect(() => buildTweetText({ id: 123456, question: longest, dashboardUrl: url })).not.toThrow();
  });

  it("a result announcement states the verdict, the price, the marker and the tags", () => {
    const yes = buildResultTweetText({ id: 12, question, outcome: "yes", priceLabel: "$2,238.51", dashboardUrl: url });
    expect(yes.startsWith("Result: YES.")).toBe(true);
    expect(yes).toContain("Price at close: $2,238.51.");
    expect(yes).toContain("Settled by Chainlink CRE (simulation).");
    expect(extractPoolId(yes)).toBe(12);
    expect(yes.endsWith("#predictx $predictx")).toBe(true);
    expect(buildResultTweetText({ id: 12, question, outcome: "no", priceLabel: "$2,100", dashboardUrl: url }).startsWith("Result: NO.")).toBe(true);
  });

  it("a pool nobody took the other side of announces a refund, with no price", () => {
    const t = buildResultTweetText({ id: 12, question, outcome: null, priceLabel: null, dashboardUrl: url });
    expect(t).toContain("everyone is refunded");
    expect(t).not.toContain("Price at close");
  });
});
