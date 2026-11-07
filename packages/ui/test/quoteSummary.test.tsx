// @vitest-environment jsdom
import { fixtures, type Token } from "@predictx/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuoteSummary } from "../src/components/swap/QuoteSummary";
import { COPY } from "../src/copy";
import { withApp, fakeApi } from "./support";

afterEach(cleanup);

const TOKEN: Token = {
  symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum", flashChainId: 8453,
  address: "0x4200000000000000000000000000000000000006", decimals: 18, flashSupported: true, network: "base",
};

const show = (quote: typeof fixtures.quoteEthMarket, now: number, livePrice: string | null) =>
  render(withApp(fakeApi(), <QuoteSummary quote={quote} token={TOKEN} now={now} chosenExpireAt={null} livePrice={livePrice} onRefresh={vi.fn()} />));

describe("QuoteSummary", () => {
  it("falls back to the live price when the quote's market price is zero", () => {
    const quote = { ...fixtures.quoteEthMarket, marketPriceUsd: "0", effectivePriceUsd: "2451.12" };
    show(quote, quote.expiresAt - 10, "2451.12");
    expect(screen.getByText(COPY.effective_vs_market)).toBeTruthy();
  });

  it("says expired for an order deadline in the past", () => {
    const quote = { ...fixtures.quoteEthMarket, orderDeadline: 1000 };
    show(quote, 5000, null);
    expect(screen.getByText(COPY.order_expired)).toBeTruthy();
    expect(screen.queryByText(/about d/)).toBeNull();
  });
});
