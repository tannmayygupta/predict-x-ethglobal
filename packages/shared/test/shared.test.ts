import { describe, expect, it } from "vitest";
import tokensJson from "../tokens.json";
import {
  FlashOrderDetail, FlashQuoteRequest, FlashQuoteResponse, InsightResponse, Market, Pool, Position, TokensResponse,
  buildQuestion, buildTweetText, computePayout, derivePoolStatus, extractPoolId, formatUsdc, fromE18, toStrikeE18,
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
