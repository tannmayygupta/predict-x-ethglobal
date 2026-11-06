import { TokensResponse } from "@predictx/shared";
import tokensJson from "@predictx/shared/tokens.json";
import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/build";

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

describe("B02-01 GET /tokens", () => {
  it("returns 200 and a body that parses with TokensResponse", async () => {
    built = await buildTestApp();
    const res = await built.app.inject({ method: "GET", url: "/api/v1/tokens" });
    expect(res.statusCode).toBe(200);
    expect(() => TokensResponse.parse(res.json())).not.toThrow();
  });
});

describe("B02-02 single source of truth", () => {
  it("body deep-equals packages/shared/tokens.json", async () => {
    built = await buildTestApp();
    const res = await built.app.inject({ method: "GET", url: "/api/v1/tokens" });
    expect(res.json()).toEqual(tokensJson);
  });
});

describe("B02-03 data invariant over tokens.json", () => {
  it("every flashSupported token has non-null address, flashChainId and decimals", () => {
    const { tokens } = TokensResponse.parse(tokensJson);
    const flashTokens = tokens.filter((t) => t.flashSupported);
    expect(flashTokens.length).toBeGreaterThan(0);
    for (const token of flashTokens) {
      expect(token.address, token.symbol).not.toBeNull();
      expect(token.flashChainId, token.symbol).not.toBeNull();
      expect(token.decimals, token.symbol).not.toBeNull();
    }
  });
});

describe("B02-04 caching header", () => {
  it("carries cache-control: public, max-age=300", async () => {
    built = await buildTestApp();
    const res = await built.app.inject({ method: "GET", url: "/api/v1/tokens" });
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
  });
});
