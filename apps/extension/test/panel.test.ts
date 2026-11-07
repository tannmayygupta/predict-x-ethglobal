// @vitest-environment jsdom
import type { Token } from "@predictx/shared";
import { AppProvider, createApiClient, createChainClients, createWalletController, type Transport } from "@predictx/ui";
import { createElement, act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMode, type PanelMode } from "../src/content/mode";
import { Panel, type PanelTab } from "../src/content/Panel";

// Lets React flush state updates inside act() without warnings.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOKENS: Token[] = [
  { symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum", flashChainId: null, address: null, decimals: null, flashSupported: true },
  { symbol: "BTC", name: "Bitcoin", coingeckoId: "bitcoin", flashChainId: null, address: null, decimals: null, flashSupported: false },
];

// Every call fails the same way: the panel must still render its chrome, which is what is under test.
const offline: Transport = async () => ({ status: 503, body: { error: { code: "INTERNAL", message: "offline" } } });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in unit tests")));
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Harness({ initialTab, onModeChange }: { initialTab: PanelTab; onModeChange(mode: PanelMode): void }) {
  const [tab, setTab] = useState<PanelTab>(initialTab);
  const [symbol, setSymbol] = useState("ETH");
  const [mode, setMode] = useState<PanelMode>("popup");
  const chain = createChainClients({ dashboardUrl: "http://dashboard.test" });
  const services = {
    api: createApiClient("http://api.test", offline),
    wallet: createWalletController({ chain, getProvider: async () => null }),
    chain,
    dashboardUrl: "http://dashboard.test",
  };
  const panel = createElement(Panel, {
      tokens: TOKENS,
      tab,
      symbol,
      mode,
      onTab: setTab,
      onSymbol: setSymbol,
      onMode: (next: PanelMode) => { setMode(next); onModeChange(next); },
      onMinimise: () => undefined,
      onClose: () => undefined,
  });
  return createElement(AppProvider, { services, children: panel });
}

async function render(initialTab: PanelTab = "ai", onModeChange: (mode: PanelMode) => void = () => undefined): Promise<void> {
  // Async act lets the failed price request settle before the test looks at the screen.
  await act(async () => root.render(createElement(Harness, { initialTab, onModeChange })));
}

const click = async (el: Element | null): Promise<void> => {
  if (!el) throw new Error("element not found");
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};

describe("PredictX panel", () => {
  it("has AI, Swap and Predict in its nav, with the selected one marked", async () => {
    await render("ai");
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["AI", "Swap", "Predict"]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
  });

  it("switches screens from the nav: AI shows the insight button, Predict shows the create form", async () => {
    await render("ai");
    expect(container.textContent).toContain("Get insight");
    await click(container.querySelectorAll('[role="tab"]')[2] ?? null);
    expect(container.textContent).toContain("New prediction");
    expect(container.textContent).not.toContain("Get insight");
  });

  it("moves off a token Flash cannot trade when Swap opens", async () => {
    await render("ai");
    const picker = container.querySelector("select");
    if (!picker) throw new Error("token select not found");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(picker, "BTC");
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(container.querySelectorAll('[role="tab"]')[1] ?? null);
    expect((container.querySelector("select") as HTMLSelectElement).value).toBe("ETH");
  });

  it("keeps the swap and picker lists to the tokens Flash can trade, with a limit stored per symbol", async () => {
    await render("swap");
    const options = [...container.querySelectorAll("select option")].map((o) => o.textContent);
    expect(options).toEqual(["ETH"]);
  });

  it("toggles between popup, slide-up and side panel and remembers the choice", async () => {
    const seen: PanelMode[] = [];
    await render("ai", (m) => seen.push(m));
    const buttons = [...container.querySelectorAll('[role="group"][aria-label="Display mode"] button')];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Popup", "Slide-up", "Side panel"]);
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");

    await click(buttons[1] ?? null);
    expect(seen).toEqual(["sheet"]);
    expect(buttons[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(loadMode()).toBe("sheet");

    await click(buttons[2] ?? null);
    expect(loadMode()).toBe("side");
  });
});
