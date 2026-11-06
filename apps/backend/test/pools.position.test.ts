import { Position, computePayout, toUsdcUnits } from "@predictx/shared";
import { describe, expect, it, vi } from "vitest";
import { ViemPoolReader } from "../src/clients/chain";
import { toPosition } from "../src/services/pools";
import { buildTestApp } from "./helpers/build";
import { FAKE_CLOCK_START } from "./helpers/fakes/clock";
import { makeRawPool } from "./helpers/fakes/poolReader";

const WALLET = "0x1111111111111111111111111111111111111111";
const NOW = FAKE_CLOCK_START;
const NONE = { yesStake: 0n, noStake: 0n, claimed: false };

describe("B07-06 winner on a resolved pool", () => {
  it("YES $60 / NO $40, 2% fee, $30 YES stake claims exactly 49000000", () => {
    const pool = makeRawPool("resolved", 11, { outcomeYes: true, yesTotal: toUsdcUnits("60"), noTotal: toUsdcUnits("40") });
    const raw = { yesStake: toUsdcUnits("30"), noStake: 0n, claimed: false };
    const position = toPosition(pool, raw, WALLET, NOW);
    expect(Position.parse(position)).toEqual(position);
    expect(position).toEqual({
      poolId: 11,
      address: WALLET,
      yesStake: "30000000",
      noStake: "0",
      claimable: "49000000",
      claimed: false,
      refundable: "0",
    });
    expect(position.claimable).toBe(computePayout(30_000_000n, 60_000_000n, 40_000_000n, 200).toString());
  });

  it("a NO winner is paid from the NO side", () => {
    const pool = makeRawPool("resolved", 11, { outcomeYes: false, yesTotal: toUsdcUnits("60"), noTotal: toUsdcUnits("40") });
    const raw = { ...NONE, noStake: toUsdcUnits("10") };
    expect(toPosition(pool, raw, WALLET, NOW).claimable).toBe(
      computePayout(10_000_000n, 40_000_000n, 60_000_000n, 200).toString(),
    );
  });
});

describe("B07-07 loser on a resolved pool", () => {
  it("has claimable 0 while the stake is still reported", () => {
    const pool = makeRawPool("resolved", 11, { outcomeYes: true });
    const raw = { ...NONE, noStake: toUsdcUnits("40") };
    const position = toPosition(pool, raw, WALLET, NOW);
    expect(position.claimable).toBe("0");
    expect(position.noStake).toBe("40000000");
    expect(position.refundable).toBe("0");
  });
});

describe("B07-08 open or awaiting pool", () => {
  it.each(["open", "awaiting"] as const)("%s pool pays nothing yet", (kind) => {
    const pool = makeRawPool(kind, 12, { outcomeYes: true });
    const raw = { yesStake: toUsdcUnits("30"), noStake: toUsdcUnits("5"), claimed: false };
    const position = toPosition(pool, raw, WALLET, NOW);
    expect(position.claimable).toBe("0");
    expect(position.refundable).toBe("0");
    expect(position.yesStake).toBe("30000000");
    expect(position.noStake).toBe("5000000");
  });
});

describe("B07-09 void pool", () => {
  it("refundable is yesStake + noStake and claimable is 0", () => {
    const pool = makeRawPool("void", 13, { outcomeYes: true, yesTotal: toUsdcUnits("60"), noTotal: 0n });
    const raw = { yesStake: toUsdcUnits("30"), noStake: toUsdcUnits("2"), claimed: false };
    const position = toPosition(pool, raw, WALLET, NOW);
    expect(Position.parse(position)).toEqual(position);
    expect(position.refundable).toBe("32000000");
    expect(position.claimable).toBe("0");
  });
});

describe("B07-10 already claimed", () => {
  it("a claimed winner shows claimed: true and claimable 0", () => {
    const pool = makeRawPool("resolved", 11, { outcomeYes: true });
    const raw = { yesStake: toUsdcUnits("30"), noStake: 0n, claimed: true };
    const position = toPosition(pool, raw, WALLET, NOW);
    expect(position.claimed).toBe(true);
    expect(position.claimable).toBe("0");
    expect(position.yesStake).toBe("30000000");
  });
  it("a refunded stake on a void pool shows claimed: true and refundable 0", () => {
    const pool = makeRawPool("void", 13);
    const raw = { yesStake: toUsdcUnits("30"), noStake: 0n, claimed: true };
    const position = toPosition(pool, raw, WALLET, NOW);
    expect(position.claimed).toBe(true);
    expect(position.refundable).toBe("0");
  });
});

describe("B07-11 address with no stake", () => {
  it.each(["open", "awaiting", "resolved", "void"] as const)("%s pool: all zeros, claimed false", (kind) => {
    const position = toPosition(makeRawPool(kind, 1), NONE, WALLET, NOW);
    expect(position).toEqual({
      poolId: 1,
      address: WALLET,
      yesStake: "0",
      noStake: "0",
      claimable: "0",
      claimed: false,
      refundable: "0",
    });
  });
});

describe("GET /pools/:id/position with a wrong-checksum mixed-case address", () => {
  it("returns 200 instead of a 502 chain error", async () => {
    const readContract = vi.fn();
    readContract.mockImplementation(async (call: { functionName: string }) => {
      if (call.functionName === "poolCount") return 3n;
      if (call.functionName === "getPool") {
        const { id: _id, ...struct } = makeRawPool("open", 1);
        return struct;
      }
      return [toUsdcUnits("5"), 0n, false];
    });
    const reader = new ViemPoolReader({ readContract, multicall: vi.fn() }, "0x2222222222222222222222222222222222222222");
    const built = await buildTestApp({ poolReader: reader });
    try {
      const address = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
      const res = await built.app.inject({ method: "GET", url: `/api/v1/pools/1/position?address=${address}` });
      expect(res.statusCode).toBe(200);
      const position = Position.parse(res.json());
      expect(position.yesStake).toBe("5000000");
    } finally {
      await built.app.close();
    }
  });
});
