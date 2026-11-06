import { Address } from "@predictx/shared";
import { createApiClient, createChainClients, createWalletController, discoverMetaMask, type ChainOptions } from "@predictx/ui";

/**
 * Build-time configuration from the repo-root .env. VITE_ values are public by design; no secret ever uses the
 * prefix. Contract addresses fall back to packages/shared deployments when unset.
 */
const env = import.meta.env;

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env at the repo root.`);
  return value;
}

function address(value: string | undefined): `0x${string}` | undefined {
  return value ? (Address.parse(value) as `0x${string}`) : undefined;
}

export const apiBaseUrl = required("VITE_API_BASE_URL", env.VITE_API_BASE_URL);
export const dashboardUrl = required("VITE_DASHBOARD_URL", env.VITE_DASHBOARD_URL);

const chainOptions: ChainOptions = {
  dashboardUrl,
  ...(env.VITE_POOL_RPC_URL ? { rpcUrl: env.VITE_POOL_RPC_URL } : {}),
  ...(env.VITE_POOL_ADDRESS ? { poolAddress: address(env.VITE_POOL_ADDRESS) } : {}),
  ...(env.VITE_USDC_ADDRESS ? { usdcAddress: address(env.VITE_USDC_ADDRESS) } : {}),
};

export const chain = createChainClients(chainOptions);
export const api = createApiClient(apiBaseUrl);

/** The dashboard talks to MetaMask directly; the extension reaches the same provider through its bridge. */
export const wallet = createWalletController({ chain, getProvider: () => discoverMetaMask() });
