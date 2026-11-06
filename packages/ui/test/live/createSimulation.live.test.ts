import { predictionPoolAbi } from "@predictx/shared";
import { describe, expect, it } from "vitest";
import { chainNow, createChainClients } from "../../src/chain";
import { prepareCreate } from "../../src/create";
import { toUiError } from "../../src/errors";

/**
 * Simulates createPool against the real Base Sepolia contract from an address that owns nothing. A simulation is
 * an eth_call: no gas, no key, nothing is sent. It proves the arguments the Create button builds are accepted by the
 * deployed contract, and that its real reverts map to the right UiError.
 */
const chain = createChainClients();
const ANYONE = "0x000000000000000000000000000000000000dEaD";

function simulate(args: readonly [string, string, number, bigint, bigint]) {
  return chain.publicClient.simulateContract({
    account: ANYONE, address: chain.poolAddress, abi: predictionPoolAbi, functionName: "createPool", args,
  });
}

describe("createPool arguments against the deployed contract", () => {
  it.each([
    ["ETH", "ethereum", "above", "1000.5", 180],
    ["PEPE", "pepe", "below", "0.0000120", 3600],
    ["BTC", "bitcoin", "above", "150000", 86400],
  ] as const)("accepts %s %s strike %s over %ss", async (symbol, coingeckoId, direction, strikeUsd, durationSeconds) => {
    const p = prepareCreate({ symbol, coingeckoId, direction, strikeUsd, durationSeconds }, await chainNow(chain));
    const { result } = await simulate([p.question, p.coingeckoId, p.direction, p.strikeE18, BigInt(p.resolveTime)]);
    expect(typeof result).toBe("bigint");
  });

  it("refuses a close time under 120 s and maps the real revert to RESOLVE_TOO_SOON", async () => {
    const now = await chainNow(chain);
    const p = prepareCreate({ symbol: "ETH", coingeckoId: "ethereum", direction: "above", strikeUsd: "1000", durationSeconds: 180 }, now);
    const error = await simulate([p.question, p.coingeckoId, p.direction, p.strikeE18, BigInt(now + 30)]).then(
      () => null,
      (e: unknown) => toUiError(e),
    );
    expect(error?.code).toBe("RESOLVE_TOO_SOON");
  });

  it("refuses a question over 140 characters", async () => {
    const now = await chainNow(chain);
    const longQuestion = "Will $ETH be above $1000 ".padEnd(141, "x");
    const error = await simulate([longQuestion, "ethereum", 0, 1n, BigInt(now + 600)]).then(
      () => null,
      (e: unknown) => toUiError(e),
    );
    expect(error).not.toBeNull();
    expect(error?.code).not.toBe("USER_REJECTED");
  });

  it("reports PoolNotFound for a pool that does not exist when betting is simulated", async () => {
    const error = await chain.publicClient
      .simulateContract({ account: ANYONE, address: chain.poolAddress, abi: predictionPoolAbi, functionName: "claim", args: [999_999n] })
      .then(() => null, (e: unknown) => toUiError(e));
    expect(error?.code).toBe("POOL_NOT_FOUND");
  });
});
