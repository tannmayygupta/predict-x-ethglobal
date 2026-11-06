/**
 * Shared plumbing for the operational scripts: env loading, a Base Sepolia read client and a few pool reads.
 * Wallet writes live in @predictx/ui so scripts and screens run the very same code. Test funds only; keys and
 * signatures are never printed.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deployments, predictionPoolAbi } from "@predictx/shared";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";

export const ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url));

/** Variables already in the environment win over the file. */
export function loadRepoEnv(): void {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
}

export function say(message: string): void {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

export function readKey(name: string): Hex {
  const raw = (process.env[name] ?? "").trim();
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(raw)) throw new Error(`${name} is missing or not a 32-byte hex key`);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

/** Base is an OP-stack chain, so the client type must come from the factory, not from viem's PublicClient. */
function makePublicClient(rpcUrl: string) {
  return createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
}

export interface PoolContext {
  rpcUrl: string;
  pool: Address;
  usdc: Address;
  publicClient: ReturnType<typeof makePublicClient>;
}

export function poolContext(): PoolContext {
  const rpcUrl = process.env.POOL_RPC_URL ?? baseSepolia.rpcUrls.default.http[0];
  const deployment = deployments[baseSepolia.id];
  return { rpcUrl, pool: deployment.predictionPool, usdc: deployment.mockUsdc, publicClient: makePublicClient(rpcUrl) };
}

export function dueIds(ctx: PoolContext, max: bigint): Promise<readonly bigint[]> {
  return ctx.publicClient.readContract({ address: ctx.pool, abi: predictionPoolAbi, functionName: "getDuePoolIds", args: [max] });
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
