import { predictionPoolAbi } from "@predictx/shared";
import { describe, expect, it, vi } from "vitest";
import { ViemPoolReader, createPoolReader } from "../../src/clients/chain";
import { ChainReadError } from "../../src/clients/poolReader";
import { getAddress, isAddress } from "viem";
import { ConfigError, loadConfig } from "../../src/config";
import { BASELINE_ENV } from "../helpers/env";

const POOL = "0x2222222222222222222222222222222222222222";
const WALLET = "0x1111111111111111111111111111111111111111";

/** What viem decodes from getPool: the struct without the id (the caller knows the id it asked for). */
const POOL_STRUCT = {
  question: "Will $PEPE be above $0.000012 at 14:30 UTC on 28 Oct?",
  coingeckoId: "pepe",
  direction: 0,
  strikeE18: 12_000_000_000_000n,
  resolveTime: 1_761_602_400n,
  createdAt: 1_761_588_000n,
  yesTotal: 60_000_000n,
  noTotal: 40_000_000n,
  resolved: false,
  outcomeYes: false,
  resolvedPriceE18: 0n,
  feeBps: 200,
  creator: WALLET,
};

function fakeClient() {
  const readContract = vi.fn();
  const multicall = vi.fn();
  const reader = new ViemPoolReader({ readContract, multicall }, POOL);
  return { reader, readContract, multicall };
}

describe("B07-22 ViemPoolReader reads the contract with the shared ABI and POOL_ADDRESS", () => {
  it("poolCount() calls readContract(poolCount) with no args", async () => {
    const { reader, readContract } = fakeClient();
    readContract.mockResolvedValueOnce(25n);
    await expect(reader.poolCount()).resolves.toBe(25n);
    expect(readContract).toHaveBeenCalledTimes(1);
    expect(readContract).toHaveBeenCalledWith({ address: POOL, abi: predictionPoolAbi, functionName: "poolCount" });
  });

  it("getPool(id) calls readContract(getPool, [id]) and attaches the id to the decoded struct", async () => {
    const { reader, readContract } = fakeClient();
    readContract.mockResolvedValueOnce(POOL_STRUCT);
    await expect(reader.getPool(12n)).resolves.toEqual({ id: 12n, ...POOL_STRUCT });
    expect(readContract).toHaveBeenCalledWith({
      address: POOL,
      abi: predictionPoolAbi,
      functionName: "getPool",
      args: [12n],
    });
  });

  it("getPosition(id, address) calls readContract(getPosition, [id, address]) and names the tuple", async () => {
    const { reader, readContract } = fakeClient();
    readContract.mockResolvedValueOnce([30_000_000n, 0n, false]);
    await expect(reader.getPosition(12n, WALLET)).resolves.toEqual({
      yesStake: 30_000_000n,
      noStake: 0n,
      claimed: false,
    });
    expect(readContract).toHaveBeenCalledWith({
      address: POOL,
      abi: predictionPoolAbi,
      functionName: "getPosition",
      args: [12n, WALLET],
    });
  });

  it("getPosition accepts a mixed-case address with a wrong EIP-55 checksum and passes viem a valid one", async () => {
    const { reader, readContract } = fakeClient();
    const wrongChecksum = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
    expect(isAddress(wrongChecksum)).toBe(false);
    readContract.mockResolvedValueOnce([0n, 0n, false]);
    await expect(reader.getPosition(12n, wrongChecksum)).resolves.toEqual({ yesStake: 0n, noStake: 0n, claimed: false });
    const normalised = getAddress(wrongChecksum.toLowerCase());
    expect(isAddress(normalised)).toBe(true);
    expect(readContract).toHaveBeenCalledWith({
      address: POOL,
      abi: predictionPoolAbi,
      functionName: "getPosition",
      args: [12n, normalised],
    });
  });

  it("wraps a failed read in ChainReadError naming the call but never echoing the RPC URL", async () => {
    const { reader, readContract } = fakeClient();
    const upstream = new Error("HTTP request failed. URL: https://rpc.example/v2/SECRET-KEY");
    readContract.mockRejectedValueOnce(upstream);
    const failure = await reader.getPool(12n).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(ChainReadError);
    if (!(failure instanceof ChainReadError)) return;
    expect(failure.message).toContain("getPool");
    expect(failure.message).not.toContain("SECRET-KEY");
    expect(failure.cause).toBe(upstream);
  });

  it("createPoolReader(config) builds a ViemPoolReader for POOL_ADDRESS without touching the network", () => {
    const config = loadConfig({ ...BASELINE_ENV, POOL_ADDRESS: POOL });
    const reader = createPoolReader(config);
    expect(reader).toBeInstanceOf(ViemPoolReader);
  });

  it("createPoolReader throws ConfigError when POOL_CHAIN_ID is not Base Sepolia (84532)", () => {
    const config = loadConfig({ ...BASELINE_ENV, POOL_ADDRESS: POOL, POOL_CHAIN_ID: "8453" });
    expect(() => createPoolReader(config)).toThrow(ConfigError);
    expect(() => createPoolReader(config)).toThrow(/POOL_CHAIN_ID 8453.*84532/);
  });
});

describe("B07-23 listLatest uses one poolCount read plus one multicall", () => {
  it("20 of 25 pools: ids 24..5 newest first in exactly two round trips", async () => {
    const { reader, readContract, multicall } = fakeClient();
    readContract.mockResolvedValueOnce(25n);
    const wanted = Array.from({ length: 20 }, (_, i) => 24 - i);
    multicall.mockResolvedValueOnce(wanted.map((id) => ({ ...POOL_STRUCT, question: `pool ${id}` })));
    const pools = await reader.listLatest(20);
    expect(pools.map((p) => p.id)).toEqual(wanted.map(BigInt));
    expect(pools.map((p) => p.question)).toEqual(wanted.map((id) => `pool ${id}`));
    expect(readContract).toHaveBeenCalledTimes(1);
    expect(multicall).toHaveBeenCalledTimes(1);
    expect(multicall).toHaveBeenCalledWith({
      allowFailure: false,
      contracts: wanted.map((id) => ({ address: POOL, abi: predictionPoolAbi, functionName: "getPool", args: [BigInt(id)] })),
    });
  });

  it("fewer pools than the limit reads them all", async () => {
    const { reader, readContract, multicall } = fakeClient();
    readContract.mockResolvedValueOnce(3n);
    multicall.mockResolvedValueOnce([POOL_STRUCT, POOL_STRUCT, POOL_STRUCT]);
    const pools = await reader.listLatest(20);
    expect(pools.map((p) => p.id)).toEqual([2n, 1n, 0n]);
    expect(multicall.mock.calls[0]?.[0]).toMatchObject({ contracts: [{ args: [2n] }, { args: [1n] }, { args: [0n] }] });
  });

  it("zero pools needs only the count read", async () => {
    const { reader, readContract, multicall } = fakeClient();
    readContract.mockResolvedValueOnce(0n);
    await expect(reader.listLatest(20)).resolves.toEqual([]);
    expect(multicall).not.toHaveBeenCalled();
  });

  it("a failing multicall becomes ChainReadError", async () => {
    const { reader, readContract, multicall } = fakeClient();
    readContract.mockResolvedValueOnce(25n);
    multicall.mockRejectedValueOnce(new Error("timeout"));
    await expect(reader.listLatest(20)).rejects.toBeInstanceOf(ChainReadError);
  });
});
