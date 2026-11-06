import { createChainClients, createWalletController, type WalletController } from "@predictx/ui";
import { BridgeProvider } from "../bridge/BridgeProvider";
import { chainOptions } from "../config";

export const chain = createChainClients(chainOptions);

const bridge = new BridgeProvider(window);

/** One wallet for the whole overlay: every card, panel and bet box shares this state. */
export const wallet: WalletController = createWalletController({
  chain,
  getProvider: async () => ((await bridge.available()) ? bridge : null),
});
