import type { ChainOptions } from "@predictx/ui";
import { Address } from "@predictx/shared";

/**
 * Build-time configuration from the repo-root .env (VITE_ variables are public by design; secrets never use
 * that prefix). Contract addresses fall back to packages/shared deployments when unset.
 */
const env = import.meta.env;

function optionalAddress(value: string | undefined): `0x${string}` | undefined {
  if (!value) return undefined;
  return Address.parse(value) as `0x${string}`;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env at the repo root.`);
  return value;
}

export const apiBaseUrl = required("VITE_API_BASE_URL", env.VITE_API_BASE_URL);
export const dashboardUrl = required("VITE_DASHBOARD_URL", env.VITE_DASHBOARD_URL);

export const chainOptions: ChainOptions = {
  dashboardUrl,
  ...(env.VITE_POOL_RPC_URL ? { rpcUrl: env.VITE_POOL_RPC_URL } : {}),
  ...(env.VITE_POOL_ADDRESS ? { poolAddress: optionalAddress(env.VITE_POOL_ADDRESS) } : {}),
  ...(env.VITE_USDC_ADDRESS ? { usdcAddress: optionalAddress(env.VITE_USDC_ADDRESS) } : {}),
};
