import { fixtures, type Pool } from "@predictx/shared";
import { describe, expect, it, vi } from "vitest";
import { createChainClients } from "../src/chain";
import type { PreparedPool } from "../src/create";
import { postablePool } from "../src/created";

const chain = createChainClients({ dashboardUrl: "http://localhost:5173/" });
const prepared: PreparedPool = { question: "Will $ETH be above $1000 at 22:00 UTC on 6 Nov?", coingeckoId: "ethereum", direction: 0, strikeUsd: "1000", strikeE18: 1n, resolveTime: 1 };
const sleep = async () => undefined;

describe("postablePool", () => {
  it("returns the pool read from the chain", async () => {
    const read = vi.fn<(c: unknown, id: number) => Promise<Pool>>().mockResolvedValue(fixtures.poolOpen);
    expect(await postablePool(chain, 12, prepared, { read, sleep })).toBe(fixtures.poolOpen);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("retries when the node is a block behind and then succeeds", async () => {
    const read = vi.fn<(c: unknown, id: number) => Promise<Pool>>().mockRejectedValueOnce(new Error("PoolNotFound")).mockResolvedValue(fixtures.poolOpen);
    expect(await postablePool(chain, 12, prepared, { read, sleep })).toBe(fixtures.poolOpen);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("never fails: with the chain silent it falls back to the question and link it already knows", async () => {
    const read = vi.fn<(c: unknown, id: number) => Promise<Pool>>().mockRejectedValue(new Error("rpc down"));
    const pool = await postablePool(chain, 7, prepared, { read, sleep });
    expect(read).toHaveBeenCalledTimes(3);
    expect(pool).toEqual({ id: 7, question: prepared.question, dashboardUrl: "http://localhost:5173/pool/7" });
  });
});
