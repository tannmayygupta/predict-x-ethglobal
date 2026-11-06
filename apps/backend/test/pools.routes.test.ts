import { ApiError, Pool, PoolsResponse, Position } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { ChainReadError } from "../src/clients/poolReader";
import { POOL_TTL_SECONDS } from "../src/services/pools";
import { buildTestApp } from "./helpers/build";
import { FakePoolReader, makeRawPools } from "./helpers/fakes/poolReader";
import { LogCapture } from "./helpers/logCapture";

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

const WALLET = "0x1111111111111111111111111111111111111111";

async function buildWithPools(count: number, logStream?: LogCapture): Promise<{ built: Built; reader: FakePoolReader }> {
  const reader = new FakePoolReader();
  reader.seed(makeRawPools(count));
  built = await buildTestApp({ poolReader: reader, ...(logStream ? { logStream } : {}) });
  return { built, reader };
}

/** 200 is asserted here so a failure names the url instead of a zod issue. */
async function getOk(b: Built, url: string): Promise<unknown> {
  const res = await b.app.inject({ method: "GET", url });
  expect(res.statusCode, url).toBe(200);
  return res.json();
}

describe("B07-12 GET /pools", () => {
  it("returns PoolsResponse newest first and at most 20 of 25 pools", async () => {
    const { built: b } = await buildWithPools(25);
    const body = PoolsResponse.parse(await getOk(b, "/api/v1/pools"));
    expect(body.pools).toHaveLength(20);
    expect(body.pools.map((p) => p.id)).toEqual(Array.from({ length: 20 }, (_, i) => 24 - i));
    expect(new Set(body.pools.map((p) => p.status))).toEqual(new Set(["open", "awaiting", "resolved", "void"]));
  });
});

describe("B07-13 GET /pools with zero pools", () => {
  it("returns { pools: [] }", async () => {
    const { built: b, reader } = await buildWithPools(0);
    expect(PoolsResponse.parse(await getOk(b, "/api/v1/pools"))).toEqual({ pools: [] });
    expect(reader.calls).toEqual([{ method: "listLatest", limit: 20 }]);
  });
});

describe("B07-14 GET /pools/:id", () => {
  it("returns Pool for an existing id", async () => {
    const { built: b, reader } = await buildWithPools(25);
    const pool = Pool.parse(await getOk(b, "/api/v1/pools/12"));
    expect(pool.id).toBe(12);
    expect(pool.question).toBe(reader.pools[12]?.question);
    expect(reader.calls).toEqual([{ method: "poolCount" }, { method: "getPool", id: 12n }]);
  });

  it("returns 404 NOT_FOUND for an id at or beyond poolCount", async () => {
    const { built: b, reader } = await buildWithPools(25);
    const res = await b.app.inject({ method: "GET", url: "/api/v1/pools/999" });
    expect(res.statusCode).toBe(404);
    expect(ApiError.parse(res.json()).error.code).toBe("NOT_FOUND");
    // The count already answers the question; no getPool call is wasted on a revert.
    expect(reader.calls).toEqual([{ method: "poolCount" }]);
    const edge = await b.app.inject({ method: "GET", url: "/api/v1/pools/25" });
    expect(edge.statusCode).toBe(404);
  });

  it.each(["abc", "-1", "1.5", "0x1"])("returns 400 BAD_REQUEST for id %s", async (id) => {
    const { built: b } = await buildWithPools(3);
    const res = await b.app.inject({ method: "GET", url: `/api/v1/pools/${id}` });
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("BAD_REQUEST");
  });
});

describe("B07-15 GET /pools/:id/position?address=", () => {
  it("returns Position for a staked wallet", async () => {
    const { built: b, reader } = await buildWithPools(25);
    // id 14 is a resolved pool (kind cycle open, awaiting, resolved, void); a YES winner with $30.
    reader.setPosition(14n, WALLET, { yesStake: 30_000_000n, noStake: 0n, claimed: false });
    const position = Position.parse(await getOk(b, `/api/v1/pools/14/position?address=${WALLET}`));
    const winner = { yesStake: "30000000", noStake: "0", claimable: "49000000", claimed: false, refundable: "0" };
    expect(position).toEqual({ poolId: 14, address: WALLET, ...winner });
    expect(reader.calls).toEqual([
      { method: "poolCount" },
      { method: "getPool", id: 14n },
      { method: "getPosition", id: 14n, address: WALLET },
    ]);
  });

  it("returns all zeros for a wallet with no stake", async () => {
    const { built: b } = await buildWithPools(3);
    const other = "0x9999999999999999999999999999999999999999";
    const position = Position.parse(await getOk(b, `/api/v1/pools/0/position?address=${other}`));
    expect(position.address).toBe(other);
    expect(position.yesStake).toBe("0");
    expect(position.claimed).toBe(false);
  });

  it.each(["", "?address=0x123", "?address=not-an-address", "?address=1111111111111111111111111111111111111111"])(
    "returns 400 BAD_REQUEST naming address for query '%s' (missing or invalid)",
    async (query) => {
      const { built: b } = await buildWithPools(3);
      const res = await b.app.inject({ method: "GET", url: `/api/v1/pools/0/position${query}` });
      expect(res.statusCode).toBe(400);
      const body = ApiError.parse(res.json());
      expect(body.error.code).toBe("BAD_REQUEST");
      expect(body.error.message).toContain("address");
    },
  );
});

describe("B07-16 position for an unknown pool", () => {
  it("returns 404 NOT_FOUND without reading the position", async () => {
    const { built: b, reader } = await buildWithPools(3);
    const res = await b.app.inject({ method: "GET", url: `/api/v1/pools/3/position?address=${WALLET}` });
    expect(res.statusCode).toBe(404);
    expect(ApiError.parse(res.json()).error.code).toBe("NOT_FOUND");
    expect(reader.calls).toEqual([{ method: "poolCount" }]);
  });
});

describe("B07-17 10 s cache per pool, separate from the list cache", () => {
  it("/pools/12 twice within 10 s reads the chain once; at +11 s it reads again", async () => {
    const { built: b, reader } = await buildWithPools(25);
    await getOk(b, "/api/v1/pools/12");
    b.clock.advance(9);
    await getOk(b, "/api/v1/pools/12");
    expect(reader.calls).toEqual([{ method: "poolCount" }, { method: "getPool", id: 12n }]);
    b.clock.advance(2);
    await getOk(b, "/api/v1/pools/12");
    expect(reader.calls).toHaveLength(4);
    expect(reader.calls[3]).toEqual({ method: "getPool", id: 12n });
  });

  it("the single-pool cache is per id", async () => {
    const { built: b, reader } = await buildWithPools(25);
    await b.app.inject({ method: "GET", url: "/api/v1/pools/12" });
    await b.app.inject({ method: "GET", url: "/api/v1/pools/13" });
    expect(reader.calls.filter((c) => c.method === "getPool")).toEqual([
      { method: "getPool", id: 12n },
      { method: "getPool", id: 13n },
    ]);
  });

  it("/pools is cached for 10 s on its own key and does not warm or use the single-pool cache", async () => {
    const { built: b, reader } = await buildWithPools(25);
    await b.app.inject({ method: "GET", url: "/api/v1/pools" });
    await b.app.inject({ method: "GET", url: "/api/v1/pools" });
    expect(reader.calls).toEqual([{ method: "listLatest", limit: 20 }]);
    await b.app.inject({ method: "GET", url: "/api/v1/pools/24" });
    expect(reader.calls).toEqual([
      { method: "listLatest", limit: 20 },
      { method: "poolCount" },
      { method: "getPool", id: 24n },
    ]);
    b.clock.advance(11);
    await b.app.inject({ method: "GET", url: "/api/v1/pools" });
    expect(reader.calls).toHaveLength(4);
    expect(reader.calls[3]).toEqual({ method: "listLatest", limit: 20 });
  });

  it("a cached pool still reports a status derived from the current clock", async () => {
    const { built: b, reader } = await buildWithPools(25);
    // id 12 is an open pool resolving one hour after the fake clock start.
    expect(Pool.parse(await getOk(b, "/api/v1/pools/12")).status).toBe("open");
    b.clock.set(Number(reader.pools[12]?.resolveTime));
    expect(Pool.parse(await getOk(b, "/api/v1/pools/12")).status).toBe("awaiting");
  });
});

describe("B07-18 position is cached per (poolId, address) for 10 s", () => {
  const OTHER = "0x9999999999999999999999999999999999999999";
  const positionCalls = (reader: FakePoolReader) => reader.calls.filter((c) => c.method === "getPosition");

  it("two reads of the same pool and address within 10 s hit the chain once; at +11 s again", async () => {
    const { built: b, reader } = await buildWithPools(25);
    const url = `/api/v1/pools/14/position?address=${WALLET}`;
    await b.app.inject({ method: "GET", url });
    b.clock.advance(9);
    await b.app.inject({ method: "GET", url });
    expect(positionCalls(reader)).toEqual([{ method: "getPosition", id: 14n, address: WALLET }]);
    b.clock.advance(2);
    await b.app.inject({ method: "GET", url });
    expect(positionCalls(reader)).toHaveLength(2);
  });

  it("a different address or pool is a different key", async () => {
    const { built: b, reader } = await buildWithPools(25);
    await b.app.inject({ method: "GET", url: `/api/v1/pools/14/position?address=${WALLET}` });
    await b.app.inject({ method: "GET", url: `/api/v1/pools/14/position?address=${OTHER}` });
    await b.app.inject({ method: "GET", url: `/api/v1/pools/13/position?address=${WALLET}` });
    expect(positionCalls(reader)).toEqual([
      { method: "getPosition", id: 14n, address: WALLET },
      { method: "getPosition", id: 14n, address: OTHER },
      { method: "getPosition", id: 13n, address: WALLET },
    ]);
  });

  it("the position read reuses the cached pool tuple", async () => {
    const { built: b, reader } = await buildWithPools(25);
    await b.app.inject({ method: "GET", url: "/api/v1/pools/14" });
    await b.app.inject({ method: "GET", url: `/api/v1/pools/14/position?address=${WALLET}` });
    expect(reader.calls).toEqual([
      { method: "poolCount" },
      { method: "getPool", id: 14n },
      { method: "getPosition", id: 14n, address: WALLET },
    ]);
  });
});

describe("B07-19 chain read failure", () => {
  const POOL_URL = "/api/v1/pools/12";
  const POSITION_URL = `/api/v1/pools/14/position?address=${WALLET}`;

  async function expectChainUnavailable(res: Awaited<ReturnType<Built["app"]["inject"]>>) {
    expect(res.statusCode).toBe(502);
    const parsed = ApiError.parse(res.json());
    expect(parsed.error.code).toBe("INTERNAL");
    expect(parsed.error.message).toBe("chain unavailable");
  }

  it.each(["/api/v1/pools", POOL_URL, POSITION_URL])("%s with no cache returns 502 INTERNAL", async (url) => {
    const { built: b, reader } = await buildWithPools(25);
    reader.failWith = new ChainReadError("rpc down");
    await expectChainUnavailable(await b.app.inject({ method: "GET", url }));
  });

  it("serves the stale list, pool and position once the entries are older than the TTL", async () => {
    const logs = new LogCapture();
    const { built: b, reader } = await buildWithPools(25, logs);
    reader.setPosition(14n, WALLET, { yesStake: 30_000_000n, noStake: 0n, claimed: false });
    const list = PoolsResponse.parse(await getOk(b, "/api/v1/pools"));
    const pool = Pool.parse(await getOk(b, POOL_URL));
    const position = Position.parse(await getOk(b, POSITION_URL));
    b.clock.advance(POOL_TTL_SECONDS + 1);
    reader.failWith = new ChainReadError("rpc down");
    const callsBefore = reader.calls.length;

    expect(PoolsResponse.parse(await getOk(b, "/api/v1/pools"))).toEqual(list);
    expect(Pool.parse(await getOk(b, POOL_URL))).toEqual(pool);
    expect(Position.parse(await getOk(b, POSITION_URL))).toEqual(position);
    // The chain was tried first every time; stale data is a fallback, not a shortcut.
    expect(reader.calls.length).toBeGreaterThan(callsBefore);
    const warn = logs.entries().find((e) => e.msg === "chain read failed; serving stale");
    expect(warn?.level).toBe(40);
    expect(JSON.stringify(warn)).toContain("rpc down");
  });

  it("a stale pool still derives its status from the current clock", async () => {
    const { built: b, reader } = await buildWithPools(25);
    expect(Pool.parse(await getOk(b, POOL_URL)).status).toBe("open");
    b.clock.set(Number(reader.pools[12]?.resolveTime));
    reader.failWith = new ChainReadError("rpc down");
    expect(Pool.parse(await getOk(b, POOL_URL)).status).toBe("awaiting");
  });

  it("an error that is not a ChainReadError is not mapped and stays a generic 500", async () => {
    const { built: b, reader } = await buildWithPools(25);
    reader.failWith = new Error("bug in the fake");
    const res = await b.app.inject({ method: "GET", url: POOL_URL });
    expect(res.statusCode).toBe(500);
    const parsed = ApiError.parse(res.json());
    expect(parsed.error.code).toBe("INTERNAL");
    expect(parsed.error.message).toBe("Internal error");
  });
});

describe("B07-20 no pool data is written to SQLite (FR-B-05)", () => {
  const TABLES = ["quotes", "orders", "insights"] as const;
  const tableNames = (db: Built["db"]) =>
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
  const rowCounts = (db: Built["db"]) =>
    TABLES.map((t) => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n);

  it("keeps exactly three tables and leaves every row count unchanged across all three endpoints", async () => {
    const { built: b, reader } = await buildWithPools(25);
    reader.setPosition(14n, WALLET, { yesStake: 30_000_000n, noStake: 0n, claimed: false });
    const tablesBefore = tableNames(b.db);
    const countsBefore = rowCounts(b.db);
    expect(tablesBefore).toEqual(["insights", "orders", "quotes"]);
    for (const url of ["/api/v1/pools", "/api/v1/pools/12", `/api/v1/pools/14/position?address=${WALLET}`]) {
      await getOk(b, url);
    }
    b.clock.advance(POOL_TTL_SECONDS + 1);
    await getOk(b, "/api/v1/pools");
    expect(tableNames(b.db)).toEqual(tablesBefore);
    expect(rowCounts(b.db)).toEqual(countsBefore);
  });
});
