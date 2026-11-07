// @vitest-environment jsdom
import { fixtures, type Token } from "@predictx/shared";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PriceChart } from "../src/components/market/PriceChart";
import { TokenMarketCard } from "../src/components/market/TokenMarketCard";
import { COPY } from "../src/copy";
import { EM_DASH } from "../src/marketFormat";
import { fakeApi, withApp } from "./support";

afterEach(cleanup);

const ETH: Token = {
  symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum", flashChainId: 8453,
  address: "0x4200000000000000000000000000000000000006", decimals: 18, flashSupported: true, network: "base",
};
const PEPE: Token = { symbol: "PEPE", name: "Pepe", coingeckoId: "pepe", flashChainId: null, address: null, decimals: null, flashSupported: false, network: "ethereum" };

const handlers = () => ({ onSwap: vi.fn(), onDetails: vi.fn(), onPredict: vi.fn(), onClose: vi.fn() });

describe("TokenMarketCard", () => {
  it("shows price, change, stats, the Verified pill and the chart", async () => {
    render(withApp(fakeApi(), <TokenMarketCard token={ETH} {...handlers()} />));
    expect((await screen.findByTestId("card-price")).textContent).toBe("$2,451.12");
    expect(screen.getByTestId("card-change").textContent).toBe("-$44.93 (-1.80%)");
    expect(screen.getByText("$295.82B")).toBeTruthy();
    expect(screen.getByText("$138.69M")).toBeTruthy();
    expect(screen.getByText("$11.58B")).toBeTruthy();
    expect(screen.getByText(COPY.verified)).toBeTruthy();
    expect(await screen.findByTestId("last-price-tag")).toBeTruthy();
    expect(screen.getByText("now")).toBeTruthy();
  });

  it("renders an em dash for a missing stat and hides the pill when not verified", async () => {
    const market = { ...fixtures.marketEth, liquidityUsd: null, marketCapUsd: null, verified: false };
    render(withApp(fakeApi({ market: vi.fn().mockResolvedValue(market) }), <TokenMarketCard token={ETH} {...handlers()} />));
    await screen.findByTestId("card-price");
    expect(screen.getAllByText(EM_DASH).length).toBe(2);
    expect(screen.queryByText(COPY.verified)).toBeNull();
  });

  it("disables Swap with an explanation when Flash cannot trade the token", async () => {
    render(withApp(fakeApi(), <TokenMarketCard token={PEPE} {...handlers()} />));
    const swap = screen.getByRole("button", { name: COPY.swap }) as HTMLButtonElement;
    expect(swap.disabled).toBe(true);
    expect(swap.title).toBe(COPY.swap_unavailable);
    await screen.findByTestId("card-price");
  });

  it("closes the card first, then runs the action", async () => {
    const h = handlers();
    const order: string[] = [];
    h.onClose.mockImplementation(() => order.push("close"));
    h.onSwap.mockImplementation(() => order.push("swap"));
    render(withApp(fakeApi(), <TokenMarketCard token={ETH} {...h} />));
    await screen.findByTestId("card-price");
    fireEvent.click(screen.getByRole("button", { name: COPY.swap }));
    expect(order).toEqual(["close", "swap"]);
    fireEvent.click(screen.getByRole("button", { name: COPY.view_details }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(COPY.predict_this_price) }));
    expect(h.onDetails).toHaveBeenCalled();
    expect(h.onPredict).toHaveBeenCalled();
  });

  it("opens the menu with its three entries and closes it on Escape", async () => {
    render(withApp(fakeApi(), <TokenMarketCard token={ETH} {...handlers()} />));
    await screen.findByTestId("card-price");
    const kebab = screen.getByRole("button", { name: "More" });
    expect(kebab.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(kebab);
    const menu = screen.getByRole("menu");
    for (const label of [COPY.copy_address, COPY.view_basescan, COPY.open_dashboard]) {
      expect(within(menu).getByRole("menuitem", { name: label })).toBeTruthy();
    }
    expect(within(menu).getByRole("menuitem", { name: COPY.view_basescan }).getAttribute("href")).toBe(
      "https://basescan.org/token/0x4200000000000000000000000000000000000006",
    );
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows the chart error state", async () => {
    const failing = fakeApi({ chart: vi.fn().mockRejectedValue(new Error("x")) });
    render(withApp(failing, <TokenMarketCard token={ETH} {...handlers()} />));
    expect((await screen.findByRole("alert")).textContent).toContain(COPY.chart_error);
  });

  it("shows Price delayed for an old cached price", async () => {
    const old = { ...fixtures.marketEth, updatedAt: 1 };
    render(withApp(fakeApi({ market: vi.fn().mockResolvedValue(old) }), <TokenMarketCard token={ETH} {...handlers()} />));
    expect(await screen.findByText(COPY.price_delayed)).toBeTruthy();
  });

  it("labels the chart by range and scrubs with the keyboard", async () => {
    render(withApp(fakeApi(), <TokenMarketCard token={ETH} {...handlers()} />));
    const plot = await screen.findByTestId("chart-plot");
    expect(screen.getByRole("img", { name: /price, last/ }).getAttribute("aria-label")).toBe("ETH price, last 24 hours");
    fireEvent.focus(plot);
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(plot.getAttribute("aria-valuenow")).toBe("3");
    expect(screen.getByTestId("card-price").textContent).toBe("$2,462.77");
    fireEvent.keyDown(plot, { key: "Escape" });
    expect(screen.getByTestId("card-price").textContent).toBe("$2,451.12");
  });

  it("shows the Base badge only for tokens on Base, and explains Verified", async () => {
    const BTC: Token = { ...ETH, symbol: "BTC", name: "Bitcoin", network: "bitcoin", flashChainId: null, address: null };
    render(withApp(fakeApi(), <TokenMarketCard token={BTC} {...handlers()} />));
    await screen.findByTestId("card-price");
    expect(screen.queryByRole("img", { name: "Base" })).toBeNull();
    expect(screen.getByText(COPY.verified).closest("span")?.getAttribute("title")).toBe(COPY.verified_hint);
  });

  it("shows the Base badge for a Base token", async () => {
    render(withApp(fakeApi(), <TokenMarketCard token={ETH} {...handlers()} />));
    await screen.findByTestId("card-price");
    expect(screen.getByRole("img", { name: "Base" })).toBeTruthy();
  });

  it("shows Chart delayed when the series is stale", () => {
    const view = { chart: fixtures.marketChartEth, loading: false, error: null, stale: true, retry: vi.fn() };
    render(<PriceChart view={view} up />);
    expect(screen.getByText(COPY.chart_delayed)).toBeTruthy();
  });

  it("reports a missing clipboard and clears the note", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(withApp(fakeApi(), <TokenMarketCard token={ETH} {...handlers()} />));
    await vi.advanceTimersByTimeAsync(0);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: COPY.copy_address }));
    expect(screen.getByText(COPY.copy_failed)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "More" }));
    await vi.advanceTimersByTimeAsync(2100);
    expect(screen.queryByText(COPY.copy_failed)).toBeNull();
    vi.useRealTimers();
  });
});
