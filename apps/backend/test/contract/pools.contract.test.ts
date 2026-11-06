import { Pool, PoolsResponse, Position } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build";
import { FakePoolReader, makeRawPools } from "../helpers/fakes/poolReader";

/**
 * B07-21, the pool rows of the FR-B-01 contract table (B04-29): a canonical request per endpoint,
 * parsed with the exact schema the frontend uses. Shapes come only from @predictx/shared (X-05).
 */
type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

const WALLET = "0x1111111111111111111111111111111111111111";

const rows = [
  { name: "GET /pools", url: "/api/v1/pools", schema: PoolsResponse },
  { name: "GET /pools/:id", url: "/api/v1/pools/12", schema: Pool },
  { name: "GET /pools/:id/position", url: `/api/v1/pools/14/position?address=${WALLET}`, schema: Position },
] as const;

describe("B07-21 pool endpoints parse with their shared schemas", () => {
  it.each(rows)("$name", async ({ url, schema }) => {
    const reader = new FakePoolReader();
    reader.seed(makeRawPools(25));
    reader.setPosition(14n, WALLET, { yesStake: 30_000_000n, noStake: 0n, claimed: false });
    built = await buildTestApp({ poolReader: reader });
    const res = await built.app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const body: unknown = res.json();
    expect(schema.safeParse(body).success).toBe(true);
    // The parsed value equals the raw body: nothing is stripped or defaulted on the way out.
    expect(schema.parse(body)).toEqual(body);
  });
});
