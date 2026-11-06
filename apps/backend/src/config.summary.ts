import type { Config } from "./config";

const SET = "[set]";
const EMPTY = "[empty]";
/** The logger's redaction lets exactly these two values through under a secret key (plugins/logging.ts). */
export const PRESENCE_MARKERS: ReadonlySet<string> = new Set([SET, EMPTY]);

/** Same keys as Config, with every secret replaced by a presence marker (B10-03). */
export type ConfigSummary = Omit<Config, "flashApiKey" | "openaiApiKey" | "coingeckoApiKey"> & {
  flashApiKey: string;
  openaiApiKey: string;
  coingeckoApiKey: string;
};

function presence(secret: string): string {
  return secret.length > 0 ? SET : EMPTY;
}

/** Hosted RPC providers put the account key in the path or query; the origin still identifies the provider. */
function originOnly(url: string): string {
  return new URL(url).origin;
}

/**
 * Logging the real values would defeat the redaction the logger already applies (B01-29); logging nothing
 * leaves an operator guessing whether a key was loaded at all. "[set]"/"[empty]" answers that without leaking.
 */
export function describeConfig(config: Config): ConfigSummary {
  return {
    ...config,
    flashApiKey: presence(config.flashApiKey),
    openaiApiKey: presence(config.openaiApiKey),
    coingeckoApiKey: presence(config.coingeckoApiKey),
    poolRpcUrl: originOnly(config.poolRpcUrl),
  };
}
