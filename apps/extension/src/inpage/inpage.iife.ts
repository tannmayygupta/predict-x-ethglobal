/**
 * Runs in x.com's own JavaScript world (manifest world "MAIN"), because window.ethereum is invisible from a
 * content script's isolated world. Built as a standalone IIFE so x.com's script CSP cannot block a module load.
 * It holds no keys and does nothing until the content script asks.
 */
import { discoverMetaMask } from "@predictx/ui/provider";
import { isBridgeMessage } from "../bridge/protocol";
import { createBridgeHandler } from "./handler";

let providerPromise: ReturnType<typeof discoverMetaMask> | null = null;

const handle = createBridgeHandler({
  getProvider: () => (providerPromise ??= discoverMetaMask()),
  post: (message) => window.postMessage(message, window.location.origin),
});

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || !isBridgeMessage(event.data) || event.data.kind !== "request") return;
  void handle(event.data);
});
