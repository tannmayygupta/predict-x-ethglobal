import { fixtures } from "@predictx/shared";
import type { ReactNode } from "react";
import { vi } from "vitest";
import type { ApiClient } from "../src/api";
import { createChainClients } from "../src/chain";
import { AppProvider } from "../src/context";
import type { WalletController, WalletState } from "../src/wallet";

export const HOLDER = "0x1111111111111111111111111111111111111111";
const chain = createChainClients();

export function wallet(state: Partial<WalletState> = {}): WalletController {
  const full: WalletState = { status: "connected", address: HOLDER, chainId: chain.chainId, error: null, ...state };
  return {
    getState: () => full,
    subscribe: () => () => undefined,
    restore: async () => undefined,
    connect: async () => undefined,
    switchToPoolChain: async () => undefined,
    session: () => { throw new Error("not used"); },
    dispose: () => undefined,
  };
}

/** An API whose every call resolves with the shared example responses unless the test overrides it. */
export function fakeApi(over: Partial<ApiClient> = {}): ApiClient {
  return {
    tokens: vi.fn().mockResolvedValue([]),
    market: vi.fn().mockResolvedValue(fixtures.marketEth),
    chart: vi.fn().mockResolvedValue(fixtures.marketChartEth),
    insight: vi.fn().mockResolvedValue(fixtures.insightEth),
    flashQuote: vi.fn().mockResolvedValue(fixtures.quoteEthMarket),
    pools: vi.fn().mockResolvedValue([]),
    pool: vi.fn().mockResolvedValue(fixtures.poolOpen),
    position: vi.fn().mockResolvedValue(fixtures.positionWinner),
    ...over,
  };
}

export function withApp(api: ApiClient, children: ReactNode, w: WalletController = wallet()) {
  return <AppProvider services={{ api, wallet: w, chain, dashboardUrl: "https://predictx.test" }}>{children}</AppProvider>;
}
