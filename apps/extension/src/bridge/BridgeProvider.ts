import type { Eip1193Provider } from "@predictx/ui/provider";
import {
  CHANNEL, PROBE_METHOD, isBridgeMessage, type BridgeEventName, type BridgeMessage, type BridgeRequest,
} from "./protocol";

/** A wallet prompt can sit open while the user decides; this only guards against a page script that never answers. */
const REQUEST_TIMEOUT_MS = 10 * 60_000;
/** The probe asks "is MetaMask there?" and needs no human, so a silent page script must not hold it for minutes. */
export const PROBE_TIMEOUT_MS = 2_000;

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

  /**
   * True when the page script found a MetaMask provider. If the page script never answers (it failed to load, or
   * the extension was reloaded under an open tab) this resolves false after 2 s instead of hanging, so the screen
   * can say "Install MetaMask" and a later Connect press probes again.
   */
  async available(): Promise<boolean> {
    try {
      return (await this.send(PROBE_METHOD, undefined, PROBE_TIMEOUT_MS)) === true;
    } catch {
      return false;
    }
  }

  request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    return this.send(method, params, REQUEST_TIMEOUT_MS);
  }

  private send(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = crypto.randomUUID();
    const message: BridgeRequest = { channel: CHANNEL, kind: "request", id, method, ...(params === undefined ? {} : { params }) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error("The wallet did not answer."), { code: -32603 }));
      }, timeoutMs);
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
