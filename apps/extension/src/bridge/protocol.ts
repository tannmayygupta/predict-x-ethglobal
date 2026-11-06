/**
 * The postMessage contract between the content script (isolated world) and the page script (main world, the
 * only place window.ethereum exists). Requests carry an unguessable id; only an allowlisted set of wallet
 * methods is ever forwarded.
 */
export const CHANNEL = "predictx-wallet-bridge" as const;

/** Internal probe: "is a MetaMask provider present?" Not forwarded to the wallet. */
export const PROBE_METHOD = "px_available" as const;

export const FORWARDED_METHODS: ReadonlySet<string> = new Set([
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
  "eth_sendTransaction",
  "eth_signTypedData_v4",
]);

export const EVENT_NAMES = ["accountsChanged", "chainChanged"] as const;
export type BridgeEventName = (typeof EVENT_NAMES)[number];

export interface BridgeRequest {
  channel: typeof CHANNEL;
  kind: "request";
  id: string;
  method: string;
  params?: unknown;
}

export interface BridgeError {
  code: number;
  message: string;
}

export type BridgeResponse =
  | { channel: typeof CHANNEL; kind: "response"; id: string; result: unknown }
  | { channel: typeof CHANNEL; kind: "response"; id: string; error: BridgeError };

export interface BridgeEvent {
  channel: typeof CHANNEL;
  kind: "event";
  name: BridgeEventName;
  payload: unknown;
}

export type BridgeMessage = BridgeRequest | BridgeResponse | BridgeEvent;

/** EIP-1193 / EIP-1474 codes used when the page script itself must refuse. */
export const ERR_UNSUPPORTED_METHOD = 4200;
export const ERR_NO_WALLET = 4900;
export const ERR_INTERNAL = -32603;

export function isBridgeMessage(value: unknown): value is BridgeMessage {
  return typeof value === "object" && value !== null && (value as { channel?: unknown }).channel === CHANNEL;
}
