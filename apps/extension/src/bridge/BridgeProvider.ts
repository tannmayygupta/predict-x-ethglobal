import type { Eip1193Provider } from "@predictx/ui/provider";
import {
  CHANNEL, PROBE_METHOD, isBridgeMessage, type BridgeEventName, type BridgeMessage, type BridgeRequest,
} from "./protocol";

/** A wallet prompt can sit open while the user decides; this only guards against a page script that never answers. */
const REQUEST_TIMEOUT_MS = 10 * 60_000;

type Listener = (...args: unknown[]) => void;

interface Pending {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface BridgeHost {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown, targetOrigin: string): void;
  readonly origin: string;
}

/**
 * The content script's view of the wallet: an EIP-1193 provider whose calls travel through the page script.
 * Errors keep the wallet's numeric `code` (4001 = user rejected), which toUiError understands.
 */
export class BridgeProvider implements Eip1193Provider {
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Map<BridgeEventName, Set<Listener>>();

  constructor(private readonly host: BridgeHost) {
    host.addEventListener("message", this.onMessage);
  }

  /** True when the page script found a MetaMask provider. */
  async available(): Promise<boolean> {
    return (await this.request({ method: PROBE_METHOD })) === true;
  }

  request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    const id = crypto.randomUUID();
    const message: BridgeRequest = { channel: CHANNEL, kind: "request", id, method, ...(params === undefined ? {} : { params }) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error("The wallet did not answer."), { code: -32603 }));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.host.postMessage(message, this.host.origin);
    });
  }

  on(event: string, listener: Listener): void {
    const set = this.listeners.get(event as BridgeEventName) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(event as BridgeEventName, set);
  }

  removeListener(event: string, listener: Listener): void {
    this.listeners.get(event as BridgeEventName)?.delete(listener);
  }

  dispose(): void {
    this.host.removeEventListener("message", this.onMessage);
    for (const { timer, reject } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("Bridge closed"));
    }
    this.pending.clear();
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    const data: unknown = event.data;
    if (event.source !== (this.host as unknown) || !isBridgeMessage(data)) return;
    this.dispatch(data);
  };

  private dispatch(message: BridgeMessage): void {
    if (message.kind === "event") {
      for (const listener of this.listeners.get(message.name) ?? []) listener(message.payload);
      return;
    }
    if (message.kind !== "response") return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if ("error" in message) entry.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
    else entry.resolve(message.result);
  }
}
