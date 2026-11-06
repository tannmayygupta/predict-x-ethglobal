import { Pool, PoolsResponse, Position, derivePoolStatus, fromE18, predictionPoolAbi } from "@predictx/shared";
import { createPublicClient, http, isAddress } from "viem";
import { baseSepolia } from "viem/chains";
import { afterEach, describe, expect, it } from "vitest";
import { createPoolReader } from "../../src/clients/chain";
import { loadConfig } from "../../src/config";
import { buildTestApp } from "../helpers/build";

/**
 * B07-24: against Base Sepolia with the pools seeded by T-B09. Runs only via `pnpm test:live` with a
 * deployed POOL_ADDRESS and POOL_RPC_URL in the repo .env. Each API field is compared with a direct
 * readContract (the in-process equivalent of `cast call`); paste the output in docs/WORKLOG.md.
 */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const poolAddress = process.env.POOL_ADDRESS ?? "";
const rpcUrl = process.env.POOL_RPC_URL ?? "";
const deployed = isAddress(poolAddress) && poolAddress !== ZERO_ADDRESS && rpcUrl.length > 0;

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

describe.skipIf(!deployed)("B07-24 live pools against Base Sepolia", () => {
  it("GET /pools shows the seeded statuses and every field equals the contract view", async () => {
    const config = loadConfig(process.env);
    built = await buildTestApp({ config, poolReader: createPoolReader(config) });
    const client = createPublicClient({ chain: baseSepolia, transport: http(config.poolRpcUrl) });
    const address = poolAddress as `0x${string}`;
    // Pool status is derived from the clock, so align it with the chain instead of the fixed test epoch.
    const latest = await client.getBlock({ blockTag: "latest" });
    built.clock.set(Number(latest.timestamp));
    const count = await client.readContract({ address, abi: predictionPoolAbi, functionName: "poolCount" });
    expect(count).toBeGreaterThan(0n);

    const res = await built.app.inject({ method: "GET", url: "/api/v1/pools" });
    expect(res.statusCode).toBe(200);
    const { pools } = PoolsResponse.parse(res.json());
    expect(pools.length).toBe(Math.min(Number(count), 20));
    // T-B09 seeds one open, one awaiting and one resolved pool.
    expect(new Set(pools.map((p) => p.status))).toEqual(new Set(["open", "awaiting", "resolved"]));

    const now = built.clock.now();
    for (const pool of pools) {
      const onchain = await client.readContract({ address, abi: predictionPoolAbi, functionName: "getPool", args: [BigInt(pool.id)] });
      const expectedStatus = derivePoolStatus({
        now,
        resolveTime: Number(onchain.resolveTime),
        resolved: onchain.resolved,
        yesTotal: onchain.yesTotal.toString(),
        noTotal: onchain.noTotal.toString(),
      });
      expect(pool).toMatchObject({
        question: onchain.question,
        coingeckoId: onchain.coingeckoId,
        direction: onchain.direction === 0 ? "above" : "below",
        strikeUsd: fromE18(onchain.strikeE18),
        resolveTime: Number(onchain.resolveTime),
        createdAt: Number(onchain.createdAt),
        yesTotal: onchain.yesTotal.toString(),
        noTotal: onchain.noTotal.toString(),
        status: expectedStatus,
        resolvedPriceUsd: onchain.resolved ? fromE18(onchain.resolvedPriceE18) : null,
        feeBps: onchain.feeBps,
        creator: onchain.creator,
        contract: config.poolAddress,
        chainId: config.poolChainId,
      });
      const single = await built.app.inject({ method: "GET", url: `/api/v1/pools/${pool.id}` });
      expect(Pool.parse(single.json())).toEqual(pool);
    }

    const first = pools[0];
    if (!first) return;
    const position = await built.app.inject({ method: "GET", url: `/api/v1/pools/${first.id}/position?address=${first.creator}` });
    expect(position.statusCode).toBe(200);
    const [yesStake, noStake, claimed] = await client.readContract({
      address,
      abi: predictionPoolAbi,
      functionName: "getPosition",
      args: [BigInt(first.id), first.creator as `0x${string}`],
    });
    expect(Position.parse(position.json())).toMatchObject({
      yesStake: yesStake.toString(),
      noStake: noStake.toString(),
      claimed,
    });
  });
});
