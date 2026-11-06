import { describe, expect, it, vi } from "vitest";
import { createChainClients } from "../src/chain";
import type { Eip1193Provider } from "../src/provider";
import { createWalletController } from "../src/wallet";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const BASE_SEPOLIA_HEX = "0x14a34";
const chain = createChainClients();

type Handler = (...args: unknown[]) => void;

/** A MetaMask stand-in: answers the JSON-RPC calls the controller makes and lets a test fire wallet events. */
function fakeWallet(overrides: Record<string, (params?: unknown) => unknown> = {}) {
  const handlers = new Map<string, Handler>();
  const calls: Array<{ method: string; params?: unknown }> = [];
  const methods: Record<string, (params?: unknown) => unknown> = {
    eth_accounts: () => [A],
    eth_requestAccounts: () => [A],
    eth_chainId: () => BASE_SEPOLIA_HEX,
    wallet_switchEthereumChain: () => null,
    ...overrides,
  };
  const provider: Eip1193Provider = {
    async request({ method, params }) {
      calls.push({ method, ...(params === undefined ? {} : { params }) });
      const fn = methods[method];
      if (!fn) throw new Error(`unexpected ${method}`);
      return fn(params);
    },
    on: (event, listener) => void handlers.set(event, listener),
    removeListener: (event) => void handlers.delete(event),
  };
  return { provider, calls, emit: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args), handlers };
}

function controllerFor(provider: Eip1193Provider | null) {
  return createWalletController({ chain, getProvider: async () => provider });
}

describe("wallet controller", () => {
  it("starts disconnected and reports no-wallet when MetaMask is missing", async () => {
    const c = controllerFor(null);
    expect(c.getState().status).toBe("disconnected");
    await c.connect();
    expect(c.getState().status).toBe("no-wallet");
  });

  it("restore() reads an approved account without prompting for one", async () => {
    const w = fakeWallet();
    const c = controllerFor(w.provider);
    await c.restore();
    expect(c.getState()).toMatchObject({ status: "connected", address: A, chainId: 84532 });
    expect(w.calls.map((x) => x.method)).toEqual(["eth_accounts", "eth_chainId"]);
  });

  it("restore() stays disconnected when no account is approved yet", async () => {
    const c = controllerFor(fakeWallet({ eth_accounts: () => [] }).provider);
    await c.restore();
    expect(c.getState()).toMatchObject({ status: "disconnected", address: null });
  });

  it("connect() prompts, then holds the account and chain", async () => {
    const w = fakeWallet();
    const c = controllerFor(w.provider);
    await c.connect();
    expect(c.getState()).toMatchObject({ status: "connected", address: A, chainId: 84532, error: null });
    expect(w.calls[0]?.method).toBe("eth_requestAccounts");
  });

  it("a rejected connect returns to disconnected with a USER_REJECTED error", async () => {
    const reject = Object.assign(new Error("User rejected"), { code: 4001 });
    const c = controllerFor(fakeWallet({ eth_requestAccounts: () => { throw reject; } }).provider);
    await c.connect();
    expect(c.getState()).toMatchObject({ status: "disconnected", address: null });
    expect(c.getState().error?.code).toBe("USER_REJECTED");
  });

  it("follows accountsChanged and chainChanged from the wallet", async () => {
    const w = fakeWallet();
    const c = controllerFor(w.provider);
    await c.connect();
    w.emit("accountsChanged", [B]);
    expect(c.getState().address).toBe(B);
    w.emit("chainChanged", "0x1");
    expect(c.getState().chainId).toBe(1);
    w.emit("accountsChanged", []);
    expect(c.getState()).toMatchObject({ status: "disconnected", address: null });
  });

  it("notifies subscribers on every change and stops after unsubscribe", async () => {
    const w = fakeWallet();
    const c = controllerFor(w.provider);
    const listener = vi.fn();
    const off = c.subscribe(listener);
    await c.connect();
    expect(listener).toHaveBeenCalled();
    off();
    listener.mockClear();
    w.emit("chainChanged", "0x1");
    expect(listener).not.toHaveBeenCalled();
  });

  it("session() refuses until connected", async () => {
    const c = controllerFor(fakeWallet().provider);
    expect(() => c.session()).toThrowError(/MetaMask/);
    await c.connect();
    const session = c.session();
    expect(session.account).toBe(A);
    expect(session.chain.chainId).toBe(84532);
  });

  it("switches network, and adds Base Sepolia first when the wallet has never seen it", async () => {
    let switched = 0;
    const w = fakeWallet({
      wallet_switchEthereumChain: () => {
        switched += 1;
        if (switched === 1) throw Object.assign(new Error("Unrecognized chain"), { code: 4902 });
        return null;
      },
      wallet_addEthereumChain: () => null,
    });
    const c = controllerFor(w.provider);
    await c.connect();
    await c.switchToPoolChain();
    const methods = w.calls.map((x) => x.method);
    expect(methods).toContain("wallet_addEthereumChain");
    const add = w.calls.find((x) => x.method === "wallet_addEthereumChain")?.params as Array<{ chainId: string; rpcUrls: string[] }>;
    expect(add[0]?.chainId).toBe(BASE_SEPOLIA_HEX);
    expect(add[0]?.rpcUrls).toEqual([chain.rpcUrl]);
  });

  it("surfaces a rejected network switch as USER_REJECTED instead of swallowing it", async () => {
    const w = fakeWallet({ wallet_switchEthereumChain: () => { throw Object.assign(new Error("no"), { code: 4001 }); } });
    const c = controllerFor(w.provider);
    await c.connect();
    await expect(c.switchToPoolChain()).rejects.toMatchObject({ code: "USER_REJECTED" });
  });

  it("dispose() detaches from wallet events", async () => {
    const w = fakeWallet();
    const c = controllerFor(w.provider);
    await c.connect();
    expect(w.handlers.size).toBe(2);
    c.dispose();
    expect(w.handlers.size).toBe(0);
  });
});
