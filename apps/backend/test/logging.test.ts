import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/build";
import { LogCapture } from "./helpers/logCapture";

type Built = Awaited<ReturnType<typeof buildTestApp>>;
let built: Built | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

describe("B01-28 one log line per request", () => {
  it("carries reqId, method, url and status", async () => {
    const logs = new LogCapture();
    built = await buildTestApp({ logStream: logs });
    await built.app.inject({ method: "GET", url: "/api/v1/health" });
    await built.app.inject({ method: "GET", url: "/api/v1/missing" });
    const requestLines = logs.entries().filter((e) => typeof e.reqId === "string");
    expect(requestLines).toHaveLength(2);
    expect(requestLines[0]).toMatchObject({ method: "GET", url: "/api/v1/health", status: 200 });
    expect(requestLines[1]).toMatchObject({ method: "GET", url: "/api/v1/missing", status: 404 });
    expect(requestLines[0]?.reqId).not.toBe(requestLines[1]?.reqId);
  });
});

const FLASH_KEY = "dpka_flash_secret_value_1";
const OPENAI_KEY = "sk-openai-secret-value-2";
const COINGECKO_KEY = "CG-coingecko-secret-value-3";
const BEARER = "Bearer bearer-secret-value-4";
const SIGNATURE = "0xdeadbeefsignaturevalue5";

describe("B01-29 secrets never reach the log stream", () => {
  it("redacts key headers, key config fields and signatures", async () => {
    const logs = new LogCapture();
    built = await buildTestApp({
      logStream: logs,
      env: { FLASH_API_KEY: FLASH_KEY, FLASH_MOCK: "false", OPENAI_API_KEY: OPENAI_KEY, COINGECKO_API_KEY: COINGECKO_KEY },
      extraRoutes: (app) => {
        app.get("/log-headers", async (request) => {
          request.log.info({ headers: request.headers, req: request }, "headers for debugging");
          return { ok: true };
        });
        app.post("/log-body", async (request) => {
          request.log.info({ body: request.body }, "body for debugging");
          return { ok: true };
        });
      },
    });
    await built.app.inject({
      method: "GET",
      url: "/api/v1/log-headers",
      headers: { "x-definitive-api-key": FLASH_KEY, authorization: BEARER },
    });
    await built.app.inject({
      method: "POST",
      url: "/api/v1/log-body",
      payload: { orderSignature: SIGNATURE, permitSignature: SIGNATURE, orderTypedData: SIGNATURE },
    });
    // Boot-time config logging (B10-03) must be safe even when the whole config object is logged.
    built.app.log.info({ config: built.deps.config, env: { FLASH_API_KEY: FLASH_KEY } }, "boot");
    const text = logs.text();
    expect(text.length).toBeGreaterThan(0);
    for (const secret of [FLASH_KEY, OPENAI_KEY, COINGECKO_KEY, BEARER, SIGNATURE]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("[redacted]");
  });
});

describe("B10-03 presence markers survive redaction, real values do not", () => {
  it("keeps [set] and [empty] under a secret key and censors any other value there", async () => {
    const logs = new LogCapture();
    built = await buildTestApp({ logStream: logs });
    built.app.log.info(
      { config: { flashApiKey: "[set]", openaiApiKey: "[empty]", coingeckoApiKey: COINGECKO_KEY }, flashApiKey: FLASH_KEY },
      "boot",
    );
    const line = logs.entries().find((e) => e.msg === "boot");
    expect(line).toMatchObject({
      config: { flashApiKey: "[set]", openaiApiKey: "[empty]", coingeckoApiKey: "[redacted]" },
      flashApiKey: "[redacted]",
    });
    expect(logs.text()).not.toContain(FLASH_KEY);
    expect(logs.text()).not.toContain(COINGECKO_KEY);
  });
});

describe("B01-29b the unhandled-error line never serialises the cause chain", () => {
  it("logs only the error name and message, so an RPC URL with a key in the cause stays out", async () => {
    const SENTINEL = "https://base-sepolia.g.alchemy.com/v2/cause-sentinel-key";
    const logs = new LogCapture();
    built = await buildTestApp({
      logStream: logs,
      extraRoutes: (app) => {
        app.get("/boom-cause", async () => {
          throw new Error("read failed", { cause: new Error(`request to ${SENTINEL} failed`) });
        });
      },
    });
    const res = await built.app.inject({ method: "GET", url: "/api/v1/boom-cause" });
    expect(res.statusCode).toBe(500);
    const line = logs.entries().find((e) => e.msg === "unhandled error");
    expect(line?.err).toEqual({ name: "Error", message: "read failed" });
    expect(logs.text()).not.toContain("cause-sentinel-key");
  });
});
