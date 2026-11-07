// @vitest-environment jsdom
import { fixtures, type Token } from "@predictx/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SwapPanel } from "../src/components/SwapPanel";
import { COPY } from "../src/copy";
import { fakeApi, withApp } from "./support";

afterEach(cleanup);

const ETH: Token = {
  symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum", flashChainId: 8453,
  address: "0x4200000000000000000000000000000000000006", decimals: 18, flashSupported: true, network: "base",
};

async function open(api = fakeApi(), initialLimit: string | null = null) {
  render(withApp(api, <SwapPanel token={ETH} initialLimit={initialLimit} />));
  await screen.findByText("$2,451.12"); // the live reference price
  return api;
}

const typeAmount = (v: string) => fireEvent.change(screen.getByLabelText("Spend (USDC)"), { target: { value: v } });
const typeLimit = (v: string) => fireEvent.change(screen.getByLabelText("Buy when price is at or below"), { target: { value: v } });

describe("SwapPanel", () => {
  it("shows the live gap below market and fills the preset prices", async () => {
    await open();
    fireEvent.click(screen.getByRole("radio", { name: "Limit" }));
    fireEvent.click(screen.getByRole("button", { name: "-2%" }));
    expect((screen.getByLabelText("Buy when price is at or below") as HTMLInputElement).value).toBe("2402.09");
    expect(screen.getByText("2.00% below market")).toBeTruthy();
  });

  it("warns when a limit is at or above market", async () => {
    await open();
    fireEvent.click(screen.getByRole("radio", { name: "Limit" }));
    typeLimit("2500");
    expect((await screen.findByRole("alert")).textContent).toBe(COPY.limit_above_market);
  });

  it("renders the quote rows from a market quote and sends the slippage, not an expiry", async () => {
    const api = await open();
    typeAmount("2");
    fireEvent.click(screen.getByRole("button", { name: COPY.get_quote }));
    expect(await screen.findByText(COPY.you_spend)).toBeTruthy();
    for (const label of [COPY.you_get, COPY.rate, COPY.effective_vs_market, COPY.network_cost, COPY.min_received, COPY.slippage, COPY.order_expires]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("$0.04")).toBeTruthy(); // 2.00 spent - 1.96 received
    expect(screen.getByText(/suggested 15%/)).toBeTruthy();
    expect(screen.getByRole("button", { name: COPY.place_order }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(COPY.orders_off)).toBeTruthy();
    expect(screen.queryByText(COPY.mock_badge)).toBeNull();
    const sent = vi.mocked(api.flashQuote).mock.calls[0]?.[0];
    expect(sent).toMatchObject({ orderType: "market", slippage: "0.01", amount: "2" });
    expect(sent).not.toHaveProperty("expireAt");
  });

  it("shows the MOCK badge only for mock quote ids", async () => {
    await open(fakeApi({ flashQuote: vi.fn().mockResolvedValue({ ...fixtures.quoteEthMarket, quoteId: "q_mock_1" }) }));
    typeAmount("2");
    fireEvent.click(screen.getByRole("button", { name: COPY.get_quote }));
    expect(await screen.findByText(COPY.mock_badge)).toBeTruthy();
  });

  it("sends the chosen expiry on a limit order and omits slippage", async () => {
    const api = await open(fakeApi({ flashQuote: vi.fn().mockResolvedValue(fixtures.quoteEthLimit) }));
    fireEvent.click(screen.getByRole("radio", { name: "Limit" }));
    typeLimit("2380");
    typeAmount("2");
    fireEvent.change(screen.getByLabelText(COPY.order_expires), { target: { value: "1h" } });
    fireEvent.click(screen.getByRole("button", { name: COPY.get_quote }));
    await screen.findByText(COPY.you_spend);
    await waitFor(() => expect(api.flashQuote).toHaveBeenCalled());
    const sent = vi.mocked(api.flashQuote).mock.calls[0]?.[0];
    expect(sent).toMatchObject({ orderType: "limit", limitPriceUsd: "2380" });
    expect(sent).not.toHaveProperty("slippage");
    expect(typeof sent?.expireAt).toBe("number");
  });
});
