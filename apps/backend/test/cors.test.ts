import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/build";

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

describe("B01-16 allowed origin", () => {
  it("reflects https://x.com in access-control-allow-origin", async () => {
    built = await buildTestApp();
    const res = await built.app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { origin: "https://x.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://x.com");
  });
});

describe("B01-17 blocked origin", () => {
  it("gets no access-control-allow-origin header and an otherwise normal response", async () => {
    built = await buildTestApp();
    const res = await built.app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { origin: "https://evil.example" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("B01-18 preflight", () => {
  it("OPTIONS for POST /insight from an allowed origin returns 204 with POST and content-type allowed", async () => {
    built = await buildTestApp();
    const res = await built.app.inject({
      method: "OPTIONS",
      url: "/api/v1/insight",
      headers: { origin: "https://x.com", "access-control-request-method": "POST" },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://x.com");
    expect(String(res.headers["access-control-allow-methods"])).toContain("POST");
    expect(String(res.headers["access-control-allow-headers"]).toLowerCase()).toContain("content-type");
  });
});
