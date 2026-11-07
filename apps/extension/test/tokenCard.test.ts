// @vitest-environment jsdom
import type { Token } from "@predictx/shared";
import { AppProvider, createApiClient, createChainClients, createWalletController, type Transport } from "@predictx/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenCard } from "../src/content/cards/TokenCard";
import { createHoverStore, type HoverStore } from "../src/x/hoverStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ETH: Token = { symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum", flashChainId: 8453, address: null, decimals: 18, flashSupported: true };
const PEPE: Token = { symbol: "PEPE", name: "Pepe", coingeckoId: "pepe", flashChainId: null, address: null, decimals: null, flashSupported: false };
const anchor = { left: 100, top: 200, right: 140, bottom: 220 };
const offline: Transport = async () => ({ status: 503, body: { error: { code: "INTERNAL", message: "offline" } } });

let container: HTMLDivElement;
let root: Root;
let store: HoverStore;

beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in unit tests")));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  store = createHoverStore();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(token: Token, calls: { swap: string[]; details: string[]; predict: string[] }): Promise<void> {
  const chain = createChainClients({ dashboardUrl: "http://dashboard.test" });
  const services = {
    api: createApiClient("http://api.test", offline),
    wallet: createWalletController({ chain, getProvider: async () => null }),
    chain,
    dashboardUrl: "http://dashboard.test",
  };
  const card = createElement(TokenCard, {
    token,
    anchor,
    store,
    onSwap: (s: string) => calls.swap.push(s),
    onDetails: (s: string) => calls.details.push(s),
    onPredict: (s: string) => calls.predict.push(s),
  });
  await act(async () => root.render(createElement(AppProvider, { services, children: card })));
}

const buttonByText = (text: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!found) throw new Error(`button ${text} not found`);
  return found;
};

describe("TokenCard wrapper", () => {
  it("is a fixed dialog placed under the tag and 480 px wide", async () => {
    window.innerWidth = 1200;
    await render(ETH, { swap: [], details: [], predict: [] });
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute("aria-label")).toBe("Ethereum ETH");
    expect(dialog.style.left).toBe("100px");
    expect(dialog.style.top).toBe("228px");
    expect(dialog.style.width).toBe("480px");
  });

  it("closes the card first, then opens the panel on Swap or AI", async () => {
    const calls = { swap: [] as string[], details: [] as string[], predict: [] as string[] };
    const close = vi.spyOn(store, "close");
    await render(ETH, calls);
    await act(async () => buttonByText("Swap").click());
    expect(close).toHaveBeenCalledTimes(1);
    expect(calls.swap).toEqual(["ETH"]);
    await act(async () => buttonByText("View details").click());
    expect(calls.details).toEqual(["ETH"]);
  });

  it("disables Swap with an explanation for a token Flash cannot trade", async () => {
    await render(PEPE, { swap: [], details: [], predict: [] });
    const swap = buttonByText("Swap");
    expect(swap.disabled).toBe(true);
    expect(swap.title).toBe("Swap unavailable for this token");
  });

  it("closes when the page scrolls so it never floats away from the tag", async () => {
    store.enterTag("ETH", anchor);
    const close = vi.spyOn(store, "close");
    await render(ETH, { swap: [], details: [], predict: [] });
    await act(async () => { document.dispatchEvent(new Event("scroll")); });
    expect(close).toHaveBeenCalled();
  });

  it("ignores scrolls inside the card or in other boxes on the page", async () => {
    const close = vi.spyOn(store, "close");
    await render(ETH, { swap: [], details: [], predict: [] });
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    const other = document.createElement("div");
    document.body.append(other);
    await act(async () => {
      dialog.dispatchEvent(new Event("scroll"));
      other.dispatchEvent(new Event("scroll"));
    });
    other.remove();
    expect(close).not.toHaveBeenCalled();
  });
});
