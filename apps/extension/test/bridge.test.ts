import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeProvider, PROBE_TIMEOUT_MS, type BridgeHost } from "../src/bridge/BridgeProvider";
import { CHANNEL, ERR_NO_WALLET, ERR_UNSUPPORTED_METHOD, PROBE_METHOD, type BridgeEvent, type BridgeRequest, type BridgeResponse } from "../src/bridge/protocol";
import { createBridgeHandler } from "../src/inpage/handler";

type Listener = (event: MessageEvent<unknown>) => void;

/** A stand-in for window: records posted messages and lets a test deliver incoming ones. */
function fakeHost() {
  const listeners = new Set<Listener>();
  const posted: BridgeRequest[] = [];
  const host: BridgeHost = {
    origin: "https://x.com",
    addEventListener: (_t, l) => listeners.add(l),
    removeEventListener: (_t, l) => listeners.delete(l),
    postMessage: (m) => posted.push(m as BridgeRequest),
  };
  const deliver = (data: unknown, source: unknown = host): void => {
    for (const l of listeners) l({ data, source } as unknown as MessageEvent<unknown>);
  };
  return { host, posted, deliver, listeners };
}

const response = (id: string, body: { result: unknown } | { error: { code: number; message: string } }): BridgeResponse =>
  ({ channel: CHANNEL, kind: "response", id, ...body }) as BridgeResponse;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("BridgeProvider (content script side)", () => {
  it("posts a request with an unguessable id and resolves with the matching response", async () => {
    const { host, posted, deliver } = fakeHost();
    const bridge = new BridgeProvider(host);
    const pending = bridge.request({ method: "eth_chainId" });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ channel: CHANNEL, kind: "request", method: "eth_chainId" });
    expect(posted[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    deliver(response(posted[0]?.id ?? "", { result: "0x14a34" }));
    await expect(pending).resolves.toBe("0x14a34");
  });

  it("rejects with the wallet's numeric code so a rejection can be recognised", async () => {
    const { host, posted, deliver } = fakeHost();
    const bridge = new BridgeProvider(host);
    const pending = bridge.request({ method: "eth_sendTransaction", params: [{}] });
    deliver(response(posted[0]?.id ?? "", { error: { code: 4001, message: "User rejected" } }));
    await expect(pending).rejects.toMatchObject({ code: 4001, message: "User rejected" });
  });

  it("ignores messages from other sources, other channels and unknown ids", async () => {
    const { host, posted, deliver } = fakeHost();
    const bridge = new BridgeProvider(host);
    let settled = false;
    void bridge.request({ method: "eth_accounts" }).then(() => (settled = true));
    const id = posted[0]?.id ?? "";
    deliver(response(id, { result: ["0xspoof"] }), { not: "window" });
    deliver({ channel: "other", kind: "response", id, result: [] });
    deliver(response("someone-elses-id", { result: [] }));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    deliver(response(id, { result: [] }));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
  });

  it("delivers wallet events to listeners and stops after removeListener", () => {
    const { host, deliver } = fakeHost();
    const bridge = new BridgeProvider(host);
    const seen: unknown[] = [];
    const listener = (v: unknown): void => void seen.push(v);
    bridge.on("accountsChanged", listener);
    const event: BridgeEvent = { channel: CHANNEL, kind: "event", name: "accountsChanged", payload: ["0xabc"] };
    deliver(event);
    bridge.removeListener("accountsChanged", listener);
    deliver(event);
    expect(seen).toEqual([["0xabc"]]);
  });

  it("available() asks the page script for the probe and reports its answer", async () => {
    const { host, posted, deliver } = fakeHost();
    const bridge = new BridgeProvider(host);
    const answer = bridge.available();
    expect(posted[0]?.method).toBe(PROBE_METHOD);
    deliver(response(posted[0]?.id ?? "", { result: true }));
    await expect(answer).resolves.toBe(true);
  });

  it("available() gives up after 2 s when the page script is silent, instead of hanging for minutes", async () => {
    const { host } = fakeHost();
    const bridge = new BridgeProvider(host);
    const answer = bridge.available();
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + 1);
    await expect(answer).resolves.toBe(false);
  });

  it("gives up on a page script that never answers", async () => {
    const { host } = fakeHost();
    const bridge = new BridgeProvider(host);
    const pending = bridge.request({ method: "eth_accounts" });
    const assertion = expect(pending).rejects.toMatchObject({ message: "The wallet did not answer." });
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
    await assertion;
  });

  it("dispose() detaches from the window and fails what is still pending", async () => {
    const { host, listeners } = fakeHost();
    const bridge = new BridgeProvider(host);
    const pending = bridge.request({ method: "eth_accounts" });
    const assertion = expect(pending).rejects.toThrow("Bridge closed");
    bridge.dispose();
    await assertion;
    expect(listeners.size).toBe(0);
  });
});

describe("bridge handler (page script side)", () => {
  const request = (method: string, params?: unknown): BridgeRequest => ({ channel: CHANNEL, kind: "request", id: "r1", method, ...(params === undefined ? {} : { params }) });

  function setup(provider: { request: ReturnType<typeof vi.fn>; on?: ReturnType<typeof vi.fn> } | null) {
    const posted: Array<BridgeResponse | BridgeEvent> = [];
    const handle = createBridgeHandler({ getProvider: async () => provider, post: (m) => posted.push(m) });
    return { posted, handle };
  }

  it.each(["eth_sign", "personal_sign", "eth_signTransaction", "wallet_requestPermissions", "eth_getBalance", "anything_else"])(
    "refuses %s and never touches the wallet", async (method) => {
      const provider = { request: vi.fn() };
      const { posted, handle } = setup(provider);
      await handle(request(method));
      expect(provider.request).not.toHaveBeenCalled();
      expect(posted[0]).toMatchObject({ kind: "response", id: "r1", error: { code: ERR_UNSUPPORTED_METHOD } });
    },
  );

  it.each(["eth_accounts", "eth_requestAccounts", "eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_sendTransaction", "eth_signTypedData_v4"])(
    "forwards the allowlisted method %s with its params", async (method) => {
      const provider = { request: vi.fn().mockResolvedValue("ok") };
      const { posted, handle } = setup(provider);
      await handle(request(method, [{ a: 1 }]));
      expect(provider.request).toHaveBeenCalledWith({ method, params: [{ a: 1 }] });
      expect(posted[0]).toMatchObject({ kind: "response", result: "ok" });
    },
  );

  it("passes typed data through byte for byte (RULES 4.4)", async () => {
    const provider = { request: vi.fn().mockResolvedValue("0xsig") };
    const { handle } = setup(provider);
    const typed = '{"types":{"Order":[]},"domain":{},"primaryType":"Order","message":{}}';
    await handle(request("eth_signTypedData_v4", ["0x1111111111111111111111111111111111111111", typed]));
    expect(provider.request.mock.calls[0]?.[0].params[1]).toBe(typed);
  });

  it("answers the probe without forwarding it, true or false", async () => {
    const withWallet = setup({ request: vi.fn() });
    await withWallet.handle(request(PROBE_METHOD));
    expect(withWallet.posted[0]).toMatchObject({ result: true });
    const without = setup(null);
    await without.handle(request(PROBE_METHOD));
    expect(without.posted[0]).toMatchObject({ result: false });
  });

  it("reports NO_WALLET for a real request when MetaMask is absent", async () => {
    const { posted, handle } = setup(null);
    await handle(request("eth_requestAccounts"));
    expect(posted[0]).toMatchObject({ error: { code: ERR_NO_WALLET } });
  });

  it("keeps the wallet's error code (4001 = rejected) and subscribes to events once", async () => {
    const on = vi.fn();
    const provider = { request: vi.fn().mockRejectedValue(Object.assign(new Error("User rejected the request."), { code: 4001 })), on };
    const { posted, handle } = setup(provider);
    await handle(request("eth_sendTransaction"));
    await handle(request("eth_sendTransaction"));
    expect(posted[0]).toMatchObject({ error: { code: 4001, message: "User rejected the request." } });
    expect(on).toHaveBeenCalledTimes(2); // accountsChanged + chainChanged, once
  });
});
