import { predictionPoolAbi } from "@predictx/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { createApiClient } from "../../src/api";
import { createChainClients, readPoolFresh, readPositionFresh } from "../../src/chain";

/**
 * The UI refreshes a pool from the chain right after a transaction, the backend serves it from a cache.
 * Both must produce the same Pool and Position, field for field. Needs the backend on E2E_API_BASE
 * (default http://localhost:8787/api/v1) and reads the real Base Sepolia contract. No keys, no gas.
 */
const apiBase = process.env.E2E_API_BASE ?? "http://localhost:8787/api/v1";
const api = createApiClient(apiBase);
const chain = createChainClients();
const NEAR_BOUNDARY_SECONDS = 30; // status is clock-dependent; the two clocks may sit on different sides of a boundary

let poolCount = 0;

beforeAll(async () => {
  poolCount = Number(
    await chain.publicClient.readContract({ address: chain.poolAddress, abi: predictionPoolAbi, functionName: "poolCount" }),
  );
});

describe("backend pools equal chain pools", () => {
  it("the contract has pools to compare", () => {
    expect(poolCount).toBeGreaterThan(0);
  });

  it("every pool matches field for field", async () => {
    for (let id = 0; id < Math.min(poolCount, 20); id++) {
      const [fromApi, fromChain] = await Promise.all([api.pool(id), readPoolFresh(chain, id)]);
      const { status: apiStatus, ...apiRest } = fromApi;
      const { status: chainStatus, ...chainRest } = fromChain;
      expect(apiRest, `pool ${id}`).toEqual(chainRest);
      const nowish = Math.floor(Date.now() / 1000);
      if (Math.abs(nowish - fromApi.resolveTime) > NEAR_BOUNDARY_SECONDS) expect(apiStatus, `pool ${id} status`).toBe(chainStatus);
    }
  });

  it("every creator's position matches (claimable and refundable come from the same shared code)", async () => {
    for (let id = 0; id < Math.min(poolCount, 20); id++) {
      const pool = await api.pool(id);
      const holder = pool.creator as `0x${string}`;
      const [fromApi, fromChain] = await Promise.all([api.position(id, holder), readPositionFresh(chain, id, holder)]);
      expect(fromApi.yesStake, `pool ${id}`).toBe(fromChain.yesStake);
      expect(fromApi.noStake).toBe(fromChain.noStake);
      expect(fromApi.claimed).toBe(fromChain.claimed);
      if (Math.abs(Math.floor(Date.now() / 1000) - pool.resolveTime) > NEAR_BOUNDARY_SECONDS) {
        expect(fromApi.claimable).toBe(fromChain.claimable);
        expect(fromApi.refundable).toBe(fromChain.refundable);
      }
    }
  });
});
