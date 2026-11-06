/**
 * One wallet path for every surface (decision D-007): an EIP-1193 provider, MetaMask only. The dashboard talks to
 * the page's provider directly; the extension talks to the same provider through its page bridge. Both hand the
 * provider to createWalletController, so connect, account changes and network changes behave identically.
 */
import { custom, type Address, type EIP1193Provider } from "viem";
import type { Session } from "./actions";
import { createPoolWalletClient, type ChainClients } from "./chain";
import { UiError, toUiError } from "./errors";
import type { Eip1193Provider } from "./provider";

export type { Eip1193Provider } from "./provider";

export type WalletStatus = "no-wallet" | "disconnected" | "connecting" | "connected";

export interface WalletState {
  status: WalletStatus;
  address: Address | null;
  chainId: number | null;
  error: UiError | null;
}

export interface WalletController {
  getState(): WalletState;
  subscribe(listener: () => void): () => void;
  /** Reads an already-approved account without prompting. Safe to call on load. */
  restore(): Promise<void>;
  connect(): Promise<void>;
  switchToPoolChain(): Promise<void>;
  /** The signing session for actions.ts. Throws NO_WALLET unless connected. */
  session(): Session;
  dispose(): void;
}

const UNRECOGNISED_CHAIN = 4902;

function firstAddress(accounts: unknown): Address | null {
  const first: unknown = Array.isArray(accounts) ? accounts[0] : undefined;
  return typeof first === "string" && /^0x[0-9a-fA-F]{40}$/.test(first) ? (first as Address) : null;
}

function parseChainId(value: unknown): number | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value) ? Number.parseInt(value, 16) : null;
}

export function createWalletController(options: {
  chain: ChainClients;
  getProvider: () => Promise<Eip1193Provider | null>;
}): WalletController {
  let state: WalletState = { status: "disconnected", address: null, chainId: null, error: null };
  let provider: Eip1193Provider | null = null;
  const listeners = new Set<() => void>();

  const set = (patch: Partial<WalletState>): void => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  const onAccounts = (accounts: unknown): void => {
    const address = firstAddress(accounts);
    set(address ? { status: "connected", address, error: null } : { status: "disconnected", address: null });
  };
  const onChain = (chainId: unknown): void => set({ chainId: parseChainId(chainId) });

  async function attach(): Promise<Eip1193Provider | null> {
    if (provider) return provider;
    const found = await options.getProvider();
    if (!found) {
      set({ status: "no-wallet" });
      return null;
    }
    provider = found;
    found.on?.("accountsChanged", onAccounts);
    found.on?.("chainChanged", onChain);
    return found;
  }

  async function load(method: "eth_accounts" | "eth_requestAccounts"): Promise<void> {
    const p = await attach();
    if (!p) return;
    onAccounts(await p.request({ method }));
    set({ chainId: parseChainId(await p.request({ method: "eth_chainId" })) });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async restore() {
      try {
        await load("eth_accounts");
      } catch (err) {
        set({ error: toUiError(err) });
      }
    },
    async connect() {
      if (state.status === "connecting") return;
      set({ status: "connecting", error: null });
      try {
        await load("eth_requestAccounts");
      } catch (err) {
        set({ status: state.address ? "connected" : "disconnected", error: toUiError(err) });
      }
    },
    async switchToPoolChain() {
      const p = provider;
      if (!p) throw new UiError("NO_WALLET", "Install MetaMask to continue.");
      const hexId = `0x${options.chain.chainId.toString(16)}`;
      try {
        await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
      } catch (err) {
        const code = typeof err === "object" && err !== null && "code" in err ? (err as { code: unknown }).code : undefined;
        if (code !== UNRECOGNISED_CHAIN) throw toUiError(err);
        try {
          await p.request({ method: "wallet_addEthereumChain", params: [addChainParams(options.chain, hexId)] });
        } catch (addErr) {
          throw toUiError(addErr);
        }
      }
      onChain(await p.request({ method: "eth_chainId" }));
    },
    session() {
      if (!provider || state.status !== "connected" || !state.address) throw new UiError("NO_WALLET", "Install MetaMask to continue.");
      // viem's EIP1193Provider is a much larger overloaded type; the methods it will call all exist on a real provider.
      const wallet = createPoolWalletClient(custom(provider as unknown as EIP1193Provider));
      return { chain: options.chain, wallet, account: state.address };
    },
    dispose() {
      provider?.removeListener?.("accountsChanged", onAccounts);
      provider?.removeListener?.("chainChanged", onChain);
      listeners.clear();
    },
  };
}

function addChainParams(chain: ChainClients, hexId: string) {
  return {
    chainId: hexId,
    chainName: "Base Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [chain.rpcUrl],
    blockExplorerUrls: ["https://sepolia.basescan.org"],
  };
}
