import { ApiError } from "@predictx/shared";
import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/build";

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

describe("B01-06 GET /api/v1/health", () => {
  it("returns 200 and exactly { ok: true }", async () => {
    built = await buildTestApp();
    const res = await built.app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe("B01-07 GET /health without the prefix", () => {
  it("returns 404 NOT_FOUND in ApiError shape", async () => {
    built = await buildTestApp();
    const res = await built.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(404);
    expect(ApiError.parse(res.json()).error.code).toBe("NOT_FOUND");
  });
});

describe("B01-08 unknown route under the prefix", () => {
  it("returns 404 NOT_FOUND in ApiError shape", async () => {
    built = await buildTestApp();
    const res = await built.app.inject({ method: "GET", url: "/api/v1/nope" });
    expect(res.statusCode).toBe(404);
    const parsed = ApiError.parse(res.json());
    expect(parsed.error.code).toBe("NOT_FOUND");
    expect(parsed.error.message).toContain("/api/v1/nope");
  });
});
