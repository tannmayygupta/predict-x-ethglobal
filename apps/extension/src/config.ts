import type { ChainOptions } from "@predictx/ui";
import { Address, DEPLOYED_API_BASE_URL, DEPLOYED_APP_URL } from "@predictx/shared";

/**
 * Build-time configuration (VITE_ variables are public by design; secrets never use that prefix). The extension is built
 * on a machine whose repo-root .env holds local addresses for the dashboard, and a link to one in a post is dead for every
 * reader. So it does not read the dashboard's VITE_API_BASE_URL and VITE_DASHBOARD_URL: it targets the deployed app
 * unless VITE_EXTENSION_API_BASE_URL and VITE_EXTENSION_DASHBOARD_URL say otherwise (a local stack, see .env.example).
 * Contract addresses fall back to packages/shared deployments when unset.
 */
const env = import.meta.env;

function optionalAddress(value: string | undefined): `0x${string}` | undefined {
  if (!value) return undefined;
  return Address.parse(value) as `0x${string}`;
}

/** A blank line in .env arrives as "" and must fall back exactly like an unset variable. */
function valueOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

export const apiBaseUrl = valueOr(env.VITE_EXTENSION_API_BASE_URL, DEPLOYED_API_BASE_URL);
export const dashboardUrl = valueOr(env.VITE_EXTENSION_DASHBOARD_URL, DEPLOYED_APP_URL);

export const chainOptions: ChainOptions = {
  dashboardUrl,
  ...(env.VITE_POOL_RPC_URL ? { rpcUrl: env.VITE_POOL_RPC_URL } : {}),
  ...(env.VITE_POOL_ADDRESS ? { poolAddress: optionalAddress(env.VITE_POOL_ADDRESS) } : {}),
  ...(env.VITE_USDC_ADDRESS ? { usdcAddress: optionalAddress(env.VITE_USDC_ADDRESS) } : {}),
};
