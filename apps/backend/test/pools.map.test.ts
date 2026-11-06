import { Pool, buildQuestion, derivePoolStatus, fromE18, toStrikeE18 } from "@predictx/shared";
import { describe, expect, it } from "vitest";
import { toPool, type PoolContext } from "../src/services/pools";
import { FAKE_CLOCK_START, FakeClock } from "./helpers/fakes/clock";
import { SEED_RESOLVED_PRICE_USD, SEED_STRIKE_USD, makeRawPool } from "./helpers/fakes/poolReader";

const CONTRACT = "0x2222222222222222222222222222222222222222";
const CTX: PoolContext = {
  now: FAKE_CLOCK_START,
  chainId: 84532,
  contract: CONTRACT,
  dashboardUrl: "https://predictx.app",
};

describe("B07-01 toPool maps the raw tuple into the Pool schema", () => {
  it("parses with Pool and converts strike, direction, totals and resolved price", () => {
    const raw = makeRawPool("resolved", 12);
    const pool = toPool(raw, CTX);
    expect(Pool.parse(pool)).toEqual(pool);
    expect(pool.id).toBe(12);
    expect(pool.chainId).toBe(84532);
    expect(pool.contract).toBe(CONTRACT);
    expect(pool.symbol).toBe("PEPE");
    expect(pool.coingeckoId).toBe("pepe");
    expect(pool.strikeUsd).toBe(fromE18(raw.strikeE18));
    expect(pool.strikeUsd).toBe(SEED_STRIKE_USD);
    expect(pool.direction).toBe("above");
    expect(pool.yesTotal).toBe("60000000");
    expect(pool.noTotal).toBe("40000000");
    expect(pool.resolveTime).toBe(Number(raw.resolveTime));
    expect(pool.createdAt).toBe(Number(raw.createdAt));
    expect(pool.resolvedPriceUsd).toBe(SEED_RESOLVED_PRICE_USD);
    expect(pool.feeBps).toBe(200);
    expect(pool.creator).toBe(raw.creator);
  });

  it("maps direction 1 to below and an unresolved price to null", () => {
    const raw = makeRawPool("open", 3, { direction: 1, strikeE18: toStrikeE18("2451.12") });
    const pool = toPool(raw, CTX);
    expect(Pool.parse(pool)).toEqual(pool);
    expect(pool.direction).toBe("below");
    expect(pool.strikeUsd).toBe("2451.12");
    expect(pool.resolvedPriceUsd).toBeNull();
  });

  it("falls back to the $SYMBOL in the question when the coingecko id is not in tokens.json", () => {
    const raw = makeRawPool("open", 4, { coingeckoId: "some-new-coin", symbol: "NEWC" });
    expect(toPool(raw, CTX).symbol).toBe("NEWC");
  });
});

describe("B07-02 status comes from derivePoolStatus for all four cases", () => {
  const cases = [
    { kind: "open", expected: "open" },
    { kind: "awaiting", expected: "awaiting" },
    { kind: "resolved", expected: "resolved" },
    { kind: "void", expected: "void" },
  ] as const;
  it.each(cases)("$kind pool -> $expected", ({ kind, expected }) => {
    const clock = new FakeClock();
    const raw = makeRawPool(kind, 1, { now: clock.now() });
    const pool = toPool(raw, { ...CTX, now: clock.now() });
    expect(pool.status).toBe(expected);
    expect(pool.status).toBe(
      derivePoolStatus({
        now: clock.now(),
        resolveTime: Number(raw.resolveTime),
        resolved: raw.resolved,
        yesTotal: raw.yesTotal.toString(),
        noTotal: raw.noTotal.toString(),
      }),
    );
  });

  it("an open pool becomes awaiting once the clock passes resolveTime", () => {
    const clock = new FakeClock();
    const raw = makeRawPool("open", 1, { now: clock.now() });
    expect(toPool(raw, { ...CTX, now: clock.now() }).status).toBe("open");
    clock.set(Number(raw.resolveTime));
    expect(toPool(raw, { ...CTX, now: clock.now() }).status).toBe("awaiting");
  });
});

describe("B07-03 outcome is null unless resolved and not void", () => {
  it("open and awaiting pools have no outcome", () => {
    expect(toPool(makeRawPool("open", 1), CTX).outcome).toBeNull();
    expect(toPool(makeRawPool("awaiting", 1), CTX).outcome).toBeNull();
  });
  it("a resolved pool reports yes or no from outcomeYes", () => {
    expect(toPool(makeRawPool("resolved", 1, { outcomeYes: true }), CTX).outcome).toBe("yes");
    expect(toPool(makeRawPool("resolved", 1, { outcomeYes: false }), CTX).outcome).toBe("no");
  });
  it("a void pool hides the outcome even though the contract stored one", () => {
    const raw = makeRawPool("void", 1, { outcomeYes: true });
    expect(raw.resolved).toBe(true);
    expect(toPool(raw, CTX).outcome).toBeNull();
  });
});

describe("B07-04 dashboardUrl is DASHBOARD_URL + /pool/<id>", () => {
  it("joins the configured origin with the pool path", () => {
    expect(toPool(makeRawPool("open", 12), CTX).dashboardUrl).toBe("https://predictx.app/pool/12");
    expect(toPool(makeRawPool("open", 0), { ...CTX, dashboardUrl: "http://localhost:5173" }).dashboardUrl).toBe(
      "http://localhost:5173/pool/0",
    );
  });
  it("tolerates a trailing slash on the configured origin", () => {
    expect(toPool(makeRawPool("open", 12), { ...CTX, dashboardUrl: "https://predictx.app/" }).dashboardUrl).toBe(
      "https://predictx.app/pool/12",
    );
  });
});

describe("B07-05 question round-trips and equals buildQuestion for seeded pools", () => {
  it.each(["open", "awaiting", "resolved", "void"] as const)("%s pool", (kind) => {
    const raw = makeRawPool(kind, 7);
    const pool = toPool(raw, CTX);
    expect(pool.question).toBe(raw.question);
    expect(pool.question).toBe(
      buildQuestion({
        symbol: pool.symbol,
        direction: pool.direction,
        strikeUsd: pool.strikeUsd,
        resolveTime: pool.resolveTime,
      }),
    );
  });
  it("keeps surrounding whitespace untouched (no trimming)", () => {
    const raw = { ...makeRawPool("open", 7), question: "  padded question  " };
    expect(toPool(raw, CTX).question).toBe("  padded question  ");
  });
});
