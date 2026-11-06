import type { Eip1193Provider } from "@predictx/ui/provider";
import {
  CHANNEL, ERR_INTERNAL, ERR_NO_WALLET, ERR_UNSUPPORTED_METHOD, EVENT_NAMES, FORWARDED_METHODS, PROBE_METHOD,
  type BridgeError, type BridgeEvent, type BridgeRequest, type BridgeResponse,
} from "../bridge/protocol";

export interface HandlerDeps {
  getProvider(): Promise<Eip1193Provider | null>;
  post(message: BridgeResponse | BridgeEvent): void;
}

function toBridgeError(err: unknown): BridgeError {
  const code = typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : ERR_INTERNAL;
  return { code, message: err instanceof Error ? err.message : "Wallet request failed" };
}

/**
 * Answers one bridge request. Only the allowlisted wallet methods ever reach the provider; anything else is refused
 * here, so a page script that posts its own bridge message cannot make the wallet do more than window.ethereum
 * already lets it do. Wallet events are forwarded once, on the first real request.
 */
export function createBridgeHandler(deps: HandlerDeps): (request: BridgeRequest) => Promise<void> {
  let forwarding = false;

  return async ({ id, method, params }) => {
    const reply = (body: { result: unknown } | { error: BridgeError }): void => deps.post({ channel: CHANNEL, kind: "response", id, ...body });
    if (method !== PROBE_METHOD && !FORWARDED_METHODS.has(method)) {
      reply({ error: { code: ERR_UNSUPPORTED_METHOD, message: `Method not allowed: ${method}` } });
      return;
    }
    const provider = await deps.getProvider();
    if (method === PROBE_METHOD) {
      reply({ result: provider !== null });
      return;
    }
    if (!provider) {
      reply({ error: { code: ERR_NO_WALLET, message: "No MetaMask wallet found" } });
      return;
    }
    if (!forwarding) {
      forwarding = true;
      for (const name of EVENT_NAMES) provider.on?.(name, (payload: unknown) => deps.post({ channel: CHANNEL, kind: "event", name, payload }));
    }
    try {
      reply({ result: await provider.request({ method, ...(params === undefined ? {} : { params }) }) });
    } catch (err) {
      reply({ error: toBridgeError(err) });
    }
  };
}
