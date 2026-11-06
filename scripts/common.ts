/**
 * Shared plumbing for the operational scripts: env loading, Base Sepolia clients and the few pool
 * writes the resolver and lifecycle scripts need. Test funds only; keys and signatures are never printed.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deployments, mockUsdcAbi, predictionPoolAbi } from "@predictx/shared";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
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

export interface Wallet {
  account: PrivateKeyAccount;
  client: ReturnType<typeof makeWalletClient>;
}

function makeWalletClient(account: PrivateKeyAccount, rpcUrl: string) {
  return createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl) });
}

export function makeWallet(ctx: PoolContext, keyName: string): Wallet {
  const account = privateKeyToAccount(readKey(keyName));
  return { account, client: makeWalletClient(account, ctx.rpcUrl) };
}

export interface Sent {
  hash: Hex;
  receipt: TransactionReceipt;
}

async function settle(ctx: PoolContext, hash: Hex): Promise<Sent> {
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
  return { hash, receipt };
}

/** Each write simulates first, so a revert surfaces with its reason before any gas is spent. */
export async function mint(ctx: PoolContext, w: Wallet, amount: bigint): Promise<Sent> {
  const { request } = await ctx.publicClient.simulateContract({
    account: w.account, address: ctx.usdc, abi: mockUsdcAbi, functionName: "mint", args: [w.account.address, amount],
  });
  return settle(ctx, await w.client.writeContract(request));
}

export async function approveExact(ctx: PoolContext, w: Wallet, amount: bigint): Promise<Sent> {
  const { request } = await ctx.publicClient.simulateContract({
    account: w.account, address: ctx.usdc, abi: mockUsdcAbi, functionName: "approve", args: [ctx.pool, amount],
  });
  return settle(ctx, await w.client.writeContract(request));
}

export interface NewPool {
  question: string;
  coingeckoId: string;
  direction: 0 | 1;
  strikeE18: bigint;
  resolveTime: bigint;
}

export async function createPool(ctx: PoolContext, w: Wallet, p: NewPool): Promise<Sent & { id: bigint }> {
  const { request } = await ctx.publicClient.simulateContract({
    account: w.account, address: ctx.pool, abi: predictionPoolAbi, functionName: "createPool",
    args: [p.question, p.coingeckoId, p.direction, p.strikeE18, p.resolveTime],
  });
  const sent = await settle(ctx, await w.client.writeContract(request));
  const created = parseEventLogs({ abi: predictionPoolAbi, eventName: "PoolCreated", logs: sent.receipt.logs })[0];
  if (!created) throw new Error("PoolCreated event missing from the receipt");
  return { ...sent, id: created.args.id };
}

export async function stake(ctx: PoolContext, w: Wallet, id: bigint, isYes: boolean, amount: bigint): Promise<Sent> {
  const { request } = await ctx.publicClient.simulateContract({
    account: w.account, address: ctx.pool, abi: predictionPoolAbi, functionName: "stake", args: [id, isYes, amount],
  });
  return settle(ctx, await w.client.writeContract(request));
}

export async function claim(ctx: PoolContext, w: Wallet, id: bigint): Promise<Sent> {
  const { request } = await ctx.publicClient.simulateContract({
    account: w.account, address: ctx.pool, abi: predictionPoolAbi, functionName: "claim", args: [id],
  });
  return settle(ctx, await w.client.writeContract(request));
}

export async function refund(ctx: PoolContext, w: Wallet, id: bigint): Promise<Sent> {
  const { request } = await ctx.publicClient.simulateContract({
    account: w.account, address: ctx.pool, abi: predictionPoolAbi, functionName: "refund", args: [id],
  });
  return settle(ctx, await w.client.writeContract(request));
}

export function usdcBalance(ctx: PoolContext, who: Address): Promise<bigint> {
  return ctx.publicClient.readContract({ address: ctx.usdc, abi: mockUsdcAbi, functionName: "balanceOf", args: [who] });
}

export function readPool(ctx: PoolContext, id: bigint) {
  return ctx.publicClient.readContract({ address: ctx.pool, abi: predictionPoolAbi, functionName: "getPool", args: [id] });
}

export function dueIds(ctx: PoolContext, max: bigint): Promise<readonly bigint[]> {
  return ctx.publicClient.readContract({ address: ctx.pool, abi: predictionPoolAbi, functionName: "getDuePoolIds", args: [max] });
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
