import { predictionPoolAbi } from "@predictx/shared";
import { createPublicClient, getAddress, http, isAddress, type Address, type ContractFunctionReturnType, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import { ConfigError, type Config } from "../config";
import { ChainReadError, type PoolReader, type RawPool, type RawPosition } from "./poolReader";

/** The two viem calls the reader needs; tests inject vi.fn() stand-ins instead of a transport. */
export type ChainClient = Pick<PublicClient, "readContract" | "multicall">;

type PoolStruct = ContractFunctionReturnType<typeof predictionPoolAbi, "view", "getPool">;

/** Public Base Sepolia RPCs answer in ~1 s; one retry covers a dropped connection without stalling a request. */
const RPC_TIMEOUT_MS = 10_000;
const RPC_RETRY_COUNT = 1;

function toAddress(value: string): Address {
  // Config already matched 0x + 40 hex; viem additionally rejects a wrong mixed-case checksum.
  if (!isAddress(value)) throw new Error(`invalid pool address: ${value}`);
  return value;
}

function toRawPool(id: bigint, pool: PoolStruct): RawPool {
  return { id, ...pool };
}

export class ViemPoolReader implements PoolReader {
  private readonly address: Address;

  constructor(
    private readonly client: ChainClient,
    address: string,
  ) {
    this.address = toAddress(address);
  }

  poolCount(): Promise<bigint> {
    return this.read("poolCount", () =>
      this.client.readContract({ address: this.address, abi: predictionPoolAbi, functionName: "poolCount" }),
    );
  }

  async getPool(id: bigint): Promise<RawPool> {
    const pool = await this.read("getPool", () =>
      this.client.readContract({ address: this.address, abi: predictionPoolAbi, functionName: "getPool", args: [id] }),
    );
    return toRawPool(id, pool);
  }

  async getPosition(id: bigint, address: string): Promise<RawPosition> {
    // The route only checked 0x + 40 hex; lowercasing first means a wrong mixed-case checksum
    // still names the same account instead of failing inside read() as a 502.
    const holder = getAddress(address.toLowerCase());
    const [yesStake, noStake, claimed] = await this.read("getPosition", () =>
      this.client.readContract({
        address: this.address,
        abi: predictionPoolAbi,
        functionName: "getPosition",
        args: [id, holder],
      }),
    );
    return { yesStake, noStake, claimed };
  }

  /** Two round trips at most (B07-23): poolCount, then every getPool in one Multicall3 call. */
  async listLatest(limit: number): Promise<RawPool[]> {
    const count = await this.poolCount();
    const ids: bigint[] = [];
    for (let id = count - 1n; id >= 0n && ids.length < limit; id -= 1n) ids.push(id);
    if (ids.length === 0) return [];
    const pools = await this.read("multicall(getPool)", () =>
      this.client.multicall({
        allowFailure: false,
        // `as const` keeps functionName a literal so viem types the result as getPool structs.
        contracts: ids.map(
          (id) => ({ address: this.address, abi: predictionPoolAbi, functionName: "getPool", args: [id] }) as const,
        ),
      }),
    );
    return pools.map((pool, i) => toRawPool(ids[i] ?? 0n, pool));
  }

  private async read<T>(name: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      throw new ChainReadError(`chain read failed: ${name}`, { cause: err });
    }
  }
}

export function createPoolReader(config: Config): PoolReader {
  // Pool.chainId is reported from POOL_CHAIN_ID, so reading any other chain would mislabel every pool.
  if (config.poolChainId !== baseSepolia.id) {
    throw new ConfigError(
      `POOL_CHAIN_ID ${config.poolChainId} is not supported: the pool reader only reads Base Sepolia (${baseSepolia.id})`,
    );
  }
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(config.poolRpcUrl, { timeout: RPC_TIMEOUT_MS, retryCount: RPC_RETRY_COUNT }),
  });
  return new ViemPoolReader(client, config.poolAddress);
}
