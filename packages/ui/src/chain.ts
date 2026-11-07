/**
 * Base Sepolia clients and the read side of the pool contract. Reads here go straight to the chain; the
 * UI uses them right after a transaction because the backend caches pool reads for 10 s (decision D-T6).
 */
import {
  DEPLOYED_APP_URL,
  deployments,
  mockUsdcAbi,
  predictionPoolAbi,
  toPool,
  toPosition,
  type Pool,
  type Position,
  type RawPool,
  type RawPosition,
} from "@predictx/shared";
import { createPublicClient, createWalletClient, getAddress, http, type Address, type Transport } from "viem";
import { baseSepolia } from "viem/chains";

export const POOL_CHAIN = baseSepolia;

export interface ChainOptions {
  rpcUrl?: string;
  poolAddress?: Address;
  usdcAddress?: Address;
  /** Origin used to build Pool.dashboardUrl, same as the backend's DASHBOARD_URL. Defaults to the deployed app, never to a local address. */
  dashboardUrl?: string;
}

function makePublicClient(rpcUrl: string) {
  // Base is an OP-stack chain, so the client type must come from the factory, not from viem's PublicClient.
  return createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
}

export interface ChainClients {
  chainId: number;
  rpcUrl: string;
  poolAddress: Address;
  usdcAddress: Address;
  dashboardUrl: string;
  publicClient: ReturnType<typeof makePublicClient>;
}

export function createChainClients(options: ChainOptions = {}): ChainClients {
  const rpcUrl = options.rpcUrl ?? baseSepolia.rpcUrls.default.http[0];
  const known = deployments[baseSepolia.id];
  return {
    chainId: baseSepolia.id,
    rpcUrl,
    poolAddress: options.poolAddress ?? known.predictionPool,
    usdcAddress: options.usdcAddress ?? known.mockUsdc,
    dashboardUrl: options.dashboardUrl ?? DEPLOYED_APP_URL,
    publicClient: makePublicClient(rpcUrl),
  };
}

/** The transport is the only thing that differs: window.ethereum on the dashboard, the page bridge in the extension. */
export function createPoolWalletClient(transport: Transport) {
  return createWalletClient({ chain: baseSepolia, transport });
}
export type PoolWalletClient = ReturnType<typeof createPoolWalletClient>;

export async function chainNow(chain: ChainClients): Promise<number> {
  const block = await chain.publicClient.getBlock({ blockTag: "latest" });
  return Number(block.timestamp);
}

export async function readRawPool(chain: ChainClients, id: bigint): Promise<RawPool> {
  const pool = await chain.publicClient.readContract({
    address: chain.poolAddress, abi: predictionPoolAbi, functionName: "getPool", args: [id],
  });
  return { id, ...pool };
}

export async function readRawPosition(chain: ChainClients, id: bigint, holder: Address): Promise<RawPosition> {
  const [yesStake, noStake, claimed] = await chain.publicClient.readContract({
    address: chain.poolAddress, abi: predictionPoolAbi, functionName: "getPosition", args: [id, getAddress(holder.toLowerCase())],
  });
  return { yesStake, noStake, claimed };
}

/** The same Pool the backend would serve, but never older than the latest block. */
export async function readPoolFresh(chain: ChainClients, id: number): Promise<Pool> {
  const [raw, now] = await Promise.all([readRawPool(chain, BigInt(id)), chainNow(chain)]);
  return toPool(raw, { now, chainId: chain.chainId, contract: chain.poolAddress, dashboardUrl: chain.dashboardUrl });
}

export async function readPositionFresh(chain: ChainClients, id: number, holder: Address): Promise<Position> {
  const [raw, position, now] = await Promise.all([
    readRawPool(chain, BigInt(id)), readRawPosition(chain, BigInt(id), holder), chainNow(chain),
  ]);
  return toPosition(raw, position, holder, now);
}

export function readUsdcBalance(chain: ChainClients, holder: Address): Promise<bigint> {
  return chain.publicClient.readContract({ address: chain.usdcAddress, abi: mockUsdcAbi, functionName: "balanceOf", args: [holder] });
}

export function readUsdcAllowance(chain: ChainClients, holder: Address): Promise<bigint> {
  return chain.publicClient.readContract({
    address: chain.usdcAddress, abi: mockUsdcAbi, functionName: "allowance", args: [holder, chain.poolAddress],
  });
}
